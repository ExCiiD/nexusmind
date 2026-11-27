import { describe, it, expect } from 'vitest'
import {
  buildSessionCollective, buildGameCollective, buildConversion, buildSetup, buildGoldLead, buildDeathBreakdown,
  LEAD_AHEAD_GOLD, type SessionCollective,
} from '../../src/lib/teamCollectiveStatsCore'
import { extractWardEvents, PLAYERS_BLOCK_VERSION, TEAM_TIMELINE_VERSION } from '../../src/lib/teamTimelineCore'
import type { PlayerGameInput, TimelinePlayers, TimelineKillEvent, TimelineObjectiveEvent } from '../../src/lib/playerSessionStatsCore'
import type { RiotIdMember } from '../../src/lib/teamSessionStatsCore'

const MIN = 60_000
const sec = (s: number) => s * 1000

// Our team = participants 1-5 (blue, 100), theirs = 6-10 (red, 200).
const members: RiotIdMember[] = [1, 2, 3, 4, 5].map((i) => ({ userId: `u${i}`, riotId: `P${i}#EUW`, displayName: `P${i}` }))

function participants(win: boolean, kills: number[], assists: number[]) {
  return Array.from({ length: 10 }, (_, i) => ({
    participantId: i + 1, teamId: i < 5 ? 100 : 200, win: i < 5 ? win : !win,
    riotIdGameName: `P${i + 1}`, riotIdTagline: 'EUW', summonerName: `P${i + 1}`, championName: 'Aatrox', teamPosition: 'TOP',
    kills: i < 5 ? kills[i] : 1, assists: i < 5 ? assists[i] : 1, deaths: 1, goldEarned: 10000, visionScore: 20, totalDamageDealtToChampions: 10000,
  }))
}

function teams(over: { ours?: Record<string, any>; theirs?: Record<string, any> } = {}) {
  return [
    { teamId: 100, objectives: { champion: { first: true, kills: 20 }, tower: { first: false, kills: 5 }, dragon: { first: true, kills: 3 }, riftHerald: { first: false, kills: 0 }, baron: { first: false, kills: 1 }, horde: { first: false, kills: 2 }, ...over.ours } },
    { teamId: 200, objectives: { champion: { first: false, kills: 10 }, tower: { first: true, kills: 3 }, dragon: { first: false, kills: 1 }, riftHerald: { first: true, kills: 1 }, baron: { first: false, kills: 0 }, horde: { first: false, kills: 1 }, ...over.theirs } },
  ]
}

/** Gold per minute: our team 5 x ourGold(m), theirs 5 x theirGold(m); positions for our side (everybody together at the base). */
function series(len: number, ourGold: (m: number) => number, theirGold: (m: number) => number, withPos = true) {
  return Array.from({ length: 10 }, (_, i) => ({
    pid: i + 1, teamId: (i < 5 ? 100 : 200) as 100 | 200,
    xp: Array.from({ length: len }, () => 0),
    gold: Array.from({ length: len }, (_, m) => (i < 5 ? ourGold(m) : theirGold(m))),
    ...(i < 5 && withPos ? { x: Array.from({ length: len }, () => 1000), y: Array.from({ length: len }, () => 1000) } : {}),
  }))
}

const kill = (t: number, killer: number, victim: number, x: number | null = 1000, y: number | null = 1000): TimelineKillEvent => ({ t, killer, victim, assists: [], x, y })
const obj = (t: number, kind: TimelineObjectiveEvent['kind'], teamId: 100 | 200, subType?: string): TimelineObjectiveEvent => ({ t, kind, teamId, killer: teamId === 100 ? 1 : 6, assists: [], ...(subType ? { subType } : {}) })

function timeline(tp: Partial<TimelinePlayers> & { players: TimelinePlayers['players'] }) {
  return { version: TEAM_TIMELINE_VERSION, events: [], goldDiffByMinute: [], players: { v: PLAYERS_BLOCK_VERSION, kills: [], objectives: [], ...tp } }
}

function game(id: string, over: { win?: boolean; durationSec?: number; tl?: any; ourTeamId?: 100 | 200 | null; teamsOver?: any } = {}): PlayerGameInput {
  const win = over.win ?? true
  return {
    id, matchId: `EUW1_${id}`, ourTeamId: over.ourTeamId === undefined ? 100 : over.ourTeamId,
    matchJson: { info: { gameDuration: over.durationSec ?? 1800, participants: participants(win, [5, 4, 3, 2, 1], [5, 6, 7, 8, 9]), teams: teams(over.teamsOver) } },
    timelineSummary: over.tl ?? null,
  }
}

