import { describe, it, expect } from 'vitest'
import { MIN_GAMES, wrBar, wrLevel, wrPill, wrText } from '../../src/lib/winrate'

// K (UX-3): the one win-rate scale (docs/DESIGN_STATE.md § 9).
describe('wrLevel', () => {
  it('uses the four steps ≥ 60 / 50–59 / 40–49 / < 40', () => {
    expect([100, 60, 59.9, 50, 49, 40, 39.5, 0].map((w) => wrLevel(w))).toEqual(['high', 'high', 'mid', 'mid', 'low', 'low', 'bad', 'bad'])
  })

  it('a small sample has no step colour', () => {
    expect(wrLevel(100, MIN_GAMES - 1)).toBe('sample')
    expect(wrLevel(100, MIN_GAMES)).toBe('high')
    expect(wrLevel(30, 50, true)).toBe('sample')
    expect(wrLevel(30, null)).toBe('bad') // games unknown: the step colour
  })
})

describe('classes', () => {
  it('text, pill and bar follow the step, dim for a small sample', () => {
    expect(wrText(65)).toBe('text-wr-high')
    expect(wrPill(45)).toBe('bg-wr-low/15 text-wr-low')
    expect(wrBar(20)).toBe('bg-wr-bad')
    expect(wrText(65, 1)).toBe('text-hextech-text-dim')
  })
})
