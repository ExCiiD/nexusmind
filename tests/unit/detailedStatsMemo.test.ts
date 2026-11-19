/**
 * Audit E02 / PE-3 (19/11/2026): the dashboard radar parses each cached match once per run, not on every visit.
 * The LRU on its own, then the real `stats:get-fundamentals-radar` handler on a throw-away SQLite database
 * (Riot mocked: every match is already cached).
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { rmSync } from 'fs'
import { join } from 'path'

const h = vi.hoisted(() => {
  const { mkdtempSync } = require('fs') as typeof import('fs')
  const { tmpdir } = require('os') as typeof import('os')
  const { join } = require('path') as typeof import('path')
  const root = mkdtempSync(join(tmpdir(), 'nxm-radar-'))
  process.env.NEXUSMIND_DB_PATH = join(root, 'data', 'test.db')
  return { root, handlers: new Map<string, (...args: unknown[]) => unknown>(), matchIds: [] as string[] }
})

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => join(h.root, 'userData'), getAppPath: () => process.cwd(), getVersion: () => '0.0.0-test' },
  ipcMain: { handle: (channel: string, fn: (...args: unknown[]) => unknown) => h.handlers.set(channel, fn), on: () => {} },
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
}))

vi.mock('../../electron/main/riotClient', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../electron/main/riotClient')>()
  return {
    ...real,
    getMatchIds: vi.fn(async () => h.matchIds),
    getMatch: vi.fn(async () => { throw new Error('no network in this test') }),
    getMatchTimeline: vi.fn(async () => { throw new Error('no network in this test') }),
  }
})

import { initDatabase, closeDatabase, getPrisma } from '../../electron/main/database'
import { registerStatsHandlers } from '../../electron/main/ipc/stats.ipc'
import {
  getMemoDetailedStats, setMemoDetailedStats, clearDetailedStatsMemo, detailedStatsMemoSize, DETAILED_STATS_MEMO_SIZE,
  type DetailedStats,
} from '../../electron/main/detailedStatsMemo'

const PUUID = 'puuid-radar'
const GAMES = 40

/** A match body detailed enough for extractDetailedStats: the player mid on blue, a mid laner on red. */
function match(matchId: string, i: number): any {
  const player = (puuid: string, participantId: number, teamId: number, win: boolean) => ({
    puuid, participantId, teamId, win, championName: teamId === 100 ? 'Ahri' : 'Zed', teamPosition: 'MIDDLE',
    kills: 5 + (i % 3), deaths: 3, assists: 6, goldEarned: 11_000, totalDamageDealtToChampions: 20_000,
    totalDamageTaken: 18_000, damageDealtToObjectives: 4000, damageDealtToBuildings: 2000,
    totalMinionsKilled: 200, neutralMinionsKilled: 10, visionScore: 25, challenges: {},
  })
  return {
    metadata: { matchId },
    info: {
      gameDuration: 1800,
      gameEndTimestamp: 1_700_000_000_000 + i * 3_600_000,
      queueId: 420,
      participants: [player(PUUID, 1, 100, true), player(`enemy-${i}`, 6, 200, false)],
    },
  }
}

/** A timeline of 31 one-minute frames, padded with events (about 200 kB, a real one weighs 0.5 to 2 MB). */
function timeline(): any {
  const frames = []
  for (let m = 0; m <= 30; m++) {
    const participantFrames: Record<string, any> = {}
    for (let pid = 1; pid <= 10; pid++) {
      participantFrames[String(pid)] = {
        participantId: pid, currentGold: 300, totalGold: 500 * m, xp: 400 * m, level: Math.min(18, 1 + m),
        minionsKilled: 7 * m, jungleMinionsKilled: m, position: { x: 7000, y: 7000 },
        damageStats: { totalDamageDoneToChampions: 600 * m },
      }
    }
    const events = Array.from({ length: 60 }, (_, k) => ({ type: 'ITEM_PURCHASED', timestamp: m * 60_000 + k * 900, participantId: 1 + (k % 10), itemId: 1001 }))
    frames.push({ timestamp: m * 60_000, participantFrames, events })
  }
  return { info: { frames } }
}

