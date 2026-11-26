import { describe, it, expect } from 'vitest'
import { groupEvents, groupKills, mmss, participationPct, relDeltaPct, seriesRuns, sheetFromPlayerStats, summarizeEvents, vodHref, zonesOf } from '../../src/lib/playerSheetView'
import type { PlayerEvent, PlayerSessionStats } from '../../src/lib/playerSessionStatsCore'

const ev = (o: Partial<PlayerEvent>): PlayerEvent => ({
  gameId: 'g1', gameIndex: 1, atSec: 300, clock: '5:00', x: 1, y: 1, zone: 'mid-lane', early: true, isolated: false,
  otherChampion: 'Zed', assisters: 0, vodSeekSec: 290, ...o,
})

describe('groupEvents / groupKills', () => {
  it('returns null without a timeline (≠ no death)', () => {
    expect(groupEvents(null)).toBeNull()
    expect(groupEvents([])).toEqual({ early: [], isolatedLate: [], unknownLate: [], otherLate: [] })
    expect(groupKills(undefined)).toBeNull()
  })
  it('splits early / isolated late / unknown-position late deaths; unknown is never counted as not isolated', () => {
    const e = [ev({ early: true }), ev({ early: false, isolated: true, atSec: 900 }), ev({ early: false, isolated: null, atSec: 1000 }), ev({ early: false, isolated: false, atSec: 1100 })]
    const g = groupEvents(e)!
    expect([g.early.length, g.isolatedLate.length, g.unknownLate.length, g.otherLate.length]).toEqual([1, 1, 1, 1])
    const k = groupKills([ev({ isolated: true }), ev({ isolated: null }), ev({ isolated: false })])!
    expect([k.isolated.length, k.unknown.length, k.other.length]).toEqual([1, 1, 1])
  })
  it('summarizes counts and zones', () => {
    const s = summarizeEvents([ev({}), ev({ zone: 'bot-lane', early: false, isolated: null }), ev({ zone: null })])!
    expect(s).toMatchObject({ total: 3, early: 2, isolated: 0, judged: 2 })
    expect(zonesOf(s)).toEqual([['mid-lane', 1], ['bot-lane', 1]])
    expect(summarizeEvents(null)).toBeNull()
    expect(zonesOf(null)).toEqual([])
  })
})

describe('small helpers', () => {
  it('vodHref keeps game time (the player applies the recording offset) and never goes negative', () => {
    expect(vodHref('rec 1', 290.4)).toBe('/record/rec%201?at=290')
    expect(vodHref('r', -5)).toBe('/record/r?at=0')
  })
  it('seriesRuns breaks the line on a null instead of drawing 0', () => {
    expect(seriesRuns([1, 2, null, 3, null, null, 4, 5]).map((r) => r.map((p) => p.minute))).toEqual([[0, 1], [3], [6, 7]])
    expect(seriesRuns([null, null])).toEqual([])
    expect(seriesRuns([0, 0])[0].map((p) => p.value)).toEqual([0, 0])
  })
  it('relDeltaPct / participationPct / mmss handle missing values', () => {
    expect(relDeltaPct(110, 100)).toBeCloseTo(10)
    expect(relDeltaPct(null, 100)).toBeNull()
    expect(relDeltaPct(5, 0)).toBeNull()
    expect(participationPct({ ours: 4, participated: 3 })).toBe(75)
    expect(participationPct({ ours: 0, participated: 0 })).toBeNull()
    expect(mmss(125)).toBe('2:05')
    expect(mmss(null)).toBe('—')
  })
})

const synergy = (id: string, kills: number, name = id) => ({
  memberId: id, displayName: name, role: 'MID', gamesPlayed: 1, wins: 1, winRate: 100,
  averages: { kda: 3, kills, deaths: 2, assists: 4, cs: 200, csPerMin: 7, damage: 20000, damagePerMin: 700, damageTaken: 1, ccTime: 1, visionScore: 20, wardsPlaced: 1, wardsKilled: 1, controlWards: 1, gold: 12000, goldPerMin: 400, xpPerMin: 500, damagePerGold: 1.5 },
  shares: { damagePct: 25, goldPct: 20, visionPct: 20, damageTakenPct: 20, ccPct: 20, kpPct: 60 },
  byChampion: [{ championKey: 'Ahri', games: 1, wins: 1, winRate: 100 }],
})
const game = (i: number, opp: string | null) => ({ gameId: `g${i}`, gameIndex: i, win: i % 2 === 1, durationSec: 1800, championKey: 'Ahri', base: synergy('me', i), opponent: opp ? synergy('foe', 2, opp) : null, laneSummary: null }) as unknown as PlayerSessionStats['games'][number]

