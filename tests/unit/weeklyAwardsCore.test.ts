import { describe, it, expect } from 'vitest'
import {
  BACKFILL_WEEKS,
  BASELINE_MAX_AGE_MS,
  DAY_MS,
  FINALIZE_GRACE_MS,
  HOUR_MS,
  MVP_MIN_GAMES,
  MVP_MIN_TOGETHER,
  ROLE_NORMS,
  ROLE_WEIGHTS,
  SCORE_ROLES,
  awardTotals,
  buildWeeklyAwards,
  grinderRace,
  grinderWeek,
  lobbyPercentile,
  mvpRace,
  pendingWeeks,
  raceLeader,
  resolveWinner,
  scoreGame,
  scoreLobby,
  shiftWeekKey,
  streakEnding,
  teamGamesOnly,
  toScoreRole,
  weekKeyOf,
  weekRange,
  weekResultOf,
  weekStartFromKey,
  weekStartOf,
  type AwardRaceEntry,
  type LobbyPlayer,
  type RankPoint,
  type ScoreRole,
  type WeekResult,
} from '../../src/lib/weeklyAwardsCore'
import { ladderScore, type QueueRank } from '../../src/lib/rankCore'

// Thursday 19 November 2026, 15:00 local: current week 2026-11-16.
const NOW = new Date(2026, 10, 19, 15, 0).getTime()

describe('weeks', () => {
  it('start on Monday 00:00 local, Sunday night belongs to the week before', () => {
    expect(weekStartOf(new Date(2026, 10, 19, 15)).getTime()).toBe(new Date(2026, 10, 16).getTime())
    expect(weekStartOf(new Date(2026, 10, 16, 0, 0, 0)).getTime()).toBe(new Date(2026, 10, 16).getTime())
    expect(weekKeyOf(new Date(2026, 10, 22, 23, 59, 59))).toBe('2026-11-16')
    expect(weekKeyOf(new Date(2026, 10, 23, 0, 0, 0))).toBe('2026-11-23')
  })

  it('are named by their Monday and shift by calendar weeks', () => {
    expect(weekKeyOf(NOW)).toBe('2026-11-16')
    expect(weekStartFromKey('2026-11-16').getTime()).toBe(new Date(2026, 10, 16).getTime())
    expect(shiftWeekKey('2026-11-16', -1)).toBe('2026-11-09')
    expect(shiftWeekKey('2026-12-28', 1)).toBe('2027-01-04')
    expect(shiftWeekKey('2027-01-04', -2)).toBe('2026-12-21')
    expect(() => weekStartFromKey('16/11/2026')).toThrow(/Invalid week key/)
  })

  it('keep their Monday across a daylight-saving change', () => {
    // Europe moves clocks on Sunday 29 March 2026: shifting stays on Mondays
    // whatever the machine's time zone.
    expect(shiftWeekKey('2026-03-23', 1)).toBe('2026-03-30')
    expect(shiftWeekKey('2026-03-30', -1)).toBe('2026-03-23')
    const { start, end } = weekRange('2026-03-23')
    expect(new Date(end).getDay()).toBe(1)
    expect(new Date(end).getHours()).toBe(0)
    expect(Math.abs(end - start - 7 * DAY_MS)).toBeLessThanOrEqual(HOUR_MS)
  })

  it('list the completed weeks the history lacks, finalizable after the grace period', () => {
    const none = new Set<string>()
    expect(pendingWeeks(NOW, none)).toEqual([
      { key: '2026-10-19', finalizable: true },
      { key: '2026-10-26', finalizable: true },
      { key: '2026-11-02', finalizable: true },
      { key: '2026-11-09', finalizable: true },
    ])
    expect(pendingWeeks(NOW, none)).toHaveLength(BACKFILL_WEEKS)
    expect(pendingWeeks(NOW, new Set(['2026-10-19', '2026-11-02'])).map((w) => w.key)).toEqual(['2026-10-26', '2026-11-09'])
    // Monday 01:00: last week ended an hour ago, still in its grace period.
    const mondayNight = new Date(2026, 10, 16, 1, 0).getTime()
    expect(pendingWeeks(mondayNight, none).pop()).toEqual({ key: '2026-11-09', finalizable: false })
    const afterGrace = weekStartFromKey('2026-11-16').getTime() + FINALIZE_GRACE_MS
    expect(pendingWeeks(afterGrace, none).pop()).toEqual({ key: '2026-11-09', finalizable: true })
  })
})

