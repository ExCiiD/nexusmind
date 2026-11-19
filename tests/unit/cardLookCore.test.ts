import { describe, it, expect } from 'vitest'
import { cardLookStyle, sanitizeCardLook, DEFAULT_CARD_LOOK, CARD_BACKGROUNDS, CARD_PATTERN_OPACITY } from '../../src/lib/cardLookCore'

describe('sanitizeCardLook', () => {
  it('falls back to the defaults', () => {
    expect(sanitizeCardLook(null)).toEqual(DEFAULT_CARD_LOOK)
    expect(sanitizeCardLook({ background: 'nope', tintColor: 'red', tintStrength: 'x', blur: -3, light: 400 }))
      .toEqual({ ...DEFAULT_CARD_LOOK, blur: 0, light: 100 })
  })

  it('keeps valid values', () => {
    expect(sanitizeCardLook({ background: 'circuit', tintColor: '#a97bf0', tintStrength: 55.4, blur: 3, light: -40 }))
      .toEqual({ background: 'circuit', tintColor: '#A97BF0', tintStrength: 55, blur: 3, light: -40 })
  })

  it('has an opacity for every pattern', () => {
    for (const id of CARD_BACKGROUNDS) expect(CARD_PATTERN_OPACITY[id]).toBeGreaterThan(0)
  })
})

describe('cardLookStyle', () => {
  it('draws nothing extra by default', () => {
    expect(cardLookStyle(DEFAULT_CARD_LOOK)).toEqual({ filter: 'none', tint: null })
  })

  it('builds blur, light and tint, the blur scaled', () => {
    const s = cardLookStyle({ ...DEFAULT_CARD_LOOK, blur: 4, light: -50, tintStrength: 30, tintColor: '#E0473A' }, 2)
    expect(s.filter).toBe('blur(8px) brightness(0.7) saturate(0.9)')
    expect(s.tint).toEqual({ color: '#E0473A', opacity: 0.3 })
  })
})