describe('objectives', () => {
  it('counts dragons by type, grubs, herald, baron, elder and towers us / them from the timeline, firsts from the match', () => {
    const tl = timeline({
      players: series(31, () => 0, () => 0),
      objectives: [
        obj(sec(400), 'dragon', 100, 'FIRE'), obj(sec(700), 'dragon', 200, 'WATER'), obj(sec(1000), 'dragon', 100, 'HEXTECH'),
        obj(sec(1500), 'elder', 100), obj(sec(500), 'grubs', 100), obj(sec(500), 'grubs', 100), obj(sec(520), 'grubs', 200),
        obj(sec(900), 'herald', 200), obj(sec(1400), 'baron', 100), obj(sec(600), 'tower', 100), obj(sec(800), 'tower', 200),
      ],
    })
    const g = buildGameCollective(game('a', { tl }), 1, members)!
    expect(g.objectives.source).toBe('timeline')
    expect(g.objectives.dragons).toEqual({ ours: 2, theirs: 1 })
    expect(g.objectives.dragonsByType!.fire).toEqual({ ours: 1, theirs: 0 })
    expect(g.objectives.dragonsByType!.water).toEqual({ ours: 0, theirs: 1 })
    expect(g.objectives.elder).toEqual({ ours: 1, theirs: 0 })
    expect(g.objectives.grubs).toEqual({ ours: 2, theirs: 1 })
    expect(g.objectives.herald).toEqual({ ours: 0, theirs: 1 })
    expect(g.objectives.baron).toEqual({ ours: 1, theirs: 0 })
    expect(g.objectives.towers).toEqual({ ours: 1, theirs: 1 })
    expect(g.objectives.firsts).toEqual({ blood: 'us', tower: 'them', dragon: 'us', herald: 'them' })
  })

  it('without a timeline: the match totals only, no types, no timeline figures, no crash', () => {
    const g = buildGameCollective(game('a'), 1, members)!
    expect(g.timeline).toBe('no-timeline')
    expect(g.objectives).toMatchObject({ source: 'match', dragons: { ours: 3, theirs: 1 }, dragonsByType: null, elder: null, grubs: { ours: 2, theirs: 1 }, baron: { ours: 1, theirs: 0 } })
    expect(g.goldLead).toBeNull()
    expect(g.conversion).toBeNull()
    expect(g.setup).toBeNull()
    expect(g.deaths).toBeNull()
    expect(g.kp).toHaveLength(5)
  })

  it('an old summary without the players block is no-players: same fallback', () => {
    const g = buildGameCollective(game('a', { tl: { version: TEAM_TIMELINE_VERSION, events: [], goldDiffByMinute: [] } }), 1, members)!
    expect(g.timeline).toBe('no-players')
    expect(g.goldLead).toBeNull()
  })

  it('a game with no usable match is left out, and an empty session is null', () => {
    expect(buildGameCollective({ id: 'x', matchId: 'x', matchJson: null, ourTeamId: 100, timelineSummary: null }, 1, members)).toBeNull()
    expect(buildSessionCollective([{ id: 'x', matchId: 'x', matchJson: {}, ourTeamId: 100, timelineSummary: null }], members)).toBeNull()
    expect(buildGameCollective(game('a', { ourTeamId: null }), 1, [])).toBeNull() // no side can be found
  })
})

