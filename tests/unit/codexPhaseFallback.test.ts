import { describe, it, expect } from 'vitest'
import { codexFor } from '../../src/lib/microReview/codex'

describe('codexFor: nearest phase when the tag has no card for the game phase', () => {
  it.each(['walked-into-ward', 'xp-deficit', 'behind-on-levels-death'])('%s in late game falls back on a mid card, not early', (slug) => {
    expect(codexFor(slug, 'MIDDLE', 'late')?.phase).toBe('mid')
  })

  it.each(['walked-into-ward', 'xp-deficit', 'behind-on-levels-death'])('%s keeps its exact-phase card when one exists', (slug) => {
    expect(codexFor(slug, 'MIDDLE', 'mid')?.phase).toBe('mid')
  })

  it('early still resolves to an early card when the tag has one', () => {
    expect(codexFor('xp-deficit', 'MIDDLE', 'early')?.phase).toBe('early')
  })
})
