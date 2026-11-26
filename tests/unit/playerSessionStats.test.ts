import { describe, it, expect } from 'vitest'
import {
  buildPlayerGameStats, buildPlayerRadar, buildPlayerSessionStats, isIsolated, positionAt, ISOLATION_DISTANCE,
  type TimelinePlayers, type TimelinePlayerSeries,
} from '../../src/lib/playerSessionStatsCore'
import { extractTeamTimeline, TEAM_TIMELINE_VERSION } from '../../src/lib/teamTimelineCore'
import { buildSideStats } from '../../src/lib/teamSessionStatsCore'

const ROLES = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY']
const members = ROLES.map((_, i) => ({ userId: `u${i + 1}`, riotId: `Blue${i + 1}#EUW`, displayName: `Blue${i + 1}` }))

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
  info: { gameDuration: duration, gameStartTimestamp: 1, queueId: 700, participants: Array.from({ length: 10 }, (_, i) => participant(i + 1, over[i + 1])) },
})

/** Series for a player standing at (x, y) the whole game, `minutes + 1` frames. */
const series = (pid: number, x: number, y: number, minutes = 30, gold = 1000, xp = 800): TimelinePlayerSeries => ({
  pid, teamId: pid <= 5 ? 100 : 200,
  xp: Array.from({ length: minutes + 1 }, (_, m) => xp * m), gold: Array.from({ length: minutes + 1 }, (_, m) => gold * m),
  ...(pid <= 5 ? { x: Array(minutes + 1).fill(x), y: Array(minutes + 1).fill(y) } : {}),
})
const kill = (tSec: number, killer: number, victim: number, x: number, y: number) => ({ t: tSec * 1000, killer, victim, assists: [], x, y })

function game(players: TimelinePlayers | null | undefined, m = match()) {
  const timelineSummary = players
    ? { version: TEAM_TIMELINE_VERSION, events: [], goldDiffByMinute: [0], players: { v: 2, objectives: [], ...players } }
    : { version: TEAM_TIMELINE_VERSION, events: [], goldDiffByMinute: [0] }
  return { id: 'g1', matchId: 'EUW1_1', matchJson: m, ourTeamId: 100 as const, timelineSummary: players === undefined ? null : timelineSummary }
}
const pidSeries = (positions: Record<number, [number, number]>) =>
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((pid) => series(pid, ...(positions[pid] ?? [0, 0])))

describe('positions', () => {
  it('interpolates between the two minute frames around the time', () => {
    const s: TimelinePlayerSeries = { pid: 1, teamId: 100, xp: [0, 0], gold: [0, 0], x: [0, 1000], y: [0, 2000] }
    expect(positionAt(s, 30_000)).toEqual({ x: 500, y: 1000 })
    expect(positionAt(s, 999_999)).toEqual({ x: 1000, y: 2000 }) // clamped to the last frame
    expect(positionAt({ ...s, x: undefined, y: undefined }, 0)).toBeNull()
  })
})

describe('isolation', () => {
  const near = ISOLATION_DISTANCE - 1, far = ISOLATION_DISTANCE + 1
  it('is not isolated with a living teammate within D, isolated beyond', () => {
    const tp = { players: pidSeries({ 1: [0, 0], 2: [near, 0], 3: [far * 3, 0], 4: [far * 3, 0], 5: [far * 3, 0] }), kills: [] }
    expect(isIsolated(tp, [1, 2, 3, 4, 5], 1, 20 * 60_000, 0, 0)).toBe(false)
    const tp2 = { players: pidSeries({ 1: [0, 0], 2: [far, 0], 3: [far * 3, 0], 4: [far * 3, 0], 5: [far * 3, 0] }), kills: [] }
    expect(isIsolated(tp2, [1, 2, 3, 4, 5], 1, 20 * 60_000, 0, 0)).toBe(true)
  })
  it('ignores a dead teammate, even standing next to the fight', () => {
    const players = pidSeries({ 1: [0, 0], 2: [100, 0], 3: [far * 3, 0], 4: [far * 3, 0], 5: [far * 3, 0] })
    const tp = { players, kills: [kill(19 * 60 + 50, 7, 2, 100, 0)] } // teammate 2 died 10 s before
    expect(isIsolated(tp, [1, 2, 3, 4, 5], 1, 20 * 60_000, 0, 0)).toBe(true)
    // …but is back long after the respawn delay.
    expect(isIsolated({ players, kills: [kill(10 * 60, 7, 2, 100, 0)] }, [1, 2, 3, 4, 5], 1, 20 * 60_000, 0, 0)).toBe(false)
  })
  it('is null without positions', () => {
    const tp = { players: pidSeries({}).map((p) => ({ ...p, x: undefined, y: undefined })), kills: [] }
    expect(isIsolated(tp, [1, 2, 3, 4, 5], 1, 0, 0, 0)).toBeNull()
  })
})

