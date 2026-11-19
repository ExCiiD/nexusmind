/**
 * Integration tests: real IPC handlers + real Prisma on a throw-away SQLite
 * database (NEXUSMIND_DB_PATH), with Electron replaced by a small fake.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { mkdirSync, writeFileSync, existsSync, readdirSync, cpSync, rmSync } from 'fs'
import { join } from 'path'

const h = vi.hoisted(() => {
  const { mkdtempSync } = require('fs') as typeof import('fs')
  const { tmpdir } = require('os') as typeof import('os')
  const { join } = require('path') as typeof import('path')
  const root = mkdtempSync(join(tmpdir(), 'nxm-ipc-'))
  process.env.NEXUSMIND_DB_PATH = join(root, 'data', 'test.db')
  return { root, handlers: new Map<string, (...args: unknown[]) => unknown>() }
})

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => join(h.root, 'userData'),
    getAppPath: () => process.cwd(),
    getVersion: () => '0.0.0-test',
  },
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => h.handlers.set(channel, fn),
    on: () => {},
  },
  dialog: { showOpenDialog: vi.fn(), showErrorBox: vi.fn() },
  shell: { openExternal: vi.fn() },
  clipboard: { writeText: vi.fn() },
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
  safeStorage: { isEncryptionAvailable: () => false },
  desktopCapturer: { getSources: vi.fn() },
}))

import { initDatabase, closeDatabase, getPrisma, runMigrations, listMigrationFolders, isAlreadyAppliedError } from '../../electron/main/database'
import { registerSessionHandlers } from '../../electron/main/ipc/session.ipc'
import { registerAuthHandlers } from '../../electron/main/ipc/auth.ipc'
import { registerShareHandlers } from '../../electron/main/ipc/share.ipc'
import { registerExternalReviewHandlers } from '../../electron/main/ipc/externalReview.ipc'

const invoke = (channel: string, ...args: unknown[]) => {
  const fn = h.handlers.get(channel)
  if (!fn) throw new Error(`handler not registered: ${channel}`)
  return fn({}, ...args) as Promise<any>
}

beforeAll(async () => {
  await initDatabase()
  registerSessionHandlers()
  registerAuthHandlers()
  registerShareHandlers()
  registerExternalReviewHandlers()
  await getPrisma().user.create({
    data: { summonerName: 'Tester', puuid: 'puuid-test', region: 'EUW1', nextAssessmentAt: new Date() },
  })
}, 60_000)

afterAll(async () => {
  await closeDatabase()
  try { rmSync(h.root, { recursive: true, force: true }) } catch { /* Windows may hold the file */ }
})