describe('lobbyPercentile', () => {
  it('reads 0 for the lowest, 1 for the highest, ties count half', () => {
    expect(lobbyPercentile(5, [1, 2, 3])).toBe(1)
    expect(lobbyPercentile(0, [1, 2, 3])).toBe(0)
    expect(lobbyPercentile(2, [1, 3])).toBe(0.5)
    expect(lobbyPercentile(2, [2, 2])).toBe(0.5)
    expect(lobbyPercentile(2, [1, 2, 3, 4])).toBe(0.375)
    expect(lobbyPercentile(2, [])).toBe(0.5)
  })
})

const MINUTES = 30

/** A player at their role's median on every stat once normalized: kills and
 *  damage proportional to the role's KP and damage share (so every player
 *  of a team has the same ratio to their norm), deaths that make the KDA the
 *  norm, per-minute stats = norm. `boost` multiplies their stats. */
function medianPlayer(puuid: string, teamId: number, role: ScoreRole, win: boolean, boost = 1): LobbyPlayer {
  const n = ROLE_NORMS[role]
  return {
    puuid,
    teamId,
    role,
    win,
    kills: 100 * n.kp * boost,
    deaths: (100 * n.kp) / n.kda,
    assists: 0,
    damage: n.damage * 10_000 * boost,
    gold: n.gold * MINUTES * boost,
    cs: n.cs * MINUTES * boost,
    vision: n.vision * MINUTES * boost,
  }
}

function medianLobby(): LobbyPlayer[] {
  return [
    ...SCORE_ROLES.map((r) => medianPlayer(`blue-${r}`, 100, r, true)),
    ...SCORE_ROLES.map((r) => medianPlayer(`red-${r}`, 200, r, false)),
  ]
}

describe('scoreLobby', () => {
  it('gives the same score to median players of every role (45, 55 in a win)', () => {
    const lobby = medianLobby()
    for (const r of SCORE_ROLES) {
      expect(scoreLobby(lobby, `blue-${r}`, MINUTES)).toBe(55)
      expect(scoreLobby(lobby, `red-${r}`, MINUTES)).toBe(45)
    }
  })

  it('weights add up to 1 for every role', () => {
    for (const row of Object.values(ROLE_WEIGHTS)) {
      expect(Object.values(row).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10)
    }
  })

  it('ranks the best of the lobby near 100 and the worst near 0, in every role', () => {
    const scores: Record<string, { best: number; worst: number }> = {}
    for (const r of SCORE_ROLES) {
      const best = medianLobby().map((p) => (p.puuid === `blue-${r}` ? medianPlayer(p.puuid, 100, r, true, 2) : p))
      const worst = medianLobby().map((p) => (p.puuid === `red-${r}` ? medianPlayer(p.puuid, 200, r, false, 0.5) : p))
      scores[r] = { best: scoreLobby(best, `blue-${r}`, MINUTES)!, worst: scoreLobby(worst, `red-${r}`, MINUTES)! }
      expect(scores[r].best).toBeGreaterThanOrEqual(95)
      expect(scores[r].worst).toBeLessThanOrEqual(5)
    }
    // Roles whose stats spread less are stretched up to the ends of the scale.
    expect(scores.SUPPORT).toEqual({ best: 100, worst: 0 })
    expect(scores.JUNGLE).toEqual({ best: 100, worst: 0 })
  })

  it('judges a support on vision, not on CS', () => {
    const lobby = medianLobby()
    const farming = lobby.map((p) => (p.puuid === 'red-SUPPORT' ? { ...p, cs: p.cs * 5 } : p))
    const warding = lobby.map((p) => (p.puuid === 'red-SUPPORT' ? { ...p, vision: p.vision * 2 } : p))
    expect(scoreLobby(farming, 'red-SUPPORT', MINUTES)).toBe(45)
    expect(scoreLobby(warding, 'red-SUPPORT', MINUTES)).toBeGreaterThan(60)
  })

  it('compares a stat to the role norm, so a support never wins on raw gold', () => {
    // Same raw gold for everybody: the support is far above its norm.
    const lobby = medianLobby().map((p) => ({ ...p, gold: 400 * MINUTES }))
    const support = scoreLobby(lobby, 'red-SUPPORT', MINUTES)!
    const adc = scoreLobby(lobby, 'red-ADC', MINUTES)!
    expect(support).toBeGreaterThan(45)
    expect(adc).toBeLessThan(45)
  })

  it('is null for a player not in the lobby or alone', () => {
    expect(scoreLobby(medianLobby(), 'nobody', MINUTES)).toBeNull()
    expect(scoreLobby([medianPlayer('solo', 100, 'MID', true)], 'solo', MINUTES)).toBeNull()
    expect(scoreLobby(medianLobby(), 'blue-MID', 0)).toBeNull()
  })

  it('reads a player with no position against all roles', () => {
    const lobby = medianLobby().map((p) => (p.puuid === 'red-MID' ? { ...p, role: null } : p))
    const s = scoreLobby(lobby, 'red-MID', MINUTES)
    expect(s).not.toBeNull()
    expect(s!).toBeGreaterThanOrEqual(0)
    expect(s!).toBeLessThanOrEqual(90)
  })
})

