import { describe, expect, it } from 'vitest'
import { FLAME_PALETTES, flameIntensity, flameTier } from '../../src/lib/awardFlame'

describe('flameTier', () => {
  it('follows the MVP streak thresholds', () => {
    expect(flameTier(1)).toBe('grey')
    expect(flameTier(2)).toBe('white')
    expect(flameTier(3)).toBe('blue')
    expect(flameTier(4)).toBe('blue')
    expect(flameTier(5)).toBe('red')
    expect(flameTier(7)).toBe('red')
    expect(flameTier(8)).toBe('purple')
    expect(flameTier(30)).toBe('purple')
  })

  it('shows no flame without a won week', () => {
    expect(flameTier(0)).toBeNull()
    expect(flameTier(-2)).toBeNull()
    expect(flameTier(Number.NaN)).toBeNull()
  })

  it('has a palette for every tier', () => {
    for (const s of [1, 2, 3, 5, 8]) expect(FLAME_PALETTES[flameTier(s)!]).toBeDefined()
  })

  it('burns bigger and faster as the tier climbs', () => {
    const scales = (['grey', 'white', 'blue', 'red', 'purple'] as const).map((t) => flameIntensity(t).scale)
    expect(scales).toEqual([0.78, 0.89, 1, 1.11, 1.22])
    expect(flameIntensity('purple').speed).toBeLessThan(flameIntensity('grey').speed)
  })
})
