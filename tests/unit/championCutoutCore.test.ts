import { describe, it, expect } from 'vitest'
import { deflateSync, inflateSync } from 'zlib'
import {
  CUTOUT_MODEL, cutoutCacheKey, artCrop, toInputTensor, maskFromLogits, levels, removeSpecks, boxBlur, fadeEdges,
  refineMask, maskCoverage, isUsableMask, composeRgba, crc32, encodePng,
} from '../../src/lib/championCutoutCore'

describe('cutoutCacheKey', () => {
  it('names the file after the champion and skin', () => {
    expect(cutoutCacheKey('MonkeyKing')).toBe('MonkeyKing_0')
    expect(cutoutCacheKey('Ahri', 12)).toBe('Ahri_12')
  })
  it('refuses anything that could leave the cache folder', () => {
    expect(cutoutCacheKey('../evil')).toBeNull()
    expect(cutoutCacheKey('Ahri/x')).toBeNull()
    expect(cutoutCacheKey('')).toBeNull()
    expect(cutoutCacheKey('Ahri', -1)).toBeNull()
    expect(cutoutCacheKey('Ahri', 1.5)).toBeNull()
  })
})

describe('artCrop', () => {
  it('drops the vignette of a 308×560 loading art', () => {
    expect(artCrop(308, 560)).toEqual({ x: 14, y: 14, w: 280, h: 524 })
  })
  it('scales for other sizes', () => {
    expect(artCrop(616, 1120)).toEqual({ x: 28, y: 28, w: 560, h: 1048 })
  })
})

describe('toInputTensor', () => {
  it('turns BGRA into normalised RGB planes', () => {
    // 2×2 image, all pixels R=255 G=0 B=0 (BGRA order: 0,0,255,255).
    const bgra = new Uint8Array(16)
    for (let i = 0; i < 4; i++) bgra.set([0, 0, 255, 255], i * 4)
    const t = toInputTensor(bgra, 2, 2, { x: 0, y: 0, w: 2, h: 2 }, 4, [0.5, 0.5, 0.5], [0.5, 0.5, 0.5])
    expect(t.length).toBe(3 * 16)
    expect(t[0]).toBeCloseTo(1) // R plane: (1 - 0.5) / 0.5
    expect(t[16]).toBeCloseTo(-1) // G plane
    expect(t[32]).toBeCloseTo(-1) // B plane
  })
  it('samples only the crop', () => {
    // 3×1: black, white, black; the crop keeps the white pixel.
    const bgra = new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255])
    const t = toInputTensor(bgra, 3, 1, { x: 1, y: 0, w: 1, h: 1 }, 2, [0, 0, 0], [1, 1, 1])
    expect(Array.from(t.subarray(0, 4))).toEqual([1, 1, 1, 1])
  })
  it('uses the model defaults', () => {
    const bgra = new Uint8Array(4).fill(255)
    expect(toInputTensor(bgra, 1, 1, { x: 0, y: 0, w: 1, h: 1 }).length).toBe(3 * CUTOUT_MODEL.inputSize ** 2)
  })
})

describe('maskFromLogits', () => {
  it('applies the sigmoid and resizes', () => {
    const logits = new Float32Array([-20, 20, -20, 20]) // 2×2: left 0, right 1
    const m = maskFromLogits(logits, 2, 4, 2)
    expect(m[0]).toBe(0)
    expect(m[3]).toBe(255)
    expect(m[1]).toBeGreaterThan(0)
    expect(m[1]).toBeLessThan(m[2])
  })
  it('gives 128 for a zero logit', () => {
    expect(maskFromLogits(new Float32Array([0]), 1, 1, 1)[0]).toBe(128)
  })
})

describe('levels', () => {
  it('clears haze and fills the near-opaque', () => {
    expect(Array.from(levels(new Uint8Array([10, 28, 126, 225, 240]), 28, 225))).toEqual([0, 0, 127, 255, 255])
  })
})

describe('removeSpecks', () => {
  it('drops small islands and keeps the largest', () => {
    // 6×3: a 6-pixel blob on the left, a 1-pixel speck on the right.
    const m = new Uint8Array([
      255, 255, 0, 0, 0, 0,
      255, 255, 0, 0, 0, 200,
      255, 255, 0, 0, 0, 0,
    ])
    const out = removeSpecks(m, 6, 3, 3)
    expect(out[11]).toBe(0)
    expect(out[0]).toBe(255)
  })
  it('keeps islands of the minimum size and diagonal neighbours', () => {
    const m = new Uint8Array([
      255, 0, 0, 0,
      0, 255, 0, 255,
      0, 0, 0, 255,
    ])
    const out = removeSpecks(m, 4, 3, 2)
    expect(Array.from(out)).toEqual(Array.from(m))
  })
  it('keeps the largest island even when small', () => {
    const m = new Uint8Array([0, 255, 0])
    expect(removeSpecks(m, 3, 1, 100)[1]).toBe(255)
  })
})

