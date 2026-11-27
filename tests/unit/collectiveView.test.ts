import { describe, expect, it } from 'vitest'
import { conversionOf, controlShare, deathsSummary, goldOf, objectivesOf, scopeOf, setupOf, headerOf } from '@/lib/collectiveView'
import type { GameCollective, SessionCollective } from '@/lib/teamCollectiveStatsCore'

const pair = (ours: number, theirs: number) => ({ ours, theirs })
const phase = (isolated: number, grouped: number, unknown: number) => ({ isolated, grouped, unknown })
const game = (gameIndex: number, win: boolean, extra: Partial<GameCollective> = {}): GameCollective => ({
  gameId: `g${gameIndex}`, gameIndex, win, remake: false, durationSec: 1800, side: gameIndex % 2 ? 'blue' : 'red', timeline: 'ready',
  objectives: { source: 'timeline', dragons: pair(3, 1), dragonsByType: null, elder: null, grubs: pair(2, 2), herald: pair(1, 0), baron: pair(1, 0), towers: pair(9, 4), firsts: { blood: 'us', tower: 'them', dragon: null, herald: 'us' } },
  goldLead: { at10: 100, at15: 1600, at20: 900, lostWhileAhead: !win, ahead15: true },
  conversion: { fightsWon: 2, converted: 1, items: [{ atSec: 500, kills: 3, deaths: 0, objective: 'dragon', delaySec: 40 }, { atSec: 900, kills: 2, deaths: 1, objective: null, delaySec: null }] },
  setup: { items: [{ kind: 'dragon', atSec: 300, wardsPlaced: 4, wardsCleared: 0, outcome: 'taken' }, { kind: 'baron', atSec: 1500, wardsPlaced: 1, wardsCleared: 0, outcome: 'lost' }] },
  deaths: { early: phase(1, 0, 0), mid: phase(0, 2, 0), late: phase(1, 1, 1), total: 6 }, rules: null, kp: [], ...extra,
})
const session = (games: GameCollective[]): SessionCollective => ({
  games, gamesCounted: games.filter((g) => !g.remake).length, remakes: games.filter((g) => g.remake).length, gamesWithTimeline: games.filter((g) => g.timeline === 'ready').length,
  objectives: { dragons: pair(6, 2), dragonsByType: { fire: pair(0, 0), water: pair(0, 0), earth: pair(0, 0), air: pair(0, 0), hextech: pair(0, 0), chemtech: pair(0, 0), other: pair(0, 0) }, elder: pair(0, 0), grubs: pair(4, 4), herald: pair(2, 0), baron: pair(2, 0), towers: pair(18, 8),
    firsts: { blood: { us: 2, them: 0, games: 2 }, tower: { us: 0, them: 2, games: 2 }, dragon: { us: 0, them: 0, games: 0 }, herald: { us: 2, them: 0, games: 2 } } },
  goldLead: { avgAt10: 100, avgAt15: 1600, avgAt20: 900, ahead15: 2, lostWhileAhead: 1, gamesJudged: 2 }, conversion: { fightsWon: 4, converted: 2, ratePct: 50 },
  setup: { games: 2, byKind: [] }, deaths: null, rules: null, kp: [], bySide: { blue: { games: 1, wins: 1 }, red: { games: 1, wins: 0 } }, byDuration: { short: { games: 0, wins: 0 }, medium: { games: 2, wins: 1 }, long: { games: 0, wins: 0 } },
})

describe('collectiveView', () => {
  const c = session([game(1, true), game(2, false)])
  it('picks the session or a game of the payload, null for an unknown game', () => {
    expect(scopeOf(c, null)?.kind).toBe('session')
    expect(scopeOf(c, 2)?.kind).toBe('game')
    expect(scopeOf(c, 9)).toBeNull()
  })
  it('objective control counts the neutral objectives only (towers out)', () => {
    const rows = objectivesOf(scopeOf(c, null)!).rows
    const ctl = controlShare(rows)
    expect(ctl.ours).toBe(6 + 4 + 2 + 2)
    expect(ctl.theirs).toBe(2 + 4)
    expect(controlShare([]).pct).toBeNull()
  })
  it('firsts: counts for the session, the owner for one game', () => {
    expect(objectivesOf(scopeOf(c, null)!).firsts[0]).toMatchObject({ key: 'blood', us: 2, games: 2 })
    const g = objectivesOf(scopeOf(c, 1)!).firsts
    expect(g.find((f) => f.key === 'tower')?.owner).toBe('them')
    expect(g.find((f) => f.key === 'dragon')?.games).toBe(0)
  })
  it('gold: session averages and per-game rows, game values for one game', () => {
    expect(goldOf(scopeOf(c, null)!)).toMatchObject({ at15: 1600, lostWhileAhead: 1, ahead: 2 })
    expect(goldOf(scopeOf(c, null)!).perGame).toHaveLength(2)
    expect(goldOf(scopeOf(c, 2)!)).toMatchObject({ at15: 1600, lostWhileAhead: 1, ahead: 1 })
  })
  it('fights put the not converted first', () => {
    const items = conversionOf(scopeOf(c, null)!).items
    expect(items[0].objective).toBeNull()
    expect(items.at(-1)?.objective).not.toBeNull()
  })
  it('setup: wards split at the threshold, and a game without ward events is counted apart', () => {
    const s = setupOf(scopeOf(c, null)!)
    expect(s.withWards).toEqual({ taken: 2, total: 2 })
    expect(s.withoutWards).toEqual({ taken: 0, total: 2 })
    expect(s.avgWards).toBeCloseTo(2.5)
    const missing = setupOf(scopeOf(session([game(1, true), game(2, true, { setup: null })]), null)!)
    expect(missing.gamesWithout).toBe(1)
    expect(setupOf(scopeOf(session([game(1, true, { setup: null })]), 1)!).known).toBe(false)
  })
  it('deaths summary and header ignore remakes', () => {
    expect(deathsSummary(game(1, true).deaths!)).toEqual({ total: 6, isolated: 2, late: 3 })
    const withRemake = session([game(1, true), game(2, false, { remake: true })])
    expect(headerOf(scopeOf(withRemake, null)!)).toMatchObject({ games: 1, wins: 1, losses: 0 })
  })
})
