import { describe, it, expect } from 'vitest'
import { gamesAwaitingDecision, planEndOfGame } from '../../src/lib/teamSessionReviewsCore'
import type { TeamSessionGame } from '../../src/lib/teamSessions'
import type { TeamSessionReview } from '../../src/lib/teamSessionReviews'

const game = (id: string, status: TeamSessionGame['status'] = 'pending_fetch') => ({ id, sessionId: 's', matchId: id, reportedBy: null, status, createdAt: '', matchJson: null, ourTeamId: null, enemyTeamName: null }) as TeamSessionGame
const review = (gameId: string | null, status: TeamSessionReview['status'] = 'deferred') => ({ id: `r${gameId}`, sessionId: 's', gameId, scope: gameId ? 'per_game' : 'session', status }) as TeamSessionReview

describe('gamesAwaitingDecision', () => {
  it('asks about a reported game even before its match is fetched', () => {
    expect(gamesAwaitingDecision([game('a')], []).map((g) => g.id)).toEqual(['a'])
  })
  it('skips decided, errored and dismissed games', () => {
    const games = [game('a', 'fetched'), game('b'), game('c', 'error'), game('d')]
    expect(gamesAwaitingDecision(games, [review('a'), review(null)], new Set(['d'])).map((g) => g.id)).toEqual(['b'])
  })
})

describe('planEndOfGame', () => {
  it('not the last game, no review → defer this game only', () => {
    expect(planEndOfGame('g', { reviewNow: false, lastGame: false, finalReviewNow: false }))
      .toEqual({ deferGameReview: true, endSession: false, deferFinalReview: false, open: null })
  })
  it('review now → open that game and record', () => {
    expect(planEndOfGame('g', { reviewNow: true, lastGame: false, finalReviewNow: false }).open).toEqual({ gameId: 'g', final: false })
  })
  it('last game + final review another day → end session and leave a reminder', () => {
    expect(planEndOfGame('g', { reviewNow: false, lastGame: true, finalReviewNow: false }))
      .toEqual({ deferGameReview: true, endSession: true, deferFinalReview: true, open: null })
  })
  it('last game + game review + final now → game review first, then the final review', () => {
    expect(planEndOfGame('g', { reviewNow: true, lastGame: true, finalReviewNow: true }))
      .toEqual({ deferGameReview: false, endSession: true, deferFinalReview: false, open: { gameId: 'g', final: true } })
  })
  it('final now without a game review opens the final review directly', () => {
    expect(planEndOfGame('g', { reviewNow: false, lastGame: true, finalReviewNow: true }).open).toEqual({ gameId: null, final: true })
  })
})
