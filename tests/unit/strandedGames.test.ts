import { describe, it, expect } from 'vitest'
import { pickMatchForProvisional, provisionalStartMs, type CandidateMatch } from '../../electron/main/strandedGamesCore'

const MIN = 60_000
// A Yunara game started at 19:00, written provisional at 19:27.
const startedAt = Date.UTC(2026, 10, 18, 19, 0)
const endedAt = startedAt + 27 * MIN
const match = (over: Partial<CandidateMatch>): CandidateMatch => ({
  matchId: 'EUW1_1', gameStartTimestamp: startedAt + 2 * MIN, gameEndTimestamp: endedAt - MIN, championName: 'Yunara', ...over,
})

describe('provisionalStartMs', () => {
  it('reads the start time of a provisional id only', () => {
    expect(provisionalStartMs(`live_${startedAt}`)).toBe(startedAt)
    expect(provisionalStartMs('EUW1_8050377418')).toBeNull()
    expect(provisionalStartMs('live_abc')).toBeNull()
  })
})

describe('pickMatchForProvisional', () => {
  const game = { startedAt, endedAt, champion: 'Yunara' }

  it('finds the match within the time tolerance, same champion', () => {
    expect(pickMatchForProvisional(game, [match({})])?.matchId).toBe('EUW1_1')
  })

  it('ignores a match with another champion or far in time', () => {
    expect(pickMatchForProvisional(game, [match({ championName: 'Jinx' })])).toBeNull()
    expect(pickMatchForProvisional(game, [match({ gameStartTimestamp: startedAt - 60 * MIN, gameEndTimestamp: startedAt - 30 * MIN })])).toBeNull()
  })

  it('keeps the closest of two candidates', () => {
    const picked = pickMatchForProvisional(game, [
      match({ matchId: 'EUW1_far', gameStartTimestamp: startedAt + 7 * MIN, gameEndTimestamp: endedAt + 9 * MIN }),
      match({ matchId: 'EUW1_near' }),
    ])
    expect(picked?.matchId).toBe('EUW1_near')
  })

  it('accepts any champion when the provisional row has none', () => {
    expect(pickMatchForProvisional({ ...game, champion: '' }, [match({ championName: 'Ezreal' })])?.matchId).toBe('EUW1_1')
  })
})
