import { describe, it, expect } from 'vitest'
import { gamesNeedingReviewPrompt, isReviewReopenable, isReviewDone } from '../../src/lib/teamSessionReviewsCore'
import type { TeamSessionReview } from '../../src/lib/teamSessionReviews'
import type { TeamSessionGame } from '../../src/lib/teamSessions'

function game(overrides: Partial<TeamSessionGame>): TeamSessionGame {
  return {
    id: 'g1', sessionId: 's1', matchId: 'EUW1_1', reportedBy: null, status: 'fetched', createdAt: '2026-01-01',
    matchJson: null, ourTeamId: null, enemyTeamName: null,
    ...overrides,
  }
}
function review(overrides: Partial<TeamSessionReview>): TeamSessionReview {
  return {
    id: 'r1', sessionId: 's1', gameId: 'g1', scope: 'per_game', recordedBy: null, recordingLocalPath: null,
    youtubeUrl: null, youtubeVisibility: 'unlisted', transcript: null, summary: null, status: 'pending',
    createdAt: '2026-01-01', updatedAt: '2026-01-01',
    ...overrides,
  }
}

describe('gamesNeedingReviewPrompt', () => {
  it('includes a fetched game with no review row at all', () => {
    const games = [game({ id: 'g1', status: 'fetched' })]
    expect(gamesNeedingReviewPrompt(games, [])).toEqual(games)
  })

  it('excludes a game still pending_fetch', () => {
    const games = [game({ id: 'g1', status: 'pending_fetch' })]
    expect(gamesNeedingReviewPrompt(games, [])).toEqual([])
  })

  it('excludes a game that already has any review row, deferred included', () => {
    const games = [game({ id: 'g1', status: 'fetched' }), game({ id: 'g2', status: 'fetched' })]
    const reviews = [review({ gameId: 'g1', status: 'deferred' })]
    expect(gamesNeedingReviewPrompt(games, reviews).map((g) => g.id)).toEqual(['g2'])
  })

  it('ignores session/meeting-scoped reviews (game_id null) when matching', () => {
    const games = [game({ id: 'g1', status: 'fetched' })]
    const reviews = [review({ gameId: null, scope: 'session' })]
    expect(gamesNeedingReviewPrompt(games, reviews)).toEqual(games)
  })
})

describe('isReviewReopenable', () => {
  it('is true only for a deferred review', () => {
    expect(isReviewReopenable(review({ status: 'deferred' }))).toBe(true)
    expect(isReviewReopenable(review({ status: 'done' }))).toBe(false)
    expect(isReviewReopenable(review({ status: 'pending' }))).toBe(false)
  })
})

describe('isReviewDone', () => {
  it('is true only for a done review, handles null/undefined', () => {
    expect(isReviewDone(review({ status: 'done' }))).toBe(true)
    expect(isReviewDone(review({ status: 'deferred' }))).toBe(false)
    expect(isReviewDone(null)).toBe(false)
    expect(isReviewDone(undefined)).toBe(false)
  })
})