describe('sheetFromPlayerStats (solo)', () => {
  const stats = {
    source: 'solo', memberId: 'me', displayName: 'Me', role: 'MID', gamesCounted: 2, games: [game(1, 'Zed'), game(2, 'Zed')],
    total: { base: synergy('me', 1.5) }, unavailableGames: [{ gameId: 'g3', gameIndex: 3, reason: 'no-match' }, { gameId: 'g4', gameIndex: 4, reason: 'not-a-player' }],
  } as unknown as PlayerSessionStats

  it('session: mean line, merged opponent, unavailable games as gaps in order', () => {
    const s = sheetFromPlayerStats(stats, null)
    expect(s).toMatchObject({ source: 'solo', status: 'ready', playerFound: true, gamesCounted: 2, gamesTotal: 4, gamesWithStats: 2, partial: false, missing: [] })
    expect(s.series.map((p) => [p.index, p.status, p.played])).toEqual([[1, 'ready', true], [2, 'ready', true], [3, 'error', false], [4, 'ready', false]])
    expect(s.duel?.enemy?.displayName).toBe('Zed')
    expect(s.series[2].kda).toBeNull()
  })
  it('one game: its own line and opponent; an unavailable game has no line', () => {
    expect(sheetFromPlayerStats(stats, 2)).toMatchObject({ gameIndex: 2, status: 'ready', playerFound: true, gamesCounted: 1 })
    expect(sheetFromPlayerStats(stats, 2).line!.averages.kills).toBe(2)
    expect(sheetFromPlayerStats(stats, 3)).toMatchObject({ status: 'error', playerFound: false, duel: null })
    expect(sheetFromPlayerStats(stats, 4)).toMatchObject({ status: 'ready', playerFound: false })
    expect(sheetFromPlayerStats(stats, 9).status).toBe('unknown-game')
  })
  it('different opponents: no single name', () => {
    const mixed = { ...stats, games: [game(1, 'Zed'), game(2, 'Lux')] } as PlayerSessionStats
    expect(sheetFromPlayerStats(mixed, null).duel?.enemy?.displayName).toBe('')
  })
  it('no game at all: no-data, or the reason when every game is unavailable', () => {
    expect(sheetFromPlayerStats({ ...stats, games: [], unavailableGames: [] } as PlayerSessionStats, null).status).toBe('no-data')
    expect(sheetFromPlayerStats({ ...stats, games: [], unavailableGames: [{ gameId: 'g1', gameIndex: 1, reason: 'no-side' }] } as PlayerSessionStats, null)).toMatchObject({ status: 'no-side', playerFound: false })
  })
})

import { localGameIdOf, localGamesByMatch, needsMatchLookup } from '../../src/lib/vodResolve'

describe('vodResolve (which local game holds the recording)', () => {
  const byMatch = localGamesByMatch([{ id: 'local-1', matchId: 'EUW1_100' }, { id: 'local-2', matchId: null }, { id: 'local-3', matchId: 'EUW1_300' }])
  const matchIdOf = { teamA: 'EUW1_100', teamB: 'EUW1_999' }
  it('indexes the local games by Riot match id, skipping rows without one', () => {
    expect([...byMatch.entries()]).toEqual([['EUW1_100', 'local-1'], ['EUW1_300', 'local-3']])
  })
  it('team game: match id → local Game.id; unknown match → null (no recording on this PC)', () => {
    expect(localGameIdOf('teamA', matchIdOf, byMatch)).toBe('local-1')
    expect(localGameIdOf('teamB', matchIdOf, byMatch)).toBeNull()
    expect(localGameIdOf('teamA', matchIdOf, null)).toBeNull()
  })
  it('solo game: its id already is the local Game.id', () => {
    expect(localGameIdOf('local-3', undefined, null)).toBe('local-3')
    expect(localGameIdOf('local-3', matchIdOf, byMatch)).toBe('local-3')
  })
  it('only team games need the history lookup', () => {
    expect(needsMatchLookup(['teamA'], matchIdOf)).toBe(true)
    expect(needsMatchLookup(['local-3'], matchIdOf)).toBe(false)
    expect(needsMatchLookup(['teamA'], undefined)).toBe(false)
  })
})