const POSITION: Record<ScoreRole, string> = { TOP: 'TOP', JUNGLE: 'JUNGLE', MID: 'MIDDLE', ADC: 'BOTTOM', SUPPORT: 'UTILITY' }

/** A match-v5 body from a lobby. */
function matchOf(lobby: LobbyPlayer[], over: Record<string, unknown> = {}): any {
  return {
    metadata: { matchId: 'EUW1_7000000001' },
    info: {
      queueId: 420,
      gameDuration: MINUTES * 60,
      gameCreation: 1_763_550_000_000,
      gameStartTimestamp: 1_763_550_060_000,
      gameEndTimestamp: 1_763_551_860_000,
      participants: lobby.map((p) => ({
        puuid: p.puuid,
        teamId: p.teamId,
        teamPosition: p.role ? POSITION[p.role] : '',
        individualPosition: 'Invalid',
        win: p.win,
        kills: p.kills,
        deaths: p.deaths,
        assists: p.assists,
        totalDamageDealtToChampions: p.damage,
        goldEarned: p.gold,
        totalMinionsKilled: p.cs,
        neutralMinionsKilled: 0,
        visionScore: p.vision,
        gameEndedInEarlySurrender: false,
      })),
      ...over,
    },
  }
}

describe('scoreGame', () => {
  it('reads a ranked match-v5 body', () => {
    expect(scoreGame(matchOf(medianLobby()), 'blue-SUPPORT')).toEqual({
      matchId: 'EUW1_7000000001',
      queueId: 420,
      playedAt: 1_763_550_060_000,
      durationSec: 1800,
      role: 'SUPPORT',
      win: true,
      score: 55,
    })
    expect(scoreGame(matchOf(medianLobby(), { queueId: 440 }), 'red-TOP')?.score).toBe(45)
  })

  it('counts Solo/Duo and Flex only', () => {
    for (const queueId of [400, 450, 700, 1700, 0]) {
      const s = scoreGame(matchOf(medianLobby(), { queueId }), 'blue-MID')
      expect(s?.queueId).toBe(queueId)
      expect(s?.score).toBeNull()
    }
  })

  it('never counts a remake', () => {
    expect(scoreGame(matchOf(medianLobby(), { gameDuration: 210 }), 'blue-MID')?.score).toBeNull()
    const surrendered = matchOf(medianLobby())
    for (const p of surrendered.info.participants) p.gameEndedInEarlySurrender = true
    expect(scoreGame(surrendered, 'blue-MID')?.score).toBeNull()
  })

  it('reads old durations in milliseconds and falls back to the creation time', () => {
    const s = scoreGame(matchOf(medianLobby(), { gameDuration: 1_800_000, gameStartTimestamp: undefined }), 'red-JUNGLE')
    expect(s?.durationSec).toBe(1800)
    expect(s?.playedAt).toBe(1_763_550_000_000)
    expect(s?.score).toBe(45)
  })

  it('is null for a player not in the game or an unreadable body', () => {
    expect(scoreGame(matchOf(medianLobby()), 'someone-else')).toBeNull()
    expect(scoreGame(null, 'blue-MID')).toBeNull()
    expect(scoreGame({ info: { participants: 'x' } }, 'blue-MID')).toBeNull()
  })

  it('maps Riot positions to roster roles', () => {
    expect(toScoreRole('UTILITY')).toBe('SUPPORT')
    expect(toScoreRole('BOTTOM')).toBe('ADC')
    expect(toScoreRole('MIDDLE')).toBe('MID')
    expect(toScoreRole('JUNGLE')).toBe('JUNGLE')
    expect(toScoreRole('Invalid')).toBeNull()
    expect(toScoreRole('')).toBeNull()
    expect(toScoreRole(undefined)).toBeNull()
  })
})

