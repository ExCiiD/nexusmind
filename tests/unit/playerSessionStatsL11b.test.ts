import { describe, it, expect } from 'vitest'
import {
  attachBaseline, baseline30dFromAverages, buildHighlights, buildObjectiveParticipation, buildPlayerGameStats, buildPlayerSessionStats,
  buildSoloPlayerSessionStats, extrasOf, ISOLATION_DISTANCE, type Baseline30d, type TimelinePlayers, type TimelinePlayerSeries,
} from '../../src/lib/playerSessionStatsCore'
import { extractTeamTimeline, hasCurrentPlayers, PLAYERS_BLOCK_VERSION, TEAM_TIMELINE_VERSION } from '../../src/lib/teamTimelineCore'

const ROLES = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY']
const members = ROLES.map((_, i) => ({ userId: `u${i + 1}`, riotId: `Blue${i + 1}#EUW`, displayName: `Blue${i + 1}` }))
const far = ISOLATION_DISTANCE * 3

function participant(pid: number, over: Record<string, unknown> = {}) {
  const team = pid <= 5 ? 100 : 200
  const idx = (pid - 1) % 5
  return {
    participantId: pid, puuid: `p${pid}`, teamId: team, teamPosition: ROLES[idx], championName: `Champ${pid}`,
    riotIdGameName: `${team === 100 ? 'Blue' : 'Red'}${idx + 1}`, kills: 2, deaths: 2, assists: 4, win: team === 100,
    totalMinionsKilled: 200, neutralMinionsKilled: 10, totalDamageDealtToChampions: 20000, totalDamageTaken: 15000,
    timeCCingOthers: 10, visionScore: 20, goldEarned: 12000, champExperience: 14000, ...over,
  }
}
const match = (over: Record<number, Record<string, unknown>> = {}, duration = 1800) => ({
  info: { gameDuration: duration, gameStartTimestamp: 1, participants: Array.from({ length: 10 }, (_, i) => participant(i + 1, over[i + 1])) },
})