describe('migrations', () => {
  it('applies every migration on a fresh database', async () => {
    const rows = await getPrisma().$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT COUNT(*) AS n FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`,
    )
    expect(Number(rows[0].n)).toBe(listMigrationFolders(join(process.cwd(), 'prisma', 'migrations')).length)
  })

  it('backs the database up before applying a new migration', async () => {
    const dir = join(h.root, 'migrations-copy')
    cpSync(join(process.cwd(), 'prisma', 'migrations'), dir, { recursive: true })
    mkdirSync(join(dir, '29990101000000_test_extra'))
    writeFileSync(join(dir, '29990101000000_test_extra', 'migration.sql'), 'CREATE TABLE "TestExtra" ("id" TEXT PRIMARY KEY);')

    await runMigrations(getPrisma(), dir, process.env.NEXUSMIND_DB_PATH)

    const backups = readdirSync(join(h.root, 'data', 'backups'))
    expect(backups.some((f) => f.includes('before-29990101000000_test_extra'))).toBe(true)
  })

  it('does nothing (and makes no backup) when everything is applied', async () => {
    const before = readdirSync(join(h.root, 'data', 'backups')).length
    await runMigrations(getPrisma(), join(h.root, 'migrations-copy'), process.env.NEXUSMIND_DB_PATH)
    expect(readdirSync(join(h.root, 'data', 'backups')).length).toBe(before)
  })

  // DA-2 / E30: "no such column" is no longer swallowed for every statement.
  it('fails on a column typo, and leaves the migration pending', async () => {
    const dir = join(h.root, 'migrations-typo')
    cpSync(join(h.root, 'migrations-copy'), dir, { recursive: true })
    mkdirSync(join(dir, '29990102000000_test_typo'))
    writeFileSync(join(dir, '29990102000000_test_typo', 'migration.sql'),
      'ALTER TABLE "TestExtra" ADD COLUMN "label" TEXT;\nUPDATE "TestExtra" SET "lable" = \'x\';\n')
    await expect(runMigrations(getPrisma(), dir, process.env.NEXUSMIND_DB_PATH)).rejects.toThrow(/no such column/)
    const rows = await getPrisma().$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT COUNT(*) AS n FROM "_prisma_migrations" WHERE migration_name = '29990102000000_test_typo'`,
    )
    expect(Number(rows[0].n)).toBe(0)
  })

  it('still replays a DROP COLUMN already applied by an interrupted run', async () => {
    const dir = join(h.root, 'migrations-drop')
    cpSync(join(h.root, 'migrations-copy'), dir, { recursive: true })
    mkdirSync(join(dir, '29990103000000_test_drop'))
    writeFileSync(join(dir, '29990103000000_test_drop', 'migration.sql'),
      'CREATE TABLE "TestDrop" ("id" TEXT PRIMARY KEY, "old" TEXT);\nALTER TABLE "TestDrop" DROP COLUMN "old";\n')
    // The interrupted run: the table exists and the column is already gone, nothing recorded.
    await getPrisma().$executeRawUnsafe('CREATE TABLE "TestDrop" ("id" TEXT PRIMARY KEY)')
    await runMigrations(getPrisma(), dir, process.env.NEXUSMIND_DB_PATH)
    const rows = await getPrisma().$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT COUNT(*) AS n FROM "_prisma_migrations" WHERE migration_name = '29990103000000_test_drop' AND finished_at IS NOT NULL`,
    )
    expect(Number(rows[0].n)).toBe(1)
  })

  it('isAlreadyAppliedError tolerates "no such column" only on a DROP', () => {
    const missing = 'no such column: "lable"'
    expect(isAlreadyAppliedError('ALTER TABLE "T" DROP COLUMN "c"', missing)).toBe(true)
    expect(isAlreadyAppliedError('  alter table T drop c', missing)).toBe(true)
    expect(isAlreadyAppliedError('DROP INDEX "T_c_idx"', 'no such index: T_c_idx')).toBe(true)
    expect(isAlreadyAppliedError('UPDATE "T" SET "lable" = 1', missing)).toBe(false)
    expect(isAlreadyAppliedError('CREATE INDEX "i" ON "T"("lable")', missing)).toBe(false)
    expect(isAlreadyAppliedError('INSERT INTO "new_T" SELECT "lable" FROM "T"', missing)).toBe(false)
    expect(isAlreadyAppliedError('ALTER TABLE "T" ADD COLUMN "c" TEXT', 'duplicate column name: c')).toBe(true)
    expect(isAlreadyAppliedError('UPDATE "T" SET "c" = 1', 'syntax error')).toBe(false)
    expect(isAlreadyAppliedError('INSERT INTO "new_T" SELECT * FROM "T"', 'UNIQUE constraint failed: new_T.k')).toBe(false)
    expect(isAlreadyAppliedError('CREATE UNIQUE INDEX "i" ON "T"("k")', 'UNIQUE constraint failed: T.k')).toBe(false)
  })

  // Audit P1: a rebuild whose copy hits a UNIQUE constraint must stop before it drops the old table.
  it('a table rebuild whose INSERT … SELECT fails on UNIQUE stops, keeps the old table, stays pending', async () => {
    const prisma = getPrisma()
    await prisma.$executeRawUnsafe('CREATE TABLE "TestDup" ("id" TEXT PRIMARY KEY, "k" TEXT)')
    await prisma.$executeRawUnsafe(`INSERT INTO "TestDup" VALUES ('a', 'same'), ('b', 'same')`)
    const dir = join(h.root, 'migrations-unique')
    cpSync(join(h.root, 'migrations-copy'), dir, { recursive: true })
    mkdirSync(join(dir, '29990104000000_test_unique'))
    writeFileSync(join(dir, '29990104000000_test_unique', 'migration.sql'), [
      'CREATE TABLE "new_TestDup" ("id" TEXT PRIMARY KEY, "k" TEXT UNIQUE);',
      'INSERT OR IGNORE INTO "new_TestDup" ("id", "k") SELECT "id", "k" FROM "TestDup" WHERE 0;',
      'INSERT INTO "new_TestDup" ("id", "k") SELECT "id", "k" FROM "TestDup";',
      'DROP TABLE "TestDup";',
      'ALTER TABLE "new_TestDup" RENAME TO "TestDup";',
    ].join('\n'))
    await expect(runMigrations(prisma, dir, process.env.NEXUSMIND_DB_PATH)).rejects.toThrow(/UNIQUE constraint failed/)
    const rows = await prisma.$queryRawUnsafe<{ n: bigint }[]>('SELECT COUNT(*) AS n FROM "TestDup"')
    expect(Number(rows[0].n)).toBe(2)
    const recorded = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT COUNT(*) AS n FROM "_prisma_migrations" WHERE migration_name = '29990104000000_test_unique'`,
    )
    expect(Number(recorded[0].n)).toBe(0)
  })

  it('a CREATE UNIQUE INDEX over duplicates fails instead of being marked applied', async () => {
    const dir = join(h.root, 'migrations-uindex')
    cpSync(join(h.root, 'migrations-copy'), dir, { recursive: true })
    mkdirSync(join(dir, '29990105000000_test_uindex'))
    writeFileSync(join(dir, '29990105000000_test_uindex', 'migration.sql'), 'CREATE UNIQUE INDEX "TestDup_k_key" ON "TestDup"("k");\n')
    await expect(runMigrations(getPrisma(), dir, process.env.NEXUSMIND_DB_PATH)).rejects.toThrow(/UNIQUE constraint failed/)
  })
})