describe('teamGamesOnly (#46: the MVP counts team games only)', () => {
  const g = (puuid: string, matchId: string, win: boolean, score = 60) => ({ puuid, matchId, win, score })

  it('a game counts when 3 players of the roster played it on the same side', () => {
    expect(MVP_MIN_TOGETHER).toBe(3)
    const games = [g('a', 'M1', true), g('b', 'M1', true), g('c', 'M1', true), g('a', 'M2', true), g('b', 'M2', true)]
    expect(teamGamesOnly(games).map((x) => `${x.puuid}:${x.matchId}`)).toEqual(['a:M1', 'b:M1', 'c:M1'])
  })

  it('Solo/Duo games alone never count, so no MVP without team games (the reported bug: MVP four weeks running)', () => {
    const solo = Array.from({ length: 8 }, (_, i) => g('a', `S${i}`, i % 2 === 0, 90))
    expect(teamGamesOnly(solo)).toEqual([])
    expect(mvpRace(teamGamesOnly(solo).map((x) => ({ memberId: x.puuid, score: x.score })))).toEqual([])
  })

  it('roster players on opposite sides of one game are not a team game', () => {
    const games = [g('a', 'M1', true), g('b', 'M1', true), g('c', 'M1', false), g('d', 'M1', false)]
    expect(teamGamesOnly(games)).toEqual([])
  })

  it('the MVP is the best average over the team games', () => {
    const games = [
      ...['M1', 'M2', 'M3'].flatMap((m) => [g('a', m, true, 80), g('b', m, true, 50), g('c', m, true, 40)]),
      g('b', 'SOLO', true, 100), g('b', 'SOLO2', true, 100), // b's solo games do not lift b
    ]
    const race = mvpRace(teamGamesOnly(games).map((x) => ({ memberId: x.puuid, score: x.score })))
    expect(race[0]).toMatchObject({ memberId: 'a', value: 80, games: 3 })
    expect(race.find((r) => r.memberId === 'b')).toMatchObject({ value: 50, games: 3 })
  })
})

describe('mvpRace', () => {
  const games = (memberId: string, ...scores: Array<number | null>) => scores.map((score) => ({ memberId, score }))

  it('averages the counted games, qualified players first', () => {
    const race = mvpRace([
      ...games('a', 70, 80),
      ...games('b', 60, 61, 62),
      ...games('c', 50, 55, 52, 58, null),
    ])
    expect(race).toEqual([
      { memberId: 'b', value: 61, games: 3 },
      { memberId: 'c', value: 53.8, games: 4 },
      { memberId: 'a', value: 75, games: 2 },
    ])
    expect(raceLeader('mvp', race)?.memberId).toBe('b')
  })

  it('gives a tie to the player with more games', () => {
    const race = mvpRace([...games('few', 60, 60, 60), ...games('many', 58, 62, 60, 60)])
    expect(race.map((e) => e.memberId)).toEqual(['many', 'few'])
  })

  it(`has no leader below ${MVP_MIN_GAMES} games`, () => {
    expect(raceLeader('mvp', mvpRace(games('a', 90, 95)))).toBeNull()
    expect(raceLeader('mvp', [])).toBeNull()
  })
})

const rank = (tier: QueueRank['tier'], division: QueueRank['division'], lp: number) => ladderScore({ tier, division, lp })