describe('boxBlur', () => {
  it('softens an edge and keeps flat areas', () => {
    const m = new Uint8Array([0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255]) // 4×3
    const out = boxBlur(m, 4, 3)
    expect(out[0]).toBe(0)
    expect(out[3]).toBe(255)
    expect(out[1]).toBe(85)
    expect(out[2]).toBe(170)
  })
})

describe('fadeEdges', () => {
  it('fades the top and right edges only', () => {
    const m = new Uint8Array(10 * 10).fill(255)
    const out = fadeEdges(m, 10, 10, 0.3, 0.3)
    expect(out[0]).toBe(0) // top row
    expect(out[9 * 10 + 9]).toBe(0) // right column
    expect(out[9 * 10]).toBe(255) // bottom-left stays
    expect(out[5 * 10 + 2]).toBe(255) // inside
    expect(out[1 * 10 + 2]).toBeGreaterThan(0)
    expect(out[1 * 10 + 2]).toBeLessThan(255)
  })
  it('does nothing with no bands', () => {
    const m = new Uint8Array(9).fill(200)
    expect(Array.from(fadeEdges(m, 3, 3, 0, 0))).toEqual(Array.from(m))
  })
})

describe('refineMask', () => {
  it('chains levels, specks, feathering and the edge fade', () => {
    const w = 20
    const h = 20
    const m = new Uint8Array(w * h)
    for (let y = 5; y < 20; y++) for (let x = 0; x < 12; x++) m[y * w + x] = 240
    m[2 * w + 17] = 250 // speck
    for (let i = 0; i < m.length; i++) if (m[i] === 0) m[i] = 15 // haze
    const out = refineMask(m, w, h, { minSpeck: 0.01 })
    expect(out[2 * w + 17]).toBe(0)
    expect(out[0]).toBe(0)
    expect(out[15 * w + 4]).toBe(255)
    expect(out[15 * w + 12]).toBeGreaterThan(0) // feathered edge
    expect(out[15 * w + 12]).toBeLessThan(255)
  })
})

describe('coverage', () => {
  it('measures the share of opaque pixels', () => {
    expect(maskCoverage(new Uint8Array([255, 0, 255, 0]))).toBe(0.5)
    expect(maskCoverage(new Uint8Array(0))).toBe(0)
  })
  it('rejects masks that kept almost nothing or almost everything', () => {
    const make = (share: number): Uint8Array => {
      const m = new Uint8Array(100)
      m.fill(255, 0, Math.round(share * 100))
      return m
    }
    expect(isUsableMask(make(0.05))).toBe(false)
    expect(isUsableMask(make(0.5))).toBe(true)
    expect(isUsableMask(make(0.98))).toBe(false)
  })
})

describe('composeRgba', () => {
  it('crops, swaps BGRA to RGBA and sets the alpha', () => {
    const bgra = new Uint8Array([1, 2, 3, 255, 10, 20, 30, 255]) // 2×1
    const out = composeRgba(bgra, 2, { x: 1, y: 0, w: 1, h: 1 }, new Uint8Array([77]))
    expect(Array.from(out)).toEqual([30, 20, 10, 77])
  })
})

describe('PNG', () => {
  it('computes the standard CRC-32', () => {
    const bytes = new TextEncoder().encode('123456789')
    expect((crc32(bytes) ^ 0xffffffff) >>> 0).toBe(0xcbf43926)
  })
  it('writes a valid RGBA PNG', () => {
    const rgba = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 128])
    const png = encodePng(rgba, 2, 1, (b) => deflateSync(b))
    expect(Array.from(png.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const view = new DataView(png.buffer, png.byteOffset)
    expect(String.fromCharCode(...png.subarray(12, 16))).toBe('IHDR')
    expect(view.getUint32(16)).toBe(2)
    expect(view.getUint32(20)).toBe(1)
    expect(png[25]).toBe(6)
    const idatLen = view.getUint32(33)
    expect(String.fromCharCode(...png.subarray(37, 41))).toBe('IDAT')
    const raw = inflateSync(png.subarray(41, 41 + idatLen))
    expect(Array.from(raw)).toEqual([0, ...rgba])
    expect(String.fromCharCode(...png.subarray(png.length - 8, png.length - 4))).toBe('IEND')
  })
})
