/**
 * Audit E04 (19/11/2026): a normal launch no longer rebuilds the sync triggers nor looks up each built-in
 * mistake tag. On a throw-away SQLite database with every migration applied; the old statements are
 * replayed once as a baseline for the timing printed in the log.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { rmSync } from 'fs'
import { join } from 'path'

const h = vi.hoisted(() => {
  const { mkdtempSync } = require('fs') as typeof import('fs')
  const { tmpdir } = require('os') as typeof import('os')
  const { join } = require('path') as typeof import('path')
  const root = mkdtempSync(join(tmpdir(), 'nxm-startup-'))
  process.env.NEXUSMIND_DB_PATH = join(root, 'data', 'test.db')
  return { root }
})

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => join(h.root, 'userData'), getAppPath: () => process.cwd(), getVersion: () => '0.0.0-test' },
}))

import { initDatabase, closeDatabase, getPrisma } from '../../electron/main/database'
import { ensureLocalSyncTables, SYNC_TABLES } from '../../electron/main/sync/syncSchema'
import { seedBuiltInMistakeTags } from '../../electron/main/seeds/mistakeTags'
import { BUILT_IN_MISTAKE_TAGS } from '../../src/lib/mistakeTagCatalog'

beforeAll(async () => { await initDatabase() }, 60_000)
afterAll(async () => {
  await closeDatabase()
  try { rmSync(h.root, { recursive: true, force: true }) } catch { /* Windows file lock */ }
})

/** Counts the statements `fn` sends through $executeRawUnsafe, by kind. */
async function statements(fn: () => Promise<unknown>): Promise<{ trigger: number; total: number; ms: number }> {
  const prisma = getPrisma() as any
  const original = prisma.$executeRawUnsafe.bind(prisma)
  let trigger = 0
  let total = 0
  prisma.$executeRawUnsafe = (sql: string, ...args: unknown[]) => {
    total++
    if (/TRIGGER/i.test(sql)) trigger++
    return original(sql, ...args)
  }
  const t0 = performance.now()
  try {
    await fn()
  } finally {
    prisma.$executeRawUnsafe = original
  }
  return { trigger, total, ms: performance.now() - t0 }
}

describe('sync triggers at launch (E04)', () => {
  it('a normal launch sends no trigger statement, and tracking still works', async () => {
    const run = await statements(() => ensureLocalSyncTables(getPrisma()))
    expect(run.trigger).toBe(0)

    const prisma = getPrisma()
    const user = await prisma.user.create({ data: { summonerName: 'S', puuid: 'p-start', region: 'EUW1', nextAssessmentAt: new Date() } })
    const session = await prisma.session.create({ data: { userId: user.id, objectiveId: 'x' } })
    const queued = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT COUNT(*) AS n FROM "_sync_outbox" WHERE "table_name" = 'Session' AND "record_id" = ?`, session.id,
    )
    expect(Number(queued[0].n)).toBe(1)
  })

  it('a missing trigger is created again, and a v1 trigger left over is dropped', async () => {
    const prisma = getPrisma()
    await prisma.$executeRawUnsafe('DROP TRIGGER "_sync_Game_upd_v2"')
    await prisma.$executeRawUnsafe('CREATE TRIGGER "_sync_Game_ins" AFTER INSERT ON "Game" BEGIN SELECT 1; END')
    const run = await statements(() => ensureLocalSyncTables(prisma))
    expect(run.trigger).toBe(2)
    const names = (await prisma.$queryRawUnsafe<{ name: string }[]>(`SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE '_sync_Game%'`)).map((r) => r.name).sort()
    expect(names).toEqual(['_sync_Game_del_v2', '_sync_Game_ins_v2', '_sync_Game_upd_v2'])
  })

  it('timing, before and after (printed)', async () => {
    const prisma = getPrisma()
    const exec = (sql: string) => prisma.$executeRawUnsafe(sql)
    // Baseline: what every launch used to send (the trigger bodies do not matter, they all exist already).
    const before = await statements(async () => {
      for (const { table } of SYNC_TABLES) {
        for (const op of ['ins', 'upd', 'del']) await exec(`DROP TRIGGER IF EXISTS "_sync_${table}_${op}"`)
        for (const op of ['ins', 'upd', 'del']) await exec(`CREATE TRIGGER IF NOT EXISTS "_sync_${table}_${op}_v2" AFTER INSERT ON "${table}" BEGIN SELECT 1; END`)
      }
      for (const tag of BUILT_IN_MISTAKE_TAGS) await prisma.mistakeTag.findUnique({ where: { slug: tag.slug } })
    })
    const after = await statements(async () => {
      await ensureLocalSyncTables(prisma)
      await seedBuiltInMistakeTags()
    })
    console.log(`[E04] launch work: before ${before.ms.toFixed(0)} ms (${before.total} statements + ${BUILT_IN_MISTAKE_TAGS.length} tag lookups), after ${after.ms.toFixed(0)} ms (${after.total} statements + 1 tag read)`)
    expect(after.trigger).toBe(0)
  })
})

describe('built-in mistake tags seed (E04)', () => {
  it('inserts the missing ones in one go, never touches existing ones', async () => {
    const prisma = getPrisma()
    const first = await seedBuiltInMistakeTags()
    expect(first.inserted + first.existing).toBe(BUILT_IN_MISTAKE_TAGS.length)

    const slug = BUILT_IN_MISTAKE_TAGS[0].slug
    await prisma.mistakeTag.update({ where: { slug }, data: { label: 'Edited by the player' } })
    await prisma.mistakeTag.delete({ where: { slug: BUILT_IN_MISTAKE_TAGS[1].slug } })

    expect(await seedBuiltInMistakeTags()).toEqual({ inserted: 1, existing: BUILT_IN_MISTAKE_TAGS.length - 1 })
    expect((await prisma.mistakeTag.findUniqueOrThrow({ where: { slug } })).label).toBe('Edited by the player')
    expect(await seedBuiltInMistakeTags()).toEqual({ inserted: 0, existing: BUILT_IN_MISTAKE_TAGS.length })
  })
})