describe('grinderWeek', () => {
  const { start, end } = weekRange('2026-11-16')
  const at = (dayOffset: number, hour = 12) => start + dayOffset * DAY_MS + hour * HOUR_MS
  const point = (t: number, ladder: number, games: number): RankPoint => ({ at: t, ladder, games })

  it('counts from the last reading before the week, across divisions and tiers', () => {
    const points = [
      point(at(-1), rank('GOLD', 'I', 80), 100),
      point(at(2), rank('PLATINUM', 'IV', 15), 104),
      point(at(5), rank('PLATINUM', 'IV', 60), 110),
    ]
    expect(grinderWeek(points, start, end)).toEqual({ lp: 80, games: 10 })
  })

  it("starts from the week's first reading without a recent one before", () => {
    expect(grinderWeek([point(at(1), 1000, 50), point(at(4), 1090, 56)], start, end)).toEqual({ lp: 90, games: 6 })
    const stale = point(start - BASELINE_MAX_AGE_MS - HOUR_MS, 500, 20)
    expect(grinderWeek([stale, point(at(1), 1000, 50), point(at(4), 1090, 56)], start, end)).toEqual({ lp: 90, games: 6 })
    const recent = point(start - BASELINE_MAX_AGE_MS + HOUR_MS, 980, 48)
    expect(grinderWeek([recent, point(at(1), 1000, 50), point(at(4), 1090, 56)], start, end)).toEqual({ lp: 110, games: 8 })
  })

  it('is null without a reading in the week', () => {
    expect(grinderWeek([point(at(-2), 1000, 10)], start, end)).toBeNull()
    expect(grinderWeek([point(end + HOUR_MS, 1000, 10)], start, end)).toBeNull()
    expect(grinderWeek([], start, end)).toBeNull()
  })

  it('counts LP lost and decay', () => {
    expect(grinderWeek([point(at(-1), 2900, 300), point(at(3), 2850, 300)], start, end)).toEqual({ lp: -50, games: 0 })
  })

  it('restarts after a ranked reset (fewer games than before)', () => {
    const points = [
      point(at(-1), rank('DIAMOND', 'II', 40), 400),
      point(at(1), rank('EMERALD', 'I', 10), 5),
      point(at(3), rank('EMERALD', 'I', 70), 9),
    ]
    expect(grinderWeek(points, start, end)).toEqual({ lp: 60, games: 4 })
  })

  it('reads points in any order', () => {
    const points = [point(at(5), 1200, 30), point(at(-1), 1000, 20), point(at(2), 1100, 25)]
    expect(grinderWeek(points, start, end)).toEqual({ lp: 200, games: 10 })
  })
})

describe('grinderRace', () => {
  it('sorts by LP then games, leaves out idle players, needs +1 LP to lead', () => {
    const race = grinderRace([
      { memberId: 'a', lp: 40, games: 5 },
      { memberId: 'b', lp: 40, games: 9 },
      { memberId: 'c', lp: 0, games: 0 },
      { memberId: 'd', lp: -20, games: 3 },
    ])
    expect(race).toEqual([
      { memberId: 'b', value: 40, games: 9 },
      { memberId: 'a', value: 40, games: 5 },
      { memberId: 'd', value: -20, games: 3 },
    ])
    expect(raceLeader('grinder', race)?.memberId).toBe('b')
    expect(raceLeader('grinder', grinderRace([{ memberId: 'a', lp: 0, games: 4 }]))).toBeNull()
    expect(raceLeader('grinder', grinderRace([{ memberId: 'a', lp: 1, games: 1 }]))?.value).toBe(1)
  })
})

const ROSTER = [
  { id: 'm-top', puuid: 'p-top' },
  { id: 'm-jg', puuid: 'p-jg' },
  { id: 'm-mid', puuid: 'p-mid' },
  { id: 'm-adc', puuid: 'p-adc' },
  { id: 'm-sup', puuid: null },
]

const result = (kind: WeekResult['kind'], weekKey: string, memberId: string | null, value = 60, games = 5): WeekResult => ({
  kind,
  weekKey,
  memberId,
  puuid: memberId ? ROSTER.find((m) => m.id === memberId)?.puuid ?? null : null,
  value: memberId ? value : null,
  games: memberId ? games : null,
})

