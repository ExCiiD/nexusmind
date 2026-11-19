/**
 * Decision M (19/11/2026): old timelines of cached matches no game refers to are dropped; everything else stays.
 * On a throw-away SQLite database with every migration applied.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { rmSync } from 'fs'
import { join } from 'path'

const h = vi.hoisted(() => {
  const { mkdtempSync } = require('fs') as typeof import('fs')
  const { tmpdir } = require('os') as typeof import('os')
  const { join } = require('path') as typeof import('path')
  const root = mkdtempSync(join(tmpdir(), 'nxm-mcpurge-'))
  process.env.NEXUSMIND_DB_PATH = join(root, 'data', 'test.db')
  return { root }
})

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => join(h.root, 'userData'), getAppPath: () => process.cwd(), getVersion: () => '0.0.0-test' },
}))

import { initDatabase, closeDatabase, getPrisma } from '../../electron/main/database'
import { purgeOldTimelines, PURGE_AFTER_DAYS } from '../../electron/main/matchCachePurge'

const NOW = new Date('2026-11-19T12:00:00Z')
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000)

beforeAll(async () => {
  await initDatabase()
  const prisma = getPrisma()
  const user = await prisma.user.create({ data: { summonerName: 'P', puuid: 'p', region: 'EUW1', nextAssessmentAt: new Date() } })
  const session = await prisma.session.create({ data: { userId: user.id, objectiveId: 'x' } })
  await prisma.game.create({ data: { sessionId: session.id, matchId: 'MINE_OLD', champion: 'Ahri', role: 'MID', kills: 0, deaths: 0, assists: 0, cs: 0, visionScore: 0, duration: 1, win: true, gameEndAt: new Date() } })
  const cache = (matchId: string, at: Date) => prisma.matchCache.create({ data: { matchId, matchJson: '{"info":{}}', timelineJson: '{"frames":[]}', createdAt: at } })
  await cache('MINE_OLD', daysAgo(200))      // the user's own game: kept
  await cache('SCOUT_OLD', daysAgo(PURGE_AFTER_DAYS + 1)) // scouting, old: timeline dropped
  await cache('SCOUT_RECENT', daysAgo(10))   // scouting, recent: kept
}, 60_000)

afterAll(async () => {
  await closeDatabase()
  try { rmSync(h.root, { recursive: true, force: true }) } catch { /* Windows file lock */ }
})

describe('purgeOldTimelines', () => {
  it('drops only old timelines of matches no game refers to, and keeps the match body', async () => {
    expect(await purgeOldTimelines(NOW)).toBe(1)
    const rows = await getPrisma().matchCache.findMany({ orderBy: { matchId: 'asc' } })
    expect(rows.map((r) => [r.matchId, r.timelineJson !== null, r.matchJson !== ''])).toEqual([
      ['MINE_OLD', true, true],
      ['SCOUT_OLD', false, true],
      ['SCOUT_RECENT', true, true],
    ])
  })
  it('a second run has nothing left to do', async () => {
    expect(await purgeOldTimelines(NOW)).toBe(0)
  })
})
