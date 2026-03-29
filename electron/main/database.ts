import type { PrismaClient } from '../../prisma-client'
import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'fs'

let prisma: PrismaClient | null = null

export function getDbPath(): string {
  const userDataPath = app.getPath('userData')
  const dbDir = join(userDataPath, 'data')
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true })
  }
  return join(dbDir, 'nexusmind.db')
}

async function runMigrations(client: PrismaClient): Promise<void> {
  await client.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "migration_name" TEXT NOT NULL UNIQUE,
      "finished_at" DATETIME,
      "started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "applied_steps_count" INTEGER NOT NULL DEFAULT 0
    )
  `)

  const appRoot = app.isPackaged ? app.getAppPath() : process.cwd()
  const migrationsDir = join(appRoot, 'prisma', 'migrations')

  if (!existsSync(migrationsDir)) {
    console.warn('[db] Migrations directory not found:', migrationsDir)
    return
  }

  const folders = readdirSync(migrationsDir)
    .filter((f) => existsSync(join(migrationsDir, f, 'migration.sql')))
    .sort()

  for (const folder of folders) {
    const rows = await client.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM "_prisma_migrations" WHERE migration_name = ? AND finished_at IS NOT NULL`,
      folder
    )
    if (rows.length > 0) continue

    const sqlPath = join(migrationsDir, folder, 'migration.sql')
    const sql = readFileSync(sqlPath, 'utf-8')

    const statements = sql
      .split(';')
      .map((s) => s.replace(/--[^\n]*/g, '').trim())
      .filter((s) => s.length > 0)

    for (const stmt of statements) {
      await client.$executeRawUnsafe(stmt)
    }

    await client.$executeRawUnsafe(
      `INSERT OR IGNORE INTO "_prisma_migrations" (id, migration_name, applied_steps_count, finished_at)
       VALUES (?, ?, 1, CURRENT_TIMESTAMP)`,
      `${folder}-auto`,
      folder
    )
    console.log(`[db] Applied migration: ${folder}`)
  }
}

export async function initDatabase(): Promise<PrismaClient> {
  if (prisma) return prisma

  const dbPath = app.isPackaged ? getDbPath() : join(process.cwd(), 'dev.db')

  const clientPath = app.isPackaged
    ? join(app.getAppPath(), 'prisma-client')
    : join(process.cwd(), 'prisma-client')
  const enginePath = app.isPackaged
    ? join(app.getAppPath(), '..', 'app.asar.unpacked', 'prisma-client', 'query_engine-windows.dll.node')
    : join(process.cwd(), 'prisma-client', 'query_engine-windows.dll.node')

  process.env.PRISMA_QUERY_ENGINE_LIBRARY = enginePath

  const { PrismaClient: PC } = require(clientPath)
  prisma = new PC({
    datasources: {
      db: {
        url: `file:${dbPath}`,
      },
    },
  })

  await prisma!.$connect()
  await runMigrations(prisma!)
  return prisma!
}

export function getPrisma(): PrismaClient {
  if (!prisma) {
    throw new Error('Database not initialized. Call initDatabase() first.')
  }
  return prisma
}

export async function closeDatabase(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect()
    prisma = null
  }
}