const noRace: Record<'mvp' | 'grinder', AwardRaceEntry[]> = { mvp: [], grinder: [] }

describe('history', () => {
  it('finds the winner on the roster by member, else by PUUID', () => {
    expect(resolveWinner({ memberId: 'm-mid', puuid: 'p-mid' }, ROSTER)).toBe('m-mid')
    expect(resolveWinner({ memberId: 'old-id', puuid: 'p-mid' }, ROSTER)).toBe('m-mid')
    expect(resolveWinner({ memberId: 'gone', puuid: 'p-gone' }, ROSTER)).toBeNull()
    expect(resolveWinner({ memberId: null, puuid: null }, ROSTER)).toBeNull()
  })

  it('counts a streak of consecutive weeks, broken by a week lost or missing', () => {
    const history = [
      result('mvp', '2026-10-19', 'm-mid'),
      result('mvp', '2026-10-26', 'm-adc'),
      result('mvp', '2026-11-02', 'm-mid'),
      result('mvp', '2026-11-09', 'm-mid'),
      result('grinder', '2026-11-09', 'm-mid'),
    ]
    expect(streakEnding(history, 'mvp', 'm-mid', '2026-11-09', ROSTER)).toBe(2)
    expect(streakEnding(history, 'mvp', 'm-adc', '2026-10-26', ROSTER)).toBe(1)
    expect(streakEnding(history, 'grinder', 'm-mid', '2026-11-09', ROSTER)).toBe(1)
    expect(streakEnding(history, 'mvp', 'm-top', '2026-11-09', ROSTER)).toBe(0)
    const gap = [result('mvp', '2026-10-26', 'm-mid'), result('mvp', '2026-11-09', 'm-mid')]
    expect(streakEnding(gap, 'mvp', 'm-mid', '2026-11-09', ROSTER)).toBe(1)
  })

  it('totals completed weeks per member, zeros included', () => {
    const totals = awardTotals([
      result('mvp', '2026-10-26', 'm-mid'),
      result('mvp', '2026-11-02', 'm-mid'),
      result('grinder', '2026-11-02', 'm-top'),
      result('grinder', '2026-11-09', null),
      { ...result('mvp', '2026-11-09', 'gone'), puuid: 'p-gone' },
    ], ROSTER)
    expect(totals).toEqual({
      'm-top': { mvp: 0, grinder: 1 },
      'm-jg': { mvp: 0, grinder: 0 },
      'm-mid': { mvp: 2, grinder: 0 },
      'm-adc': { mvp: 0, grinder: 0 },
      'm-sup': { mvp: 0, grinder: 0 },
    })
  })

  it("builds a week's result from its ranking", () => {
    const race = mvpRace([{ memberId: 'm-adc', score: 70 }, { memberId: 'm-adc', score: 64 }, { memberId: 'm-adc', score: 61 }])
    expect(weekResultOf('mvp', '2026-11-09', race, ROSTER)).toEqual({
      kind: 'mvp', weekKey: '2026-11-09', memberId: 'm-adc', puuid: 'p-adc', value: 65, games: 3,
    })
    expect(weekResultOf('grinder', '2026-11-09', [], ROSTER)).toEqual({
      kind: 'grinder', weekKey: '2026-11-09', memberId: null, puuid: null, value: null, games: null,
    })
  })
})

