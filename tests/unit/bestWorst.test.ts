import { describe, it, expect } from 'vitest'
import { computeBestWorstProfile, MIN_GAMES } from '../../electron/main/assistant/bestWorst'
import { attachPerfIndex, computeGameFeatures, type GameFeatures, type GameRecord } from '../../electron/main/assistant/features'

let seq = 0
function mk(over: Partial<GameRecord> = {}): GameRecord {
  seq++
  return {
    id: `g${seq}`, matchId: `m${seq}`, sessionId: 's1', endedAt: Date.now() - seq * 1000,
    durationSec: 1800, win: true, kills: 4, deaths: 4, assists: 6, cs: 180, visionScore: 20,
    role: 'MIDDLE', champion: 'Ahri', objectiveIds: ['tempo'], reviewed: false,
    ...over,
  }
}
function withPerfIndex(records: GameRecord[]): GameFeatures[] {
  const games = records.map(computeGameFeatures)
  attachPerfIndex(games)
  return games
}

describe('computeBestWorstProfile', () => {
  it('returns null under the minimum game count', () => {
    const games = withPerfIndex(Array.from({ length: MIN_GAMES - 1 }, () => mk()))
    expect(computeBestWorstProfile(games)).toBeNull()
  })

  it('splits the top/bottom 20% by perfIndex and reports the biggest gaps first', () => {
    // 10 strong games (low deaths, high CS/vision/KDA) and 10 weak games.
    const strong = Array.from({ length: 10 }, () => mk({ deaths: 1, kills: 8, assists: 6, cs: 260, visionScore: 35 }))
    const weak = Array.from({ length: 10 }, () => mk({ deaths: 8, kills: 1, assists: 2, cs: 120, visionScore: 10 }))
    const games = withPerfIndex([...strong, ...weak])
    const profile = computeBestWorstProfile(games)!
    expect(profile.games).toBe(20)
    expect(profile.bestGames).toBe(4) // round(20 * 0.2)
    expect(profile.worstGames).toBe(4)
    expect(profile.indicators.length).toBeGreaterThan(0)
    // Every gap must be non-negative (best group should look better on every listed indicator).
    for (const ind of profile.indicators) expect(ind.gap).toBeGreaterThanOrEqual(0)
    // deaths: lower is better, so bestMean (strong games) must be LOWER than worstMean, yet gap is positive.
    const deaths = profile.indicators.find((i) => i.metric === 'deaths')
    if (deaths) expect(deaths.bestMean).toBeLessThan(deaths.worstMean)
    // csPerMin: higher is better, bestMean must be HIGHER.
    const cs = profile.indicators.find((i) => i.metric === 'csPerMin')
    if (cs) expect(cs.bestMean).toBeGreaterThan(cs.worstMean)
    // Sorted by gap descending.
    const gaps = profile.indicators.map((i) => i.gap)
    expect(gaps).toEqual([...gaps].sort((a, b) => b - a))
  })

  it('caps the group size at a minimum of 2 games even with very few total games', () => {
    const games = withPerfIndex(Array.from({ length: MIN_GAMES }, (_, i) => mk({ deaths: i, cs: 150 + i * 5 })))
    const profile = computeBestWorstProfile(games)!
    expect(profile.bestGames).toBeGreaterThanOrEqual(2)
    expect(profile.worstGames).toBeGreaterThanOrEqual(2)
  })

  it('ignores games with no perfIndex when counting toward the minimum', () => {
    const withData = Array.from({ length: MIN_GAMES }, () => mk())
    const games = withPerfIndex(withData)
    games[0].values.perfIndex = null
    games[1].values.perfIndex = null
    expect(computeBestWorstProfile(games)).toBeNull() // only 8 left, below MIN_GAMES
  })
})
