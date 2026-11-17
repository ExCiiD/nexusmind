import { describe, it, expect } from 'vitest'
import { sanitizeAppearance, appearanceVars, DEFAULT_APPEARANCE } from '../../src/lib/appearance'

describe('sanitizeAppearance', () => {
  it('falls back to defaults on garbage', () => {
    expect(sanitizeAppearance(null)).toEqual(DEFAULT_APPEARANCE)
    expect(sanitizeAppearance('nope')).toEqual(DEFAULT_APPEARANCE)
  })

  it('rejects unknown images, bad colors and clamps ranges', () => {
    const p = sanitizeAppearance({ imageId: 'missing', tintColor: 'red', dim: 400, blur: -3, tintStrength: 55, mode: 'color', solidColor: '#123456' })
    expect(p.imageId).toBe(DEFAULT_APPEARANCE.imageId)
    expect(p.tintColor).toBe(DEFAULT_APPEARANCE.tintColor)
    expect(p.dim).toBe(95)
    expect(p.blur).toBe(0)
    expect(p.tintStrength).toBe(55)
    expect(p).toMatchObject({ mode: 'color', solidColor: '#123456' })
  })
})

describe('appearanceVars', () => {
  it('drops the image and the filter in solid-color mode', () => {
    const v = appearanceVars({ ...DEFAULT_APPEARANCE, mode: 'color', solidColor: '#101826', tintStrength: 80 })
    expect(v['--app-bg-image']).toBe('none')
    expect(v['--app-bg-color']).toBe('#101826')
    expect(v['--app-bg-tint-opacity']).toBe('0')
  })

  it('maps dim to brightness', () => {
    expect(appearanceVars({ ...DEFAULT_APPEARANCE, dim: 70 })['--app-bg-brightness']).toBe('0.3')
  })
})