describe('gold lead and games lost while ahead', () => {
  const ahead = (m: number) => (m >= 15 ? 2000 : 1000) // +1000 per player = 5000 team lead? see below
  it('reads the team lead at 10 / 15 / 20 minutes and flags a loss with a lead of LEAD_AHEAD_GOLD or more at 15', () => {
    const tp = timeline({ players: series(31, (m) => 3000 + m * 100 + (m >= 15 ? 400 : 0), (m) => 3000 + m * 100) }).players as TimelinePlayers
    // our team is 5 x 400 = 2000 gold ahead from minute 15
    const win = buildGoldLead(tp, 100, true), loss = buildGoldLead(tp, 100, false)
    expect(win).toMatchObject({ at10: 0, at15: 2000, at20: 2000, ahead15: true, lostWhileAhead: false })
    expect(loss.lostWhileAhead).toBe(true)
    expect(2000).toBeGreaterThanOrEqual(LEAD_AHEAD_GOLD)
    expect(ahead(15)).toBe(2000)
  })

  it('a lead just under the threshold is not "ahead"; a game shorter than 20 minutes has no lead at 20', () => {
    const tp = timeline({ players: series(16, (m) => 3000 + (m >= 15 ? 290 : 0), () => 3000) }).players as TimelinePlayers // 5 x 290 = 1450
    const l = buildGoldLead(tp, 100, false)
    expect(l.at15).toBe(1450)
    expect(l.at20).toBeNull()
    expect(l).toMatchObject({ ahead15: false, lostWhileAhead: false })
    const short = buildGoldLead(timeline({ players: series(10, () => 0, () => 0) }).players as TimelinePlayers, 100, false)
    expect(short).toMatchObject({ at15: null, ahead15: null, lostWhileAhead: null })
  })

  it('the session counts games ahead at 15 and games lost while ahead', () => {
    const lead = (extra: number) => timeline({ players: series(31, (m) => 3000 + (m >= 15 ? extra : 0), () => 3000) })
    const s = buildSessionCollective([
      game('a', { win: false, tl: lead(400) }), game('b', { win: true, tl: lead(400) }), game('c', { win: false, tl: lead(0) }), game('d', { win: false }),
    ], members)!
    expect(s.goldLead).toMatchObject({ gamesJudged: 3, ahead15: 2, lostWhileAhead: 1 })
    expect(s.gamesWithTimeline).toBe(3)
    expect(s.gamesCounted).toBe(4)
  })
})

describe('kill to objective conversion', () => {
  const tp = (kills: TimelineKillEvent[], objectives: TimelineObjectiveEvent[]): TimelinePlayers =>
    timeline({ players: series(31, () => 0, () => 0), kills, objectives }).players as TimelinePlayers

  it('a fight won by 2 kills net followed by an objective within 90 s converts, and gives the delay', () => {
    // we kill 6 and 7 within 5 s, then take a dragon 40 s after the last kill
    const c = buildConversion(tp([kill(sec(600), 1, 6), kill(sec(605), 2, 7)], [obj(sec(645), 'dragon', 100, 'FIRE')]), 100)
    expect(c).toMatchObject({ fightsWon: 1, converted: 1 })
    expect(c.items[0]).toMatchObject({ kills: 2, deaths: 0, objective: 'dragon', delaySec: 40 })
  })

  it('too late (more than 90 s), or the objective is theirs: not converted', () => {
    expect(buildConversion(tp([kill(sec(600), 1, 6), kill(sec(605), 2, 7)], [obj(sec(700), 'baron', 100)]), 100)).toMatchObject({ fightsWon: 1, converted: 0 })
    expect(buildConversion(tp([kill(sec(600), 1, 6), kill(sec(605), 2, 7)], [obj(sec(630), 'dragon', 200)]), 100)).toMatchObject({ fightsWon: 1, converted: 0 })
  })

  it('a trade (2 kills for 1 death) or kills more than 20 s apart are not a won fight', () => {
    expect(buildConversion(tp([kill(sec(600), 1, 6), kill(sec(603), 2, 7), kill(sec(606), 6, 3)], []), 100).fightsWon).toBe(0)
    expect(buildConversion(tp([kill(sec(600), 1, 6), kill(sec(640), 2, 7)], []), 100).fightsWon).toBe(0)
  })

  it('a tower counts as an objective', () => {
    expect(buildConversion(tp([kill(sec(300), 1, 6), kill(sec(302), 2, 7)], [obj(sec(330), 'tower', 100)]), 100).items[0].objective).toBe('tower')
  })
})