const invoke = (channel: string, ...args: unknown[]) => {
  const fn = h.handlers.get(channel)
  if (!fn) throw new Error(`handler not registered: ${channel}`)
  return fn({}, ...args) as Promise<any>
}

/** Runs `fn` and counts the JSON.parse calls it makes on a timeline (the query engine's own response parsing aside). */
async function countLargeParses<T>(fn: () => Promise<T>): Promise<{ value: T; parses: number; ms: number }> {
  const original = JSON.parse
  let parses = 0
  JSON.parse = ((text: string, reviver?: any) => {
    if (typeof text === 'string' && text.startsWith('{"info":{"frames"')) parses++
    return original(text, reviver)
  }) as typeof JSON.parse
  const t0 = performance.now()
  try {
    const value = await fn()
    return { value, parses, ms: performance.now() - t0 }
  } finally {
    JSON.parse = original
  }
}

describe('detailed stats memo (LRU)', () => {
  beforeEach(() => clearDetailedStatsMemo())
  const stats = (role: string) => ({ meta: { role } }) as unknown as DetailedStats

  it('finds an entry by any of the puuids', () => {
    setMemoDetailedStats('M1', 'b', stats('MID'))
    expect(getMemoDetailedStats('M1', ['a', 'b'])?.meta.role).toBe('MID')
    expect(getMemoDetailedStats('M1', ['a'])).toBeNull()
    expect(getMemoDetailedStats('M2', ['b'])).toBeNull()
  })

  it(`keeps at most ${DETAILED_STATS_MEMO_SIZE} entries and drops the least recently used`, () => {
    for (let i = 0; i < DETAILED_STATS_MEMO_SIZE; i++) setMemoDetailedStats(`M${i}`, 'p', stats('MID'))
    getMemoDetailedStats('M0', ['p']) // M0 used again: M1 is now the oldest
    setMemoDetailedStats('NEW', 'p', stats('MID'))
    expect(detailedStatsMemoSize()).toBe(DETAILED_STATS_MEMO_SIZE)
    expect(getMemoDetailedStats('M0', ['p'])).not.toBeNull()
    expect(getMemoDetailedStats('M1', ['p'])).toBeNull()
    expect(getMemoDetailedStats('NEW', ['p'])).not.toBeNull()
  })
})

describe('stats:get-fundamentals-radar (E02)', () => {
  beforeAll(async () => {
    await initDatabase()
    registerStatsHandlers()
    const prisma = getPrisma()
    await prisma.user.create({ data: { summonerName: 'Radar', puuid: PUUID, region: 'EUW1', nextAssessmentAt: new Date() } })
    const tl = JSON.stringify(timeline())
    for (let i = 0; i < GAMES; i++) {
      const matchId = `EUW1_RADAR_${String(i).padStart(2, '0')}`
      h.matchIds.push(matchId)
      await prisma.matchCache.create({ data: { matchId, matchJson: JSON.stringify(match(matchId, i)), timelineJson: tl } })
    }
    clearDetailedStatsMemo()
  }, 60_000)

  afterAll(async () => {
    await closeDatabase()
    try { rmSync(h.root, { recursive: true, force: true }) } catch { /* Windows file lock */ }
  })

  it('parses each timeline on the first visit only, with the same result on the next one', async () => {
    const first = await countLargeParses(() => invoke('stats:get-fundamentals-radar'))
    const second = await countLargeParses(() => invoke('stats:get-fundamentals-radar'))
    console.log(`[E02] radar, ${GAMES} cached games: first visit ${first.ms.toFixed(0)} ms (${first.parses} timeline parses), next visit ${second.ms.toFixed(0)} ms (${second.parses})`)

    expect(first.value).not.toBeNull()
    expect(first.value.snapshotGameCount).toBe(GAMES)
    expect(first.parses).toBe(GAMES)
    expect(second.parses).toBe(0)
    expect(second.value).toEqual(first.value)
  })
})