describe('per-game stats', () => {
  const far = ISOLATION_DISTANCE * 3
  // Player 1 (u1, TOP): dies at 5:00 (early), 14:00 exactly with no one near (isolated), 20:00 next to a teammate,
  // kills at 21:00 alone and at 22:00 next to a teammate, and an execution (killer 0) that must be ignored.
  const kills = [
    kill(300, 6, 1, 0, 0),
    kill(839, 6, 1, 0, 0),       // 13:59 → still early
    kill(840, 6, 1, 0, 0),       // 14:00 → counts as after 14, isolated
    kill(1200, 6, 1, 100, 100),  // teammate 2 is standing at (150,100)
    kill(1260, 1, 6, 0, 0),      // isolated kill… teammate 2 is at (150,100) though → NOT isolated (see positions below)
    kill(1320, 1, 7, far, far),  // isolated kill, far from everyone
    kill(1380, 0, 8, far, far),  // execution: ignored
  ]
  const positions = { 1: [0, 0], 2: [150, 100], 3: [far * 2, 0], 4: [far * 2, 0], 5: [far * 2, 0] } as Record<number, [number, number]>
  const tp: TimelinePlayers = { players: pidSeries(positions), kills }

  it('counts deaths before 14:00 (840 s) and isolated deaths / kills', () => {
    const rows = buildPlayerGameStats(game(tp), 1, members)
    const top = rows.find((r) => r.memberId === 'u1')!
    expect(rows).toHaveLength(5)
    expect(top.timelineStatus).toBe('ready')
    expect(top.deathsBefore14).toBe(2)          // 5:00 and 13:59
    // 14:00 death: teammate 2 at (150,100) is within D of (0,0): not isolated. Same for 20:00. Make it explicit:
    expect(top.isolatedDeathsAfter14).toBe(0)
    expect(top.isolatedKills).toBe(1)           // only the one at (far, far); the execution is ignored
  })

  it('judges isolation with everyone far away', () => {
    const alone = { players: pidSeries({ 1: [0, 0], 2: [far, 0], 3: [far, 0], 4: [far, 0], 5: [far, 0] }), kills }
    const top = buildPlayerGameStats(game(alone), 1, members).find((r) => r.memberId === 'u1')!
    expect(top.isolatedDeathsAfter14).toBe(2)   // 14:00 and 20:00
    expect(top.isolatedKills).toBe(2)           // 21:00 and 22:00
  })

  it('gives null (never 0) for timeline figures without a timeline or without players', () => {
    for (const g of [game(undefined), game(null)]) {
      const r = buildPlayerGameStats(g, 1, members).find((x) => x.memberId === 'u1')!
      expect(r.deathsBefore14).toBeNull()
      expect(r.isolatedDeathsAfter14).toBeNull()
      expect(r.isolatedKills).toBeNull()
      expect(r.vsOpponent!.at10).toEqual({ goldDiff: null, xpDiff: null })
      expect(r.vsOpponent!.at15).toEqual({ goldDiff: null, xpDiff: null })
      // Match-only figures stay known.
      expect(r.vsOpponent!.end.goldDiff).toBe(0)
      expect(r.goldVsTeamAvgPct).toBeCloseTo(0)
    }
    expect(buildPlayerGameStats(game(undefined), 1, members)[0].timelineStatus).toBe('no-timeline')
    expect(buildPlayerGameStats(game(null), 1, members)[0].timelineStatus).toBe('no-players')
  })

  it('diffs against the lane opponent at 10 / 15 / end', () => {
    const ps = pidSeries(positions)
    ps[0] = series(1, 0, 0, 30, 1200, 900)   // player 1: +200 gold/min, +100 xp/min vs 1000/800
    ps[5] = series(6, 0, 0, 30, 1000, 800)   // opponent (red TOP)
    const m = match({ 1: { goldEarned: 15000, champExperience: 16000 } })
    const top = buildPlayerGameStats(game({ players: ps, kills: [] }, m), 1, members).find((r) => r.memberId === 'u1')!
    expect(top.vsOpponent!.opponentName).toBe('Red1')
    expect(top.vsOpponent!.opponentChampion).toBe('Champ6')
    expect(top.vsOpponent!.at10).toEqual({ goldDiff: 2000, xpDiff: 1000 })
    expect(top.vsOpponent!.at15).toEqual({ goldDiff: 3000, xpDiff: 1500 })
    expect(top.vsOpponent!.end).toEqual({ goldDiff: 3000, xpDiff: 2000 })
  })

  it('compares with the 4 non-support teammates; null for the support', () => {
    const m = match({ 1: { goldEarned: 18000, champExperience: 21000 }, 5: { goldEarned: 6000 } })
    const rows = buildPlayerGameStats(game(undefined, m), 1, members)
    const top = rows.find((r) => r.role === 'TOP')!
    const sup = rows.find((r) => r.role === 'SUPPORT')!
    // mean of TOP 18000 + three 12000 = 13500 → 18000 / 13500 − 1 = +33.3 %
    expect(top.goldVsTeamAvgPct).toBeCloseTo(33.33, 1)
    expect(top.xpVsTeamAvgPct).toBeCloseTo((21000 / 15750 - 1) * 100, 1)
    expect(sup.goldVsTeamAvgPct).toBeNull()
    expect(sup.xpVsTeamAvgPct).toBeNull()
  })

  it('reads plates from challenges, null when absent', () => {
    const m = match({ 1: { challenges: { turretPlatesTaken: 3 } } })
    const rows = buildPlayerGameStats(game(undefined, m), 1, members)
    expect(rows.find((r) => r.memberId === 'u1')!.plates).toBe(3)
    expect(rows.find((r) => r.memberId === 'u2')!.plates).toBeNull()
  })

  it('has no line for a non-member and no vsOpponent without a lane opponent', () => {
    expect(buildPlayerGameStats(game(undefined), 1, members.slice(0, 2))).toHaveLength(2)
    const m = match()
    m.info.participants = m.info.participants.filter((p) => p.participantId !== 6)
    const top = buildPlayerGameStats(game(undefined, m), 1, members).find((r) => r.memberId === 'u1')!
    expect(top.vsOpponent).toBeNull()
    expect(top.radar).toEqual([])
  })
})