describe('objective setup (vision before dragon / baron / herald)', () => {
  const wards = (list: Array<[number, 'place' | 'clear']>) => list.map(([t, kind]) => ({ t: sec(t), pid: 1, kind }))
  const tp = (objectives: TimelineObjectiveEvent[], w: any, kills: TimelineKillEvent[] = []): TimelinePlayers =>
    timeline({ players: series(31, () => 0, () => 0), objectives, kills, ...(w ? { wards: w } : {}) }).players as TimelinePlayers

  it('counts our wards placed and cleared in the 60 s before each objective, and the outcome', () => {
    const t = tp(
      [obj(sec(600), 'dragon', 100, 'FIRE'), obj(sec(900), 'baron', 200), obj(sec(1200), 'herald', 200), obj(sec(1300), 'tower', 100)],
      wards([[545, 'place'], [560, 'place'], [590, 'clear'], [300, 'place'], [850, 'place']]),
      [kill(sec(1190), 1, 6)],
    )
    const s = buildSetup(t, 100)!
    expect(s.items).toHaveLength(3) // the tower is not one of the setups
    expect(s.items[0]).toMatchObject({ kind: 'dragon', wardsPlaced: 2, wardsCleared: 1, outcome: 'taken' })
    expect(s.items[1]).toMatchObject({ kind: 'baron', wardsPlaced: 1, outcome: 'lost' })
    expect(s.items[2]).toMatchObject({ kind: 'herald', outcome: 'contested' }) // theirs, but we killed within 30 s
  })

  it('is null without ward events (summaries cached before 27/11), never zero', () => {
    expect(buildSetup(tp([obj(sec(600), 'dragon', 100)], null), 100)).toBeNull()
  })

  it('the session sums outcomes and average wards when taken vs lost', () => {
    const mk = (w: Array<[number, 'place' | 'clear']>, team: 100 | 200) => game('g' + Math.random(), { tl: timeline({ players: series(31, () => 0, () => 0), objectives: [obj(sec(600), 'dragon', team)], wards: wards(w) }) })
    const s = buildSessionCollective([mk([[550, 'place'], [560, 'place'], [570, 'place'], [580, 'place']], 100), mk([[580, 'place']], 200), mk([], 100)], members)!
    const dragon = s.setup!.byKind.find((k) => k.kind === 'dragon')!
    expect(s.setup!.games).toBe(3)
    expect(dragon).toMatchObject({ taken: 2, lost: 1, contested: 0, avgWardsTaken: 2, avgWardsLost: 1 })
  })

  it('extractWardEvents keeps only our team: placed (creatorId) and destroyed (killerId)', () => {
    const frames = [{ events: [
      { type: 'WARD_PLACED', timestamp: 1000, creatorId: 2 }, { type: 'WARD_PLACED', timestamp: 2000, creatorId: 7 },
      { type: 'WARD_KILL', timestamp: 3000, killerId: 3 }, { type: 'WARD_KILL', timestamp: 4000, killerId: 8 }, { type: 'WARD_PLACED', timestamp: 5000, creatorId: 0 },
    ] }]
    expect(extractWardEvents(frames, (pid) => pid <= 5)).toEqual([{ t: 1000, pid: 2, kind: 'place' }, { t: 3000, pid: 3, kind: 'clear' }])
  })
})

describe('deaths: isolated vs grouped by phase', () => {
  it('splits our deaths 0-14 / 14-25 / 25+ and judges isolation like the player sheets', () => {
    // our team stands at (1000,1000); a death at (1200,1000) is grouped, one at (9000,9000) is isolated
    const kills = [
      kill(sec(300), 6, 1, 1200, 1000), // early, grouped
      kill(sec(500), 6, 2, 9000, 9000), // early, isolated
      kill(sec(1000), 6, 3, 9000, 9000), // mid, isolated
      kill(sec(1700), 6, 4, 1100, 1100), // late, grouped
      kill(sec(1800), 6, 5, null, null), // late, no position
      kill(sec(900), 1, 6), // ours killing: not a death of ours
    ]
    const tp = timeline({ players: series(31, () => 0, () => 0), kills }).players as TimelinePlayers
    const d = buildDeathBreakdown(tp, [1, 2, 3, 4, 5])
    expect(d.early).toEqual({ isolated: 1, grouped: 1, unknown: 0 })
    expect(d.mid).toEqual({ isolated: 1, grouped: 0, unknown: 0 })
    expect(d.late).toEqual({ isolated: 0, grouped: 1, unknown: 1 })
    expect(d.total).toBe(5)
  })

  it('no positions in the summary: the game has no death breakdown (null, not zero)', () => {
    const tl = timeline({ players: series(31, () => 0, () => 0, false), kills: [kill(sec(300), 6, 1)] })
    expect(buildGameCollective(game('a', { tl }), 1, members)!.deaths).toBeNull()
  })
})

