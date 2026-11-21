/** « Review courte » (20/11/2026): marks a game reviewed without a review record, never over a full review. */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ games: new Map<string, { reviewStatus: string; review: { id: string } | null }>(), updates: 0 }))
vi.mock('../../electron/main/database', () => ({
  getPrisma: () => ({
    game: {
      findUnique: async ({ where }: any) => h.games.get(where.id) ?? null,
      update: async ({ where, data }: any) => { h.updates++; Object.assign(h.games.get(where.id)!, data); return {} },
    },
  }),
}))
import { markShortReview } from '../../electron/main/shortReview'

beforeEach(() => { h.games.clear(); h.updates = 0 })

describe('markShortReview', () => {
  it('a pending or postponed game becomes reviewed, with no review record', async () => {
    h.games.set('g1', { reviewStatus: 'pending', review: null })
    h.games.set('g2', { reviewStatus: 'to_be_reviewed', review: null })
    expect(await markShortReview('g1', 'player')).toEqual({ reviewStatus: 'reviewed' })
    expect(await markShortReview('g2', 'microReview')).toEqual({ reviewStatus: 'reviewed' })
    expect(h.games.get('g1')!.reviewStatus).toBe('reviewed')
    expect(h.games.get('g2')!.reviewStatus).toBe('reviewed')
  })
  it('never touches a full review, and is idempotent', async () => {
    h.games.set('full', { reviewStatus: 'reviewed', review: { id: 'r' } })
    h.games.set('done', { reviewStatus: 'reviewed', review: null })
    await markShortReview('full', 'player')
    await markShortReview('done', 'player')
    expect(h.updates).toBe(0)
  })
  it('an unknown game fails', async () => {
    await expect(markShortReview('nope', 'player')).rejects.toThrow('NOT_FOUND')
  })
})