/** Standing at (x, y), `minutes + 1` frames; cs / level linear. */
const series = (pid: number, x: number, y: number, o: { gold?: number; xp?: number; cs?: number; v2?: boolean } = {}): TimelinePlayerSeries => ({
  pid, teamId: pid <= 5 ? 100 : 200,
  xp: Array.from({ length: 31 }, (_, m) => (o.xp ?? 800) * m), gold: Array.from({ length: 31 }, (_, m) => (o.gold ?? 1000) * m),
  ...(o.v2 === false ? {} : { lvl: Array.from({ length: 31 }, (_, m) => Math.min(18, 1 + Math.floor(m / 2))), cs: Array.from({ length: 31 }, (_, m) => (o.cs ?? 8) * m) }),
  ...(pid <= 5 ? { x: Array(31).fill(x), y: Array(31).fill(y) } : {}),
})
const kill = (tSec: number, killer: number, victim: number, x: number | null, y: number | null, assists: number[] = []) => ({ t: tSec * 1000, killer, victim, assists, x, y })
const all = (mod: Record<number, TimelinePlayerSeries> = {}) => [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((pid) => mod[pid] ?? series(pid, pid <= 5 ? 0 : far, 0))
const summary = (players: TimelinePlayers) => ({ version: TEAM_TIMELINE_VERSION, events: [], goldDiffByMinute: [0], players })
const game = (id: string, tp: TimelinePlayers | null, m: unknown = match(), extra: object = {}) =>
  ({ id, matchId: `EUW1_${id}`, matchJson: m, ourTeamId: 100 as const, timelineSummary: tp ? summary(tp) : null, ...extra })
const v2 = (p: Omit<TimelinePlayers, 'v'>): TimelinePlayers => ({ v: PLAYERS_BLOCK_VERSION, ...p })
const top = (rows: ReturnType<typeof buildPlayerGameStats>) => rows.find((r) => r.memberId === 'u1')!

describe('diff series and lane summary', () => {
  const mod = { 1: series(1, 0, 0, { gold: 1200, xp: 900, cs: 9 }), 6: series(6, far, 0, { gold: 1000, xp: 800, cs: 7 }) }
  const tp = v2({ players: all(mod), kills: [], objectives: [] })

  it('per-minute gaps against the lane opponent, level and CS at 10 / 15', () => {
    const r = top(buildPlayerGameStats(game('g1', tp), 1, members))
    expect(r.timelineStatus).toBe('ready')
    expect(r.diffSeries!.gold).toHaveLength(31)
    expect(r.diffSeries!.gold[0]).toBe(0)
    expect(r.diffSeries!.gold[10]).toBe(2000)
    expect(r.diffSeries!.xp[15]).toBe(1500)
    expect(r.diffSeries!.cs[10]).toBe(20)
    expect(r.laneSummary!.source).toBe('timeline')
    expect(r.laneSummary!.at10).toMatchObject({ minute: 10, player: { cs: 90, gold: 12000, xp: 9000, level: 6 }, opponent: { cs: 70, gold: 10000 }, diff: { cs: 20, gold: 2000, xp: 1000, level: 0 } })
    expect(r.laneSummary!.at15.diff!.gold).toBe(3000)
  })

  it('a minute one side lacks is null, never 0', () => {
    const short = { ...series(6, far, 0), gold: [0, 1000, 2000], xp: [0, 800, 1600] }
    const r = top(buildPlayerGameStats(game('g1', v2({ players: all({ 6: short }), kills: [], objectives: [] })), 1, members))
    expect(r.diffSeries!.gold.slice(0, 4)).toEqual([0, 0, 0, null])
    expect(r.laneSummary!.at15.diff).toMatchObject({ gold: null, xp: null })
    expect(r.laneSummary!.at15.player.gold).toBe(15000)
  })

  it('an older block (no levels / CS): gold and xp known, cs and level null, status no-players', () => {
    const old = { players: all({ 1: series(1, 0, 0, { v2: false }), 6: series(6, far, 0, { v2: false }) }), kills: [] }
    const r = top(buildPlayerGameStats(game('g1', old), 1, members))
    expect(r.timelineStatus).toBe('no-players')
    expect(r.laneSummary!.at10.player).toEqual({ cs: null, gold: 10000, xp: 8000, level: null })
    expect(r.laneSummary!.at10.diff).toEqual({ cs: null, gold: 0, xp: 0, level: null })
    expect(r.objectives).toBeNull()
    expect(r.diffSeries!.cs.every((v) => v === null)).toBe(true)
  })

  it('no timeline: everything timeline-based is null; the stored lane report fills the lane summary', () => {
    const report = { framesByMinute: [10, 15].map((minute) => ({ minute, cs: { player: 80, opponent: 70, diff: 10 }, gold: { player: 4000, opponent: 3500, diff: 500 }, xp: { player: 5000, opponent: 4800, diff: 200 }, level: { player: 8, opponent: 7, diff: 1 } })) }
    const bare = top(buildPlayerGameStats(game('g1', null), 1, members))
    expect(bare).toMatchObject({ timelineStatus: 'no-timeline', diffSeries: null, deathEvents: null, killEvents: null, objectives: null, laneSummary: null })
    const withReport = top(buildPlayerGameStats(game('g1', null, match(), { lanePhaseReport: report }), 1, members))
    expect(withReport.laneSummary).toMatchObject({ source: 'lane-report', at15: { diff: { gold: 500, level: 1 } } })
    expect(withReport.diffSeries).toBeNull()
  })
})

describe('death and kill events', () => {
  const players = all({ 1: series(1, 0, 0), 2: series(2, 100, 0), 3: series(3, far, far), 4: series(4, far, far), 5: series(5, far, far) })
  const tp = v2({
    players, objectives: [],
    kills: [
      kill(305, 6, 1, 3500, 3500, [7, 8]),    // 5:05, mid lane, enemy champ 6 + 2 assists, nobody within 2500 → isolated
      kill(900, 7, 1, null, null),            // 15:00, no position
      kill(1260, 1, 9, 50, 50, [2]),          // a kill at 21:00 next to teammate 2 → not isolated
      kill(1300, 0, 1, 14000, 14000),         // an execution: killer 0
    ],
  })
  const r = top(buildPlayerGameStats(game('g1', tp), 3, members))

  it('keeps time, clock, zone, early, isolated, who and a VOD timestamp', () => {
    expect(r.deathEvents).toHaveLength(3)
    expect(r.deathEvents![0]).toMatchObject({
      gameId: 'g1', gameIndex: 3, atSec: 305, clock: '5:05', x: 3500, y: 3500, zone: 'mid-lane', early: true, isolated: true,
      otherChampion: 'Champ6', assisters: 2, vodSeekSec: 295,
    })
    expect(r.deathEvents![1]).toMatchObject({ atSec: 900, zone: null, isolated: null, early: false })
    expect(r.deathEvents![2].otherChampion).toBeNull()
    expect(r.killEvents).toHaveLength(1)
    expect(r.killEvents![0]).toMatchObject({ atSec: 1260, clock: '21:00', otherChampion: 'Champ9', assisters: 1, isolated: false, zone: 'own-base' })
  })

  it('a player with no death gets [] (not null) once the timeline is read', () => {
    const quiet = buildPlayerGameStats(game('g1', tp), 1, members).find((x) => x.memberId === 'u3')!
    expect(quiet.deathEvents).toEqual([])
    expect(quiet.killEvents).toEqual([])
  })
})

describe('objectives participation', () => {
  const tp = v2({
    players: all(), kills: [],
    objectives: [
      { t: 300_000, kind: 'grubs', teamId: 100, killer: 1, assists: [2] },
      { t: 310_000, kind: 'grubs', teamId: 100, killer: 2, assists: [1, 3] },
      { t: 700_000, kind: 'dragon', teamId: 200, killer: 7, assists: [], subType: 'FIRE' },
      { t: 800_000, kind: 'tower', teamId: 100, killer: 3, assists: [1], lane: 'TOP' },
      { t: 1_500_000, kind: 'baron', teamId: 100, killer: 4, assists: [5] },
    ],
  })
  it('counts ours / participated / killed / theirs per kind and lists the events', () => {
    const o = buildObjectiveParticipation(tp, 1, 100)!
    expect(o.byKind.map((l) => l.kind)).toEqual(['dragon', 'elder', 'grubs', 'herald', 'baron', 'tower'])
    expect(o.byKind.find((l) => l.kind === 'grubs')).toMatchObject({ kind: 'grubs', ours: 2, participated: 2, killed: 1, theirs: 0, theirsPresent: 0 })
    expect(o.byKind.find((l) => l.kind === 'dragon')).toMatchObject({ kind: 'dragon', ours: 0, participated: 0, killed: 0, theirs: 1 })
    expect(o.byKind.find((l) => l.kind === 'tower')).toMatchObject({ ours: 1, participated: 1, killed: 0 })
    expect(o.byKind.find((l) => l.kind === 'baron')).toMatchObject({ ours: 1, participated: 0 })
    expect(o.events[2]).toMatchObject({ kind: 'dragon', ours: false, participated: false, subType: 'FIRE', clock: '11:40' })
    expect(o.events[3]).toMatchObject({ kind: 'tower', lane: 'TOP', vodSeekSec: 790 })
  })
  it('null without the objectives list (older block)', () => {
    expect(buildObjectiveParticipation({ players: [], kills: [] }, 1, 100)).toBeNull()
  })
})

describe('extras', () => {
  it('reads the match; a field Riot omits is null', () => {
    const e = extrasOf({
      ...participant(1), challenges: { soloKills: 2, effectiveHealAndShielding: 800 }, firstBloodKill: false, firstBloodAssist: true,
      largestMultiKill: 3, doubleKills: 1, totalTimeSpentDead: 180, damageDealtToObjectives: 9000, visionScore: 30,
    } as any, 1800)
    expect(e).toMatchObject({ soloKills: 2, firstBloodInvolved: true, largestMultiKill: 3, doubleKills: 1, tripleKills: null, pentaKills: null,
      timeDeadSec: 180, timeDeadPct: 10, damageToObjectives: 9000, damageToTurrets: null, healAndShield: 800, visionPerMin: 1 })
    expect(extrasOf(participant(1) as any, 1800)).toMatchObject({ soloKills: null, firstBloodInvolved: null, timeDeadSec: null, timeDeadPct: null, healAndShield: null })
  })
})

describe('highlights', () => {
  const tp = v2({ players: all({ 1: series(1, 0, 0, { gold: 1400, cs: 9 }), 6: series(6, far, 0, { gold: 1000, cs: 7 }) }), kills: [kill(100, 6, 1, 1, 1), kill(200, 6, 1, 1, 1)], objectives: [] })
  const m = match({ 1: { kills: 6, deaths: 6, goldEarned: 16000 }, 6: { goldEarned: 12000 } })
  const r = top(buildPlayerGameStats(game('g1', tp, m), 1, members))

  it('against the lane opponent: strengths and weaknesses from the numbers, none when close', () => {
    expect(r.highlights.strengths.map((h) => h.id)).toEqual(expect.arrayContaining(['goldPerMin', 'goldDiff15']))
    expect(r.highlights.weaknesses.map((h) => h.id)).toEqual(expect.arrayContaining(['deaths', 'deathsBefore14']))
    expect(r.highlights.strengths.find((h) => h.id === 'goldPerMin')).toMatchObject({ referenceSource: 'opponent' })
    expect(r.highlights.strengths.find((h) => h.id === 'goldDiff15')).toMatchObject({ referenceSource: 'even', deltaPct: null, reference: 0 })
    const even = top(buildPlayerGameStats(game('g1', null), 1, members))
    expect(even.highlights).toEqual({ strengths: [], weaknesses: [] })
  })

  it('compares with the 30-day baseline once attached, for the signed-in player only', () => {
    const s = buildPlayerSessionStats([game('g1', tp, m)], members)
    const base: Baseline30d = { ...baseline30dFromAverages({ meta: { gameCount: 12, winRate: 50, avgKills: 5, avgDeaths: 5, avgAssists: 5, avgVisionScore: 20 }, economy: { csPerMin: 7, goldPerMin: 400, xpPerMin: 450 }, combat: {}, laning: { goldDiff15: 100 } }, 'a', 'b')! }
    const out = attachBaseline(s, 'u1', base)
    const mine = out.find((x) => x.memberId === 'u1')!, mate = out.find((x) => x.memberId === 'u2')!
    expect(mine.avg30d).toBe(base)
    expect(mate.avg30d).toBeNull()
    expect(mate).toBe(s.find((x) => x.memberId === 'u2'))
    expect(mine.games[0].highlights.strengths.find((h) => h.id === 'goldPerMin')).toMatchObject({ referenceSource: '30d', reference: 400 })
    expect(mine.highlights.strengths.map((h) => h.id)).toContain('goldPerMin')
    expect(attachBaseline(s, 'u1', null)).toBe(s)
  })

  it('buildHighlights caps at three each, strongest first', () => {
    const base = top(buildPlayerGameStats(game('g1', null), 1, members)).base
    const ref = (k: number) => ({ ...base, averages: Object.fromEntries(Object.entries(base.averages).map(([n, v]) => [n, v * k])) as typeof base.averages, shares: base.shares })
    const h = buildHighlights({ base: ref(2), opponent: ref(1), goldDiff15: null, csDiff15: null, deathsBefore14: null, isolatedDeaths: null }, null)
    expect(h.strengths.length).toBe(3)
    expect(h.weaknesses.map((x) => x.id)).toEqual(['deaths'])
  })
})

describe('whole session aggregates', () => {
  const g1 = game('g1', v2({
    players: all({ 1: series(1, 0, 0, { gold: 1200 }), 6: series(6, far, 0, { gold: 1000 }) }),
    kills: [kill(100, 6, 1, 7000, 7000), kill(900, 7, 1, 0, 0)], objectives: [{ t: 300_000, kind: 'grubs', teamId: 100, killer: 1, assists: [] }],
  }), match({ 1: { challenges: { soloKills: 1 }, doubleKills: 1 } }))
  const g2 = game('g2', v2({ players: all(), kills: [], objectives: [{ t: 300_000, kind: 'grubs', teamId: 100, killer: 2, assists: [1] }] }), match({ 1: { challenges: { soloKills: 2 }, doubleKills: 2 } }))
  const g3 = game('g3', null, match({ 1: { challenges: { soloKills: 4 } } }))
  const s = buildPlayerSessionStats([g1, g2, g3], members).find((x) => x.memberId === 'u1')!

  it('sums, means and concatenates', () => {
    expect(s).toMatchObject({ source: 'team', gamesCounted: 3, avg30d: null })
    expect(s.total.gamesWithTimeline).toBe(2)
    expect(s.total.gamesWithObjectives).toBe(2)
    expect(s.total.objectives!.find((l) => l.kind === 'grubs')).toMatchObject({ ours: 2, participated: 2, killed: 1 })
    expect(s.deathEvents!.map((e) => [e.gameIndex, e.atSec])).toEqual([[1, 100], [1, 900]])
    expect(s.total.deaths).toMatchObject({ total: 2, early: 1, judged: 2 })
    expect(s.total.deaths!.byZone).toEqual({ 'mid-lane': 1, 'own-base': 1 })
    expect(s.total.extras).toMatchObject({ soloKills: 7, doubleKills: 3 })
    expect(s.total.diffSeries!.gold[10]).toBe(1000) // g1 +2000, g2 0 → mean over the 2 games that have the minute
    expect(s.total.laneSummary!.at10.diff!.gold).toBe(1000)
    expect(s.games[2].timelineStatus).toBe('no-timeline')
  })
  it('a session with no timeline at all has null events, not []', () => {
    const none = buildPlayerSessionStats([g3], members).find((x) => x.memberId === 'u1')!
    expect(none.deathEvents).toBeNull()
    expect(none.total).toMatchObject({ deaths: null, kills: null, objectives: null, diffSeries: null, laneSummary: null })
  })
  it('lists games without a match or a side', () => {
    const out = buildPlayerSessionStats([g1, game('bad', null, null), { ...game('x', null), ourTeamId: null, matchJson: { info: { gameDuration: 1800, participants: match().info.participants.map((p) => ({ ...p, riotIdGameName: `Z${p.participantId}` })) } } }], members)
    expect(out[0].unavailableGames).toEqual([{ gameId: 'bad', gameIndex: 2, reason: 'no-match' }, { gameId: 'x', gameIndex: 3, reason: 'no-side' }])
  })
})

describe('the extraction (teamTimelineCore)', () => {
  it('stores level, CS and the objective events with their killer and assists, and is a current block', () => {
    const frames = [0, 1].map((m) => ({
      participantFrames: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [String(i + 1), { participantId: i + 1, totalGold: 500 * m, xp: 100 * m, level: 1 + m, minionsKilled: 5 * m, jungleMinionsKilled: m, position: { x: 10, y: 20 } }])),
      events: m === 1 ? [
        { type: 'ELITE_MONSTER_KILL', timestamp: 61_000, killerId: 1, killerTeamId: 100, monsterType: 'HORDE', assistingParticipantIds: [2] },
        { type: 'BUILDING_KILL', timestamp: 62_000, buildingType: 'TOWER_BUILDING', teamId: 200, killerId: 3, laneType: 'TOP_LANE', towerType: 'OUTER_TURRET', assistingParticipantIds: [] },
        { type: 'CHAMPION_KILL', timestamp: 63_000, killerId: 6, victimId: 1, assistingParticipantIds: [], position: { x: 1, y: 2 } },
      ] : [],
    }))
    const m = match()
    const out = extractTeamTimeline(m, { info: { frames } }, { gameId: 'g', matchId: 'm', source: 'scrim', ourTeamId: 100, opponentName: null })!
    expect(hasCurrentPlayers(out)).toBe(true)
    expect(out.players!.players.find((p) => p.pid === 1)).toMatchObject({ lvl: [1, 2], cs: [0, 6] })
    expect(out.players!.objectives).toEqual([
      { t: 61_000, kind: 'grubs', teamId: 100, killer: 1, assists: [2] },
      { t: 62_000, kind: 'tower', teamId: 100, killer: 3, assists: [], lane: 'TOP' },
    ])
    expect(hasCurrentPlayers({ ...out, players: { ...out.players!, v: undefined } })).toBe(false)
  })
})