describe('kill participation', () => {
  it('per player and gap to the team average of the game, then averaged over the session', () => {
    // kills 5,4,3,2,1 = 15 ; assists 5,6,7,8,9. P1 = (5+5)/15 = 66.7 %, P5 = (1+9)/15 = 66.7 %, P2 = 10/15, P3 = 10/15, P4 = 10/15
    const g = buildGameCollective(game('a'), 1, members)!
    expect(g.kp.find((k) => k.memberId === 'u1')!.kpPct).toBeCloseTo(66.67, 1)
    expect(g.kp.every((k) => Math.abs(k.gapPct) < 1e-9)).toBe(true) // everybody at the average
    const s = buildSessionCollective([game('a'), game('b')], members)!
    expect(s.kp).toHaveLength(5)
    expect(s.kp[0]).toMatchObject({ games: 2 })
  })

  it('a member who is above the team average has a positive gap', () => {
    const lopsided = game('a')
    ;(lopsided.matchJson as any).info.participants[0].kills = 10 // P1 (10+5)/20 = 75 %, others lower
    const g = buildGameCollective(lopsided, 1, members)!
    expect(g.kp.find((k) => k.memberId === 'u1')!.gapPct).toBeGreaterThan(0)
    expect(g.kp.find((k) => k.memberId === 'u2')!.gapPct).toBeLessThan(0)
  })
})

describe('win rate by side and by duration', () => {
  it('blue vs red and short / medium / long games', () => {
    const s = buildSessionCollective([
      game('a', { win: true, durationSec: 20 * 60, ourTeamId: 100 }),
      game('b', { win: false, durationSec: 30 * 60, ourTeamId: 100 }),
      game('c', { win: true, durationSec: 40 * 60, ourTeamId: 100 }),
      game('d', { win: false, durationSec: 40 * 60, ourTeamId: 100 }),
    ], members) as SessionCollective
    expect(s.bySide.blue).toEqual({ games: 4, wins: 2 })
    expect(s.bySide.red).toEqual({ games: 0, wins: 0 })
    expect(s.byDuration).toEqual({ short: { games: 1, wins: 1 }, medium: { games: 1, wins: 0 }, long: { games: 2, wins: 1 } })
  })

  it('a game played on the red side counts for red', () => {
    const red = game('r', { ourTeamId: 200, win: true })
    ;(red.matchJson as any).info.participants.forEach((p: any, i: number) => { p.teamId = i < 5 ? 200 : 100; p.win = i < 5 })
    const s = buildSessionCollective([red], members)!
    expect(s.bySide.red).toEqual({ games: 1, wins: 1 })
  })
})

describe('session totals', () => {
  it('sums objectives and firsts over the games, with and without timeline', () => {
    const tl = timeline({ players: series(31, () => 0, () => 0), objectives: [obj(sec(400), 'dragon', 100, 'FIRE')] })
    const s = buildSessionCollective([game('a', { tl }), game('b')], members)!
    expect(s.objectives.dragons).toEqual({ ours: 1 + 3, theirs: 0 + 1 }) // game b falls back to the match totals
    expect(s.objectives.dragonsByType.fire).toEqual({ ours: 1, theirs: 0 })
    expect(s.objectives.firsts.blood).toEqual({ us: 2, them: 0, games: 2 })
    expect(s.objectives.firsts.herald).toEqual({ us: 0, them: 2, games: 2 })
  })
})

describe('remakes (under 5 minutes or an early surrender vote) are out of every session figure', () => {
  it('flagged on the game, kept in `games`, excluded from objectives, sides, durations, KP and setup', () => {
    const remake = game('r', { win: false, durationSec: 200 })
    const surrender = game('s', { win: false })
    ;(surrender.matchJson as any).info.participants[0].gameEndedInEarlySurrender = true
    const real = game('a', { win: true })
    const s = buildSessionCollective([remake, surrender, real], members)!
    expect(s.games.map((g) => g.remake)).toEqual([true, true, false])
    expect(s.gamesCounted).toBe(1)
    expect(s.remakes).toBe(2)
    expect(s.bySide.blue).toEqual({ games: 1, wins: 1 })
    expect(s.byDuration.short.games + s.byDuration.medium.games + s.byDuration.long.games).toBe(1)
    expect(s.objectives.dragons).toEqual({ ours: 3, theirs: 1 }) // one game's worth, not three
    expect(s.kp[0].games).toBe(1)
  })

  it('a session made of remakes only has no counted game and nothing crashes', () => {
    const s = buildSessionCollective([game('r', { durationSec: 150 })], members)!
    expect(s).toMatchObject({ gamesCounted: 0, remakes: 1, conversion: { fightsWon: 0, ratePct: null }, setup: null, deaths: null, kp: [] })
    expect(s.goldLead.gamesJudged).toBe(0)
  })
})
