/**
 * 20/11/2026, "every game": a game played with no active session is recorded (off-session container), the real
 * platform comes from the League game log, and the start-up catch-up imports what is missing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { leagueDirsFromInstalls, parseGameLog, pickGameLogFolder } from '../../electron/main/gameLogCore'
import { latestPlatformByAccount, pickCatchUpMatches, platformOfMatchId, type CatchUpMatch } from '../../electron/main/gameCatchUpCore'

const h = vi.hoisted(() => ({ getMatchIds: [] as unknown[], getMatch: [] as string[] }))

vi.mock('../../electron/main/riotClient', () => ({
  getMatchIds: vi.fn(async (...a: unknown[]) => { h.getMatchIds.push(a); return [] }),
  getMatch: vi.fn(async (id: string) => { h.getMatch.push(id); return { metadata: { matchId: id }, info: { participants: [{ puuid: 'p-main' }] } } }),
  extractPlayerStats: vi.fn((_m: unknown, puuid: string) => (puuid === 'p-main' ? {
    champion: 'Ahri', role: 'MIDDLE', kills: 5, deaths: 2, assists: 7, cs: 180, visionScore: 20, duration: 1700,
    win: true, gameEndAt: new Date('2026-11-20T11:44:00Z'), queueType: 'soloq', opponentChampion: 'Zed',
  } : null)),
  isQueueSessionEligible: vi.fn((q: string) => q === 'soloq' || q === 'flex'),
  regionResolver: { invalidate: vi.fn() },
}))
vi.mock('../../electron/main/gameLog', () => ({ readGameLogRef: vi.fn(() => null) }))

const db = {
  active: null as null | { id: string },
  container: null as null | { id: string },
  games: [] as any[],
}
const prisma = {
  user: { findFirst: vi.fn(async () => ({ id: 'u1', puuid: 'p-main', region: 'SG2', mainRole: 'MIDDLE' })) },
  account: { findMany: vi.fn(async () => []) },
  session: {
    findFirst: vi.fn(async (args: any) => (args.where.status === 'active' ? db.active : db.container)),
    create: vi.fn(async () => { db.container = { id: 'off-1' }; return db.container }),
  },
  game: {
    create: vi.fn(async (args: any) => { const g = { id: `g${db.games.length + 1}`, ...args.data }; db.games.push(g); return g }),
    findFirst: vi.fn(async () => db.games[0] ? { ...db.games[0], session: { objectiveId: db.games[0].sessionId === 'off-1' ? '__review_only__' : 'obj' } } : null),
    findUnique: vi.fn(async () => null),
    update: vi.fn(async (args: any) => { Object.assign(db.games[0], args.data); return db.games[0] }),
  },
  matchCache: { upsert: vi.fn(async () => ({})) },
  recording: { findFirst: vi.fn(async () => null), update: vi.fn() },
}
vi.mock('../../electron/main/database', () => ({ getPrisma: () => prisma }))

import { GameDetector } from '../../electron/main/gameDetector'

const snapshot = { champion: 'Ahri', role: 'MIDDLE', kills: 5, deaths: 2, assists: 7, cs: 180, visionScore: 20, win: false, duration: 1700, gameMode: 'CLASSIC', level: 16 }

describe('a game with no active session', () => {
  beforeEach(() => { db.active = null; db.container = null; db.games = []; h.getMatch.length = 0; h.getMatchIds.length = 0 })

  it('is recorded in the off-session container, outside the session KPIs, and opens no review', async () => {
    const onGameEnd = vi.fn()
    const detector = new GameDetector(onGameEnd)
    await (detector as any).fireInstantGameEnd(snapshot, Date.parse('2026-11-20T11:28:50Z'))
    expect(db.games).toHaveLength(1)
    expect(db.games[0]).toMatchObject({ sessionId: 'off-1', isSessionEligible: false, matchId: 'live_1795174130000' })
    expect(onGameEnd).toHaveBeenCalledWith(expect.objectContaining({ sessionId: null, isSessionEligible: false, isOffRole: false }))
    expect(onGameEnd.mock.calls[0][0].game.id).toBe('g1') // the recording is linked to it at game end
  })

  it('with an active session: attached to it and counted, as before', async () => {
    db.active = { id: 's-live' }
    const onGameEnd = vi.fn()
    await (new GameDetector(onGameEnd) as any).fireInstantGameEnd(snapshot, Date.now())
    expect(db.games[0]).toMatchObject({ sessionId: 's-live', isSessionEligible: true })
    expect(onGameEnd).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 's-live', isSessionEligible: true }))
  })

  it('the enrichment keeps an off-session game out of the KPIs, even ranked', async () => {
    await (new GameDetector(() => {}) as any).fireInstantGameEnd(snapshot, 1000)
    vi.useFakeTimers()
    const done = (new GameDetector(() => {}) as any).enrichWithMatchApi(1000, null, { platform: 'EUW1', gameId: '8051837730', matchId: 'EUW1_8051837730' })
    await vi.advanceTimersByTimeAsync(10_000)
    await done
    vi.useRealTimers()
    expect(db.games[0]).toMatchObject({ matchId: 'EUW1_8051837730', queueType: 'soloq', isSessionEligible: false, win: true })
  })

  it('the game log names the match: read directly on its platform, no listing on the stored server (SG2)', async () => {
    vi.useFakeTimers()
    const done = (new GameDetector(() => {}) as any).enrichWithMatchApi(1000, null, { platform: 'EUW1', gameId: '8051837730', matchId: 'EUW1_8051837730' })
    await vi.advanceTimersByTimeAsync(10_000)
    await done
    vi.useRealTimers()
    expect(h.getMatch[0]).toBe('EUW1_8051837730')
    expect(h.getMatchIds).toHaveLength(0)
  })
})

describe('ARAM (every game)', () => {
  beforeEach(() => { db.active = { id: 's-live' }; db.games = [] })
  it('is recorded, even in a session, but never counts in its KPIs', async () => {
    const onGameEnd = vi.fn()
    await (new GameDetector(onGameEnd) as any).fireInstantGameEnd({ ...snapshot, gameMode: 'ARAM' }, Date.now())
    expect(db.games[0]).toMatchObject({ sessionId: 's-live', isSessionEligible: false })
    expect(onGameEnd).toHaveBeenCalledWith(expect.objectContaining({ isSessionEligible: false, isOffRole: false }))
  })
  it('a practice tool game is not', async () => {
    await (new GameDetector(() => {}) as any).fireInstantGameEnd({ ...snapshot, gameMode: 'PRACTICETOOL' }, Date.now())
    expect(db.games).toHaveLength(0)
  })
})

describe('League game log', () => {
  // The real line also holds the server address and a connection key: only the two ids are read.
  const line = '000000.356| ALWAYS|   CFG| Command Line:  "1.2.3.4 7411 KEY== 1" "-Product=LoL" "-GameID=8051837730" "-Region=EUW" "-PlatformID=EUW1" "-Locale=en_US"'

  it('gives the real match id', () => {
    expect(parseGameLog(line)).toEqual({ platform: 'EUW1', gameId: '8051837730', matchId: 'EUW1_8051837730' })
    expect(parseGameLog('000002.651| ALWAYS| GameStartData::GameID=184805084 "-PlatformID=SG2"')).toMatchObject({ matchId: 'SG2_184805084' })
    expect(parseGameLog('no ids here')).toBeNull()
    expect(parseGameLog('"-PlatformID=MARS1" "-GameID=123456"')).toBeNull()
  })

  it('finds the install from RiotClientInstalls.json and the folder of the game', () => {
    expect(leagueDirsFromInstalls({ associated_client: { 'D:/lol/Riot Games/League of Legends/': 'C:/x.exe', 'C:/Valorant/': 'C:/y.exe' } }))
      .toEqual(['D:/lol/Riot Games/League of Legends'])
    expect(leagueDirsFromInstalls(null)).toEqual([])
    const start = Date.parse('2026-11-20T11:28:42Z')
    expect(pickGameLogFolder([
      { name: '2026-11-18T05-19-00', mtimeMs: start - 2 * 86_400_000 },
      { name: '2026-11-20T15-28-42', mtimeMs: start + 16 * 60_000 },
      { name: 'not-a-game', mtimeMs: start + 20 * 60_000 },
    ], start)).toBe('2026-11-20T15-28-42')
    expect(pickGameLogFolder([{ name: '2026-11-18T05-19-00', mtimeMs: start - 86_400_000 }], start)).toBeNull()
  })
})

describe('start-up catch-up', () => {
  const NOW = Date.parse('2026-11-20T12:30:00Z')
  const since = NOW - 3 * 86_400_000
  const match = (matchId: string, puuid: string, endIso: string, extra: Partial<{ queueId: number; gameDuration: number }> = {}): CatchUpMatch => ({
    matchId,
    data: { info: { participants: [{ puuid }, { puuid: 'someone' }], gameEndTimestamp: Date.parse(endIso), gameDuration: 1600, queueId: 420, ...extra } },
  })

  it('SG2 → EUW1 transfer: today\'s EUW1 game is imported and tells the account plays on EUW1', () => {
    const matches = [match('EUW1_8051837730', 'p-main', '2026-11-20T11:44:00Z'), match('EUW1_8049815258', 'p-main', '2026-11-18T00:30:00Z', { queueId: 440 })]
    const picks = pickCatchUpMatches({ matches, puuids: ['p-main'], localMatchIds: new Set(), provisionalEndsMs: [], sinceMs: since })
    expect(picks.map((p) => p.matchId)).toEqual(['EUW1_8051837730', 'EUW1_8049815258'])
    expect(latestPlatformByAccount(picks).get('p-main')).toBe('EUW1')
  })

  it('two accounts on two servers: each game goes to the account that played it, each keeps its server', () => {
    const matches = [match('EUW1_8051837730', 'p-euw', '2026-11-20T11:44:00Z'), match('SG2_184900000', 'p-sg', '2026-11-19T10:00:00Z')]
    const picks = pickCatchUpMatches({ matches, puuids: ['p-euw', 'p-sg'], localMatchIds: new Set(), provisionalEndsMs: [], sinceMs: since })
    expect(picks.map((p) => [p.matchId, p.puuid])).toEqual([['EUW1_8051837730', 'p-euw'], ['SG2_184900000', 'p-sg']])
    const latest = latestPlatformByAccount(picks)
    expect([latest.get('p-euw'), latest.get('p-sg')]).toEqual(['EUW1', 'SG2'])
  })

  it('skips what is local, too old, a remake, an untracked queue, someone else\'s, or covered by a provisional game', () => {
    const picks = pickCatchUpMatches({
      matches: [
        match('EUW1_1', 'p', '2026-11-20T10:00:00Z'), // local already
        match('EUW1_2', 'p', '2026-11-10T10:00:00Z'), // older than 3 days
        match('EUW1_3', 'p', '2026-11-20T09:00:00Z', { gameDuration: 200 }), // remake
        match('EUW1_4', 'p', '2026-11-20T08:00:00Z', { queueId: 2000 }), // tutorial
        match('EUW1_5', 'stranger', '2026-11-20T07:00:00Z'),
        match('EUW1_6', 'p', '2026-11-20T06:00:00Z'), // a live_ game ended 3 min later
        match('EUW1_7', 'p', '2026-11-20T05:00:00Z'),
        match('EUW1_7', 'p', '2026-11-20T05:00:00Z'), // listed twice (game log + match list)
      ],
      puuids: ['p'],
      localMatchIds: new Set(['EUW1_1']),
      provisionalEndsMs: [Date.parse('2026-11-20T06:03:00Z')],
      sinceMs: since,
    })
    expect(picks.map((p) => p.matchId)).toEqual(['EUW1_7'])
  })

  it('every game the live detection records: ARAM, Swiftplay and customs too', () => {
    const picks = pickCatchUpMatches({
      matches: [
        match('EUW1_10', 'p', '2026-11-20T10:00:00Z', { queueId: 450 }),
        match('EUW1_11', 'p', '2026-11-20T09:00:00Z', { queueId: 480 }),
        match('EUW1_12', 'p', '2026-11-20T08:00:00Z', { queueId: 0 }),
        match('EUW1_13', 'p', '2026-11-20T07:00:00Z', { queueId: 1700 }),
      ],
      puuids: ['p'], localMatchIds: new Set(), provisionalEndsMs: [], sinceMs: since,
    })
    expect(picks.map((p) => p.matchId)).toEqual(['EUW1_10', 'EUW1_11', 'EUW1_12', 'EUW1_13'])
  })

  it('reads the platform from the match id', () => {
    expect(platformOfMatchId('EUW1_8051837730')).toBe('EUW1')
    expect(platformOfMatchId('SG2_1')).toBe('SG2')
  })
})

afterEach(() => { vi.useRealTimers() })