describe('radar', () => {
  const stats = (over: Record<string, unknown>, dur = 1800) =>
    buildSideStats([participant(1, over)] as any, dur, () => ({ id: 'a', displayName: 'a' }))[0]
  it('normalises each axis to the better of the two = 100', () => {
    const player = stats({ totalDamageDealtToChampions: 30000, goldEarned: 10000, visionScore: 40 })
    const opp = stats({ totalDamageDealtToChampions: 15000, goldEarned: 12000, visionScore: 40 })
    const r = buildPlayerRadar(player, opp, 1800)
    const axis = (k: string) => r.find((a) => a.key === k)!
    expect(r.map((a) => a.key)).toEqual(['damagePerMin', 'goldPerMin', 'csPerMin', 'vision', 'kpPct', 'survival', 'xpPerMin'])
    expect(axis('damagePerMin')).toMatchObject({ player: 100, opponent: 50 })
    expect(axis('goldPerMin').player).toBeCloseTo((10000 / 12000) * 100)
    expect(axis('goldPerMin').opponent).toBe(100)
    expect(axis('vision')).toMatchObject({ player: 100, opponent: 100 })
  })
  it('rewards fewer deaths and handles all-zero axes', () => {
    const r = buildPlayerRadar(stats({ deaths: 0, visionScore: 0 }), stats({ deaths: 6, visionScore: 0 }), 1800)
    const survival = r.find((a) => a.key === 'survival')!
    expect(survival.player).toBe(100)
    expect(survival.opponent).toBeLessThan(100)
    expect(r.find((a) => a.key === 'vision')).toMatchObject({ player: 0, opponent: 0 })
  })
  it('is empty without opponent', () => {
    expect(buildPlayerRadar(stats({}), null, 1800)).toEqual([])
  })
})

