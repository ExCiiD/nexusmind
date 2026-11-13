import type { PrismaClient } from '../../prisma-client'
import { app } from 'electron'
import { join, dirname } from 'path'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync } from 'fs'
import { ensureLocalSyncTables } from './sync/syncSchema'

let prisma: PrismaClient | null = null
/** The generated client's `Prisma` namespace (DMMF, error classes…). */
let prismaNamespace: any = null

/** Number of pre-migration snapshots kept in `<db dir>/backups`. */
const MAX_MIGRATION_BACKUPS = 5

export function getDbPath(): string {
  const userDataPath = app.getPath('userData')
  const dbDir = join(userDataPath, 'data')
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true })
  }
  return join(dbDir, 'nexusmind.db')
}

/**
 * Resolves the SQLite file to open. `NEXUSMIND_DB_PATH` lets automated tests
 * (unit + E2E) run against a throw-away database instead of the developer's
 * `dev.db` or a user's real data.
 */
export function resolveDbPath(): string {
  const override = process.env.NEXUSMIND_DB_PATH
  if (override) {
    mkdirSync(dirname(override), { recursive: true })
    return override
  }
  return app.isPackaged ? getDbPath() : join(process.cwd(), 'dev.db')
}

export function getMigrationsDir(): string {
  const appRoot = app.isPackaged ? app.getAppPath() : process.cwd()
  return join(appRoot, 'prisma', 'migrations')
}

export function listMigrationFolders(migrationsDir: string): string[] {
  if (!existsSync(migrationsDir)) return []
  return readdirSync(migrationsDir)
    .filter((f) => existsSync(join(migrationsDir, f, 'migration.sql')))
    .sort()
}

/** Splits a migration file into executable statements (comments stripped). */
export function splitSqlStatements(sql: string): string[] {
  return sql
    .split(';')
    .map((s) => s.replace(/--[^\n]*/g, '').trim())
    .filter((s) => s.length > 0)
}

async function ensureMigrationsTable(client: PrismaClient): Promise<void> {
  await client.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "migration_name" TEXT NOT NULL UNIQUE,
      "finished_at" DATETIME,
      "started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "applied_steps_count" INTEGER NOT NULL DEFAULT 0
    )
  `)
}

async function listPendingMigrations(client: PrismaClient, folders: string[]): Promise<string[]> {
  const rows = await client.$queryRawUnsafe<{ migration_name: string }[]>(
    `SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`,
  )
  const applied = new Set(rows.map((r) => r.migration_name))
  return folders.filter((f) => !applied.has(f))
}

/**
 * Snapshots the database with `VACUUM INTO` (consistent even while the
 * connection is open) before any migration touches it, then prunes old
 * snapshots. A brand-new database has nothing to protect and is skipped.
 */
export async function backupBeforeMigration(
  client: PrismaClient,
  dbPath: string,
  firstPending: string,
): Promise<string | null> {
  const userTables = await client.$queryRawUnsafe<{ n: number | bigint }[]>(
    `SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_%' ESCAPE '\\' AND name NOT LIKE 'sqlite_%'`,
  )
  if (Number(userTables[0]?.n ?? 0) === 0) return null

  const backupDir = join(dirname(dbPath), 'backups')
  mkdirSync(backupDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const target = join(backupDir, `nexusmind-${stamp}-before-${firstPending}.db`)
  await client.$executeRawUnsafe(`VACUUM INTO '${target.replace(/'/g, "''")}'`)

  const snapshots = readdirSync(backupDir)
    .filter((f) => f.startsWith('nexusmind-') && f.endsWith('.db'))
    .map((f) => ({ f, t: statSync(join(backupDir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t)
  for (const old of snapshots.slice(MAX_MIGRATION_BACKUPS)) {
    try { unlinkSync(join(backupDir, old.f)) } catch { /* best effort */ }
  }
  return target
}

export async function runMigrations(client: PrismaClient, migrationsDir: string, dbPath?: string): Promise<void> {
  await ensureMigrationsTable(client)

  if (!existsSync(migrationsDir)) {
    console.warn('[db] Migrations directory not found:', migrationsDir)
    return
  }

  const pending = await listPendingMigrations(client, listMigrationFolders(migrationsDir))
  if (pending.length === 0) return

  if (dbPath) {
    try {
      const backup = await backupBeforeMigration(client, dbPath, pending[0])
      if (backup) console.log(`[db] Backup before migration: ${backup}`)
    } catch (err) {
      // Refuse to migrate without a safety net: a failed migration on a
      // user's only copy of their coaching history is unrecoverable.
      throw new Error(`[db] Could not back up database before migrating: ${(err as Error)?.message ?? err}`)
    }
  }

  for (const folder of pending) {
    const sql = readFileSync(join(migrationsDir, folder, 'migration.sql'), 'utf-8')

    let appliedCount = 0
    for (const stmt of splitSqlStatements(sql)) {
      try {
        await client.$executeRawUnsafe(stmt)
        appliedCount++
      } catch (err: any) {
        const msg: string = err?.message ?? ''
        if (
          msg.includes('duplicate column name') ||
          msg.includes('already exists') ||
          msg.includes('no such column') ||
          msg.includes('UNIQUE constraint failed')
        ) {
          // Idempotent — statement was already applied in a previous run
        } else {
          throw err
        }
      }
    }

    await client.$executeRawUnsafe(
      `INSERT OR IGNORE INTO "_prisma_migrations" (id, migration_name, applied_steps_count, finished_at)
       VALUES (?, ?, 1, CURRENT_TIMESTAMP)`,
      `${folder}-auto`,
      folder
    )
    if (appliedCount > 0) {
      console.log(`[db] Applied migration: ${folder} (${appliedCount} statement${appliedCount > 1 ? 's' : ''})`)
    }
  }
}

export async function initDatabase(): Promise<PrismaClient> {
  if (prisma) return prisma

  const dbPath = resolveDbPath()

  const clientPath = app.isPackaged
    ? join(app.getAppPath(), 'prisma-client')
    : join(process.cwd(), 'prisma-client')
  const enginePath = app.isPackaged
    ? join(app.getAppPath(), '..', 'app.asar.unpacked', 'prisma-client', 'query_engine-windows.dll.node')
    : join(process.cwd(), 'prisma-client', 'query_engine-windows.dll.node')

  process.env.PRISMA_QUERY_ENGINE_LIBRARY = enginePath

  const { PrismaClient: PC, Prisma } = require(clientPath)
  prismaNamespace = Prisma
  prisma = new PC({
    datasources: {
      db: {
        url: `file:${dbPath}`,
      },
    },
  })

  await prisma!.$connect()
  await runMigrations(prisma!, getMigrationsDir(), dbPath)
  // Change tracking for multi-device sync (idempotent, after migrations so
  // triggers exist on every synced table).
  await ensureLocalSyncTables(prisma!)
  return prisma!
}

export function getPrisma(): PrismaClient {
  if (!prisma) {
    throw new Error('Database not initialized. Call initDatabase() first.')
  }
  return prisma
}

export function getPrismaNamespace(): any {
  if (!prismaNamespace) throw new Error('Database not initialized. Call initDatabase() first.')
  return prismaNamespace
}

export async function closeDatabase(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect()
    prisma = null
  }
}