describe('buildWeeklyAwards', () => {
  it("shows last week's winners with their streak", () => {
    const awards = buildWeeklyAwards({
      now: NOW,
      roster: ROSTER,
      history: [
        result('mvp', '2026-10-26', 'm-mid', 58, 6),
        result('mvp', '2026-11-02', 'm-mid', 63, 4),
        result('mvp', '2026-11-09', 'm-mid', 66.2, 7),
        result('grinder', '2026-11-02', 'm-top', 120, 14),
        result('grinder', '2026-11-09', 'm-adc', 85, 11),
      ],
      race: { mvp: [{ memberId: 'm-jg', value: 70, games: 4 }], grinder: [{ memberId: 'm-top', value: 50, games: 6 }] },
    })
    expect(awards.holders).toEqual([
      { kind: 'mvp', memberId: 'm-mid', weekStart: new Date(2026, 10, 9).toISOString(), live: false, value: 66.2, games: 7, streak: 3 },
      { kind: 'grinder', memberId: 'm-adc', weekStart: new Date(2026, 10, 9).toISOString(), live: false, value: 85, games: 11, streak: 1 },
    ])
    expect(awards.totals['m-mid']).toEqual({ mvp: 3, grinder: 0 })
    expect(awards.totals['m-top']).toEqual({ mvp: 0, grinder: 1 })
    expect(awards.race.mvp).toEqual([{ memberId: 'm-jg', value: 70, games: 4 }])
    expect(awards.computedAt).toBe(new Date(NOW).toISOString())
  })

  it("falls back to the current week's qualified leader, live", () => {
    const awards = buildWeeklyAwards({
      now: NOW,
      roster: ROSTER,
      history: [result('mvp', '2026-11-09', null), result('grinder', '2026-11-09', null)],
      race: {
        mvp: [{ memberId: 'm-jg', value: 71.5, games: 3 }, { memberId: 'm-top', value: 60, games: 8 }],
        grinder: [{ memberId: 'm-adc', value: 45, games: 6 }],
      },
    })
    expect(awards.holders).toEqual([
      { kind: 'mvp', memberId: 'm-jg', weekStart: new Date(2026, 10, 16).toISOString(), live: true, value: 71.5, games: 3, streak: 1 },
      { kind: 'grinder', memberId: 'm-adc', weekStart: new Date(2026, 10, 16).toISOString(), live: true, value: 45, games: 6, streak: 1 },
    ])
    expect(Object.values(awards.totals).every((t) => t.mvp === 0 && t.grinder === 0)).toBe(true)
  })

  it('gives no frame to a leader who does not qualify yet', () => {
    const awards = buildWeeklyAwards({
      now: NOW,
      roster: ROSTER,
      history: [],
      race: { mvp: mvpRace([{ memberId: 'm-jg', score: 90 }, { memberId: 'm-jg', score: 88 }]), grinder: grinderRace([{ memberId: 'm-adc', lp: 0, games: 3 }]) },
    })
    expect(awards.holders).toEqual([])
    expect(awards.race.mvp).toEqual([{ memberId: 'm-jg', value: 89, games: 2 }])
  })

  it("passes the frame on when last week's winner left the roster", () => {
    const left = { ...result('mvp', '2026-11-09', 'gone'), puuid: 'p-gone' }
    const awards = buildWeeklyAwards({
      now: NOW,
      roster: ROSTER,
      history: [left],
      race: { mvp: [{ memberId: 'm-top', value: 58, games: 5 }, { memberId: 'gone', value: 80, games: 9 }], grinder: [] },
    })
    expect(awards.holders).toEqual([
      { kind: 'mvp', memberId: 'm-top', weekStart: new Date(2026, 10, 16).toISOString(), live: true, value: 58, games: 5, streak: 1 },
    ])
    expect(awards.race.mvp.map((e) => e.memberId)).toEqual(['m-top'])
  })

  it('follows a player added back under a new member id', () => {
    const roster = ROSTER.map((m) => (m.id === 'm-mid' ? { id: 'm-mid-2', puuid: 'p-mid' } : m))
    const awards = buildWeeklyAwards({
      now: NOW,
      roster,
      history: [result('mvp', '2026-11-02', 'm-mid'), result('mvp', '2026-11-09', 'm-mid')],
      race: noRace,
    })
    expect(awards.holders[0]).toMatchObject({ kind: 'mvp', memberId: 'm-mid-2', live: false, streak: 2 })
    expect(awards.totals['m-mid-2'].mvp).toBe(2)
  })

  it('ignores results of the current week and later', () => {
    const awards = buildWeeklyAwards({
      now: NOW,
      roster: ROSTER,
      history: [result('mvp', '2026-11-16', 'm-top'), result('mvp', '2026-11-23', 'm-top')],
      race: noRace,
    })
    expect(awards.holders).toEqual([])
    expect(awards.totals['m-top'].mvp).toBe(0)
  })
})
