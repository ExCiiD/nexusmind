import { describe, expect, it } from 'vitest'
import { FLAME_PALETTES, flameIntensity, flameTier, hexToRgb01 } from '../../src/lib/awardFlame'

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

describe('hexToRgb01', () => {
  it('turns a hex colour into shader floats', () => {
    expect(hexToRgb01('#ff0000')).toEqual([1, 0, 0])
    expect(hexToRgb01('336699')).toEqual([0.2, 0.4, 0.6])
  })

  it('falls back to white on anything else', () => {
    expect(hexToRgb01('rgba(1,2,3,1)')).toEqual([1, 1, 1])
  })

  it('parses every palette colour the shader reads', () => {
    for (const p of Object.values(FLAME_PALETTES)) {
      for (const c of [p.deep, p.mid, p.light, p.core]) expect(/^#[0-9a-f]{6}$/i.test(c)).toBe(true)
    }
  })
})