describe('session handlers', () => {
  it('creates one active session and refuses a second one', async () => {
    const s = await invoke('session:create', { objectiveId: 'wave_management' })
    expect(s.status).toBe('active')
    await expect(invoke('session:create', { objectiveId: 'vision_control' })).rejects.toThrow(/active session already exists/)
  })

  it('always allows a retroactive session', async () => {
    const s = await invoke('session:create', { objectiveId: 'vision_control', isRetroactive: true, date: '2026-01-01' })
    expect(s.status).toBe('completed')
  })
})

describe('user:update', () => {
  it('ignores non-whitelisted fields', async () => {
    await invoke('user:update', { autoRecord: true, puuid: 'hijacked' })
    const u = await getPrisma().user.findFirst({ where: { isActive: true } })
    expect(u?.autoRecord).toBe(true)
    expect(u?.puuid).toBe('puuid-test')
  })

  it('rejects badly typed values', async () => {
    await expect(invoke('user:update', { recordFps: 'sixty' })).rejects.toThrow(/Invalid input/)
  })
})

describe('share webhooks', () => {
  it('only stores real Discord webhooks', async () => {
    await expect(invoke('share:add-webhook', 'evil', 'https://evil.example/api/webhooks/1/a')).rejects.toThrow(/Invalid input/)
    await invoke('share:add-webhook', 'Team', 'https://discord.com/api/webhooks/123/abc')
    const list = await invoke('share:list-webhooks')
    expect(list.map((w: any) => w.name)).toEqual(['Team'])
  })

  it('refuses to send a file that is not a known recording', async () => {
    const secret = join(h.root, 'secret.mp4')
    writeFileSync(secret, 'x')
    await expect(
      invoke('share:send-file-to-discord', secret, 'https://discord.com/api/webhooks/123/abc'),
    ).rejects.toThrow(/FILE_NOT_ALLOWED/)
  })
})

describe('external reviews', () => {
  it('refuses a file path that did not come from the file dialog', async () => {
    await expect(
      invoke('external-review:create', { title: 'x', filePath: join(h.root, 'anything.mp4') }),
    ).rejects.toThrow(/file must be picked/)
  })

  it('never deletes a user file living outside the app recordings folder', async () => {
    const userFile = join(h.root, 'MyVideos', 'obs.mp4')
    mkdirSync(join(h.root, 'MyVideos'), { recursive: true })
    writeFileSync(userFile, 'video')
    const review = await invoke('external-review:create', { title: 'no file' })
    // Simulate a legacy row that already points at a user file.
    await getPrisma().$executeRawUnsafe(`UPDATE "ExternalReview" SET filePath = ? WHERE id = ?`, userFile, review.id)

    await invoke('external-review:delete', review.id)

    expect(existsSync(userFile)).toBe(true)
    const rows = await getPrisma().$queryRawUnsafe<any[]>(`SELECT id FROM "ExternalReview" WHERE id = ?`, review.id)
    expect(rows).toHaveLength(0)
  })
})