describe('baseline from the Dashboard averages', () => {
  it('maps the names, derives the KDA from the means, null without games', () => {
    const b = baseline30dFromAverages({
      meta: { gameCount: 10, winRate: 60, avgKills: 6, avgDeaths: 3, avgAssists: 6, avgVisionScore: 25 },
      economy: { csPerMin: 7.1, goldPerMin: 410, xpPerMin: 430 }, combat: { damagePerMin: 600, killParticipation: 62, teamDamagePercent: 24 },
      laning: { goldDiff15: 120, csDiff15: 3, xpDiff15: null },
    }, '2026-10-27', '2026-11-26')!
    expect(b).toMatchObject({ source: 'dashboard', games: 10, kda: 4, csPerMin: 7.1, kpPct: 62, damagePct: 24, visionScore: 25, goldDiff15: 120, xpDiff15: null })
    expect(baseline30dFromAverages({ meta: { gameCount: 0 } }, 'a', 'b')).toBeNull()
    expect(baseline30dFromAverages(null, 'a', 'b')).toBeNull()
  })
})

describe('solo session', () => {
  const self = { userId: 'me', displayName: 'Me#EUW', puuids: ['p1', 'p-alt'] }
  const tp = v2({ players: all({ 1: series(1, 0, 0), 6: series(6, far, 0) }), kills: [kill(100, 6, 1, 7000, 7000)], objectives: [] })
  const asRed = match() // the player's account is on red in this one
  asRed.info.participants.forEach((p: any) => { p.puuid = p.teamId === 100 ? `x${p.participantId}` : p.puuid === 'p6' ? 'p-alt' : p.puuid })
  const games = [
    { ...game('late', tp), ourTeamId: null, playedAt: '2026-11-26T12:00:00Z' },
    { ...game('early', null), ourTeamId: null, playedAt: '2026-11-26T10:00:00Z' },
    { ...game('red', null, asRed), ourTeamId: null, playedAt: '2026-11-26T11:00:00Z' },
    { ...game('stranger', null, match()), ourTeamId: null, playedAt: '2026-11-26T09:00:00Z' },
  ]
  // 'stranger' keeps p1 on someone else: remove the player from it entirely.
  ;(games[3].matchJson as ReturnType<typeof match>).info.participants.forEach((p: any) => { p.puuid = `o${p.participantId}` })
  const out = buildSoloPlayerSessionStats(games, self)

  it('the same shape as a team session, for the signed-in player, in played order', () => {
    expect(out).toHaveLength(1)
    const s = out[0]
    expect(s).toMatchObject({ source: 'solo', memberId: 'me', displayName: 'Me#EUW', gamesCounted: 3 })
    expect(s.games.map((g) => [g.gameId, g.gameIndex])).toEqual([['early', 2], ['red', 3], ['late', 4]])
    expect(s.unavailableGames).toEqual([{ gameId: 'stranger', gameIndex: 1, reason: 'not-a-player' }])
  })
  it('timeline figures when cached, null (never 0) when not; the right side for each game', () => {
    const s = out[0]
    const late = s.games.find((g) => g.gameId === 'late')!, early = s.games.find((g) => g.gameId === 'early')!, red = s.games.find((g) => g.gameId === 'red')!
    expect(late.timelineStatus).toBe('ready')
    expect(late.deathEvents).toHaveLength(1)
    expect(late.vsOpponent!.opponentName).toBe('Red1')
    expect(early).toMatchObject({ timelineStatus: 'no-timeline', deathEvents: null, laneSummary: null })
    expect(early.vsOpponent!.end.goldDiff).toBe(0) // match-only figures stay known
    expect(red.win).toBe(false)
    expect(red.vsOpponent!.opponentName).toBe('Blue1')
    expect(s.total.gamesWithTimeline).toBe(1)
    expect(s.total.deaths).toMatchObject({ total: 1 })
  })
  it('no game of the player: nothing', () => {
    expect(buildSoloPlayerSessionStats([games[3]], self)).toEqual([])
    expect(buildSoloPlayerSessionStats([], self)).toEqual([])
  })
})