describe('session aggregate', () => {
  const far = ISOLATION_DISTANCE * 3
  const alone = (kills: any[]): TimelinePlayers => ({ players: pidSeries({ 1: [0, 0], 2: [far, 0], 3: [far, 0], 4: [far, 0], 5: [far, 0] }), kills })
  const g1 = { ...game(alone([kill(100, 6, 1, 0, 0), kill(900, 6, 1, 0, 0)])), id: 'g1' }
  const g2 = { ...game(undefined), id: 'g2' }
  const g3 = { ...game(alone([kill(1000, 6, 1, 0, 0)]), match({ 1: { challenges: { turretPlatesTaken: 2 } } })), id: 'g3' }

  it('sums counters over games with a timeline, skips the others cleanly', () => {
    const [top] = buildPlayerSessionStats([g1, g2, g3], members).filter((p) => p.memberId === 'u1')
    expect(top.gamesCounted).toBe(3)
    expect(top.games.map((g) => g.gameIndex)).toEqual([1, 2, 3])
    expect(top.total.gamesWithTimeline).toBe(2)
    expect(top.total.deathsBefore14).toBe(1)
    expect(top.total.isolatedDeathsAfter14).toBe(2)
    expect(top.total.plates).toBe(2)
    expect(top.total.base.gamesPlayed).toBe(3)
    expect(top.radar).toHaveLength(7)
  })
  it('keeps every total null when no game has a timeline', () => {
    const [top] = buildPlayerSessionStats([g2], members).filter((p) => p.memberId === 'u1')
    expect(top.total.deathsBefore14).toBeNull()
    expect(top.total.isolatedKills).toBeNull()
    expect(top.total.plates).toBeNull()
    expect(top.total.at15).toEqual({ goldDiff: null, xpDiff: null })
  })
  it('has one element per member who played, none without games', () => {
    expect(buildPlayerSessionStats([g1], members)).toHaveLength(5)
    expect(buildPlayerSessionStats([], members)).toEqual([])
  })
})

describe('extraction', () => {
  const frames = [0, 1, 2].map((m) => ({
    timestamp: m * 60000,
    participantFrames: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [String(i + 1), {
      participantId: i + 1, xp: 100 * m * (i + 1), totalGold: 500 * m, position: { x: 1000 * m + i, y: 2000 },
    }])),
    events: m === 1 ? [{ type: 'CHAMPION_KILL', timestamp: 70000, killerId: 6, victimId: 1, assistingParticipantIds: [7], position: { x: 5, y: 6 } }] : [],
  }))
  const out = extractTeamTimeline(match(), { info: { frames } }, { gameId: 'g', matchId: 'm', source: 'scrim', ourTeamId: 100, opponentName: null })!
  it('adds players without bumping the version', () => {
    expect(TEAM_TIMELINE_VERSION).toBe(1)
    expect(out.version).toBe(1)
    expect(out.players!.players).toHaveLength(10)
    const p1 = out.players!.players[0]
    expect(p1).toMatchObject({ pid: 1, teamId: 100, xp: [0, 100, 200], gold: [0, 500, 1000], x: [0, 1000, 2000], y: [2000, 2000, 2000] })
    expect(out.players!.players[5].x).toBeUndefined() // positions: our side only
    expect(out.players!.kills).toEqual([{ t: 70000, killer: 6, victim: 1, assists: [7], x: 5, y: 6 }])
  })
})
