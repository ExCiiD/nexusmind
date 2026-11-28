import { describe, expect, it } from 'vitest'
import { AGE_BOUNDS, SIZE_BOUNDS, clampInt } from '@/lib/videoRetentionView'

describe('video retention bounds', () => {
  it('brings a value outside the bounds back to the bound (on blur)', () => {
    expect(clampInt('3', AGE_BOUNDS.min, AGE_BOUNDS.max, AGE_BOUNDS.def)).toBe(7)
    expect(clampInt('900', AGE_BOUNDS.min, AGE_BOUNDS.max, AGE_BOUNDS.def)).toBe(365)
    expect(clampInt('5', SIZE_BOUNDS.min, SIZE_BOUNDS.max, SIZE_BOUNDS.def)).toBe(10)
    expect(clampInt('99999', SIZE_BOUNDS.min, SIZE_BOUNDS.max, SIZE_BOUNDS.def)).toBe(2000)
  })
  it('keeps a valid value, rounds decimals, and falls back on an empty entry', () => {
    expect(clampInt('30', AGE_BOUNDS.min, AGE_BOUNDS.max, AGE_BOUNDS.def)).toBe(30)
    expect(clampInt('12,6', SIZE_BOUNDS.min, SIZE_BOUNDS.max, SIZE_BOUNDS.def)).toBe(13)
    expect(clampInt('', AGE_BOUNDS.min, AGE_BOUNDS.max, AGE_BOUNDS.def)).toBe(30)
    expect(clampInt(' ', SIZE_BOUNDS.min, SIZE_BOUNDS.max, SIZE_BOUNDS.def)).toBe(15)
  })
})
