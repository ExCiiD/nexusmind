import { describe, it, expect } from 'vitest'
import { deflateSync, inflateSync } from 'zlib'
import {
  CUTOUT_MODEL, cutoutCacheKey, cutoutArtUrl, toInputTensor, maskFromLogits, levels, removeSpecks, boxBlur, fadeEdges,
  refineMask, maskCoverage, composeRgba, crc32, encodePng,
  subjectBox, columnWeights, placementWeight, portraitWindow, cropMask, fadeSides, frameSubject,
  CUTOUT_MODELS, fuseMasks, consensusMask, cutoutConfidence, luminance, boxMean, guidedFilter, buildCutout,
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

describe('cutoutArtUrl', () => {
  it('cuts out the full splash, where the champion is whole', () => {
    expect(cutoutArtUrl('LeeSin')).toBe('https://ddragon.leagueoflegends.com/cdn/img/champion/splash/LeeSin_0.jpg')
    expect(cutoutArtUrl('Ahri', 2)).toMatch(/\/splash\/Ahri_2\.jpg$/)
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
})

/** A w×h mask with the given rectangles opaque. */
function maskWith(w: number, h: number, rects: Array<[number, number, number, number]>): Uint8Array {
  const m = new Uint8Array(w * h)
  for (const [x, y, rw, rh] of rects) for (let yy = y; yy < y + rh; yy++) m.fill(255, yy * w + x, yy * w + x + rw)
  return m
}

describe('subjectBox', () => {
  it('bounds the opaque pixels', () => {
    expect(subjectBox(maskWith(10, 10, [[2, 3, 4, 5]]), 10, 10)).toEqual({ x: 2, y: 3, w: 4, h: 5 })
  })
  it('ignores faint alpha and returns null when empty', () => {
    const m = new Uint8Array(100).fill(40)
    expect(subjectBox(m, 10, 10)).toBeNull()
  })
})

describe('columnWeights', () => {
  it('counts the top of the silhouette more than its bottom', () => {
    const m = maskWith(2, 10, [[0, 0, 1, 1], [1, 9, 1, 1]])
    const cols = columnWeights(m, 2, { x: 0, y: 0, w: 2, h: 10 })
    expect(cols[0]).toBe(255)
    expect(cols[1]).toBeCloseTo(255 * 0.25)
  })
})

describe('placementWeight', () => {
  it('wants the body in the open area, not under the name or behind the frame', () => {
    expect(placementWeight(0.4)).toBe(1)
    expect(placementWeight(0.85)).toBeLessThan(1)
    expect(placementWeight(0.02)).toBeLessThan(placementWeight(0.85))
    expect(placementWeight(0.98)).toBeLessThan(placementWeight(0.85))
  })
})

describe('portraitWindow', () => {
  it('takes the silhouette height plus headroom, 0.75 wide, centred when it fits', () => {
    const m = maskWith(200, 120, [[90, 20, 20, 100]])
    const box = subjectBox(m, 200, 120)!
    const r = portraitWindow(m, box, 200, 120)
    expect(r.y).toBe(16)
    expect(r.h).toBe(104)
    expect(r.w).toBe(78)
    expect(r.x + r.w / 2).toBeCloseTo(100, 0)
  })
  it('follows the upper body of a wide pose, not a long low limb', () => {
    // Upper body on the right (x 150–175), a long leg trailing low to the left.
    const m = maskWith(240, 100, [[150, 0, 25, 100], [10, 80, 140, 15]])
    const box = subjectBox(m, 240, 100)!
    const r = portraitWindow(m, box, 240, 100)
    const t = (162 - r.x) / r.w // the torso's position across the window
    expect(t).toBeGreaterThan(0.05)
    expect(t).toBeLessThan(0.74)
  })
  it('stays inside the image', () => {
    const m = maskWith(100, 100, [[0, 0, 100, 100]])
    const r = portraitWindow(m, { x: 0, y: 0, w: 100, h: 100 }, 100, 100)
    expect(r.x).toBeGreaterThanOrEqual(0)
    expect(r.x + r.w).toBeLessThanOrEqual(100)
  })
})

describe('cropMask and fadeSides', () => {
  it('crops the alpha to the window', () => {
    const m = maskWith(6, 4, [[2, 1, 2, 2]])
    expect(Array.from(cropMask(m, 6, { x: 2, y: 1, w: 2, h: 2 }))).toEqual([255, 255, 255, 255])
  })
  it('fades the left and right edges only', () => {
    const out = fadeSides(new Uint8Array(10 * 3).fill(255), 10, 3, 0.3)
    expect(out[0]).toBe(0)
    expect(out[9]).toBe(0)
    expect(out[5]).toBe(255)
    expect(out[2 * 10 + 5]).toBe(255)
  })
})

describe('frameSubject', () => {
  it('frames a champion standing in the splash', () => {
    const m = maskWith(300, 180, [[120, 20, 60, 160]])
    const f = frameSubject(m, 300, 180)
    expect(f).not.toBeNull()
    expect(f!.alpha.length).toBe(f!.rect.w * f!.rect.h)
  })
  it('gives up when the model kept almost nothing (effects-only art)', () => {
    expect(frameSubject(maskWith(300, 180, [[10, 10, 20, 20]]), 300, 180)).toBeNull()
  })
  it('gives up on a short silhouette: a weapon or a pet, not the champion', () => {
    expect(frameSubject(maskWith(300, 180, [[0, 120, 300, 40]]), 300, 180)).toBeNull()
  })
  it('gives up when the scene was kept', () => {
    expect(frameSubject(new Uint8Array(300 * 180).fill(255), 300, 180)).toBeNull()
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

describe('CUTOUT_MODELS', () => {
  it('lists the two BiRefNet models with their hashes and input sizes', () => {
    expect(CUTOUT_MODELS.map((m) => m.inputSize)).toEqual([1024, 512])
    for (const m of CUTOUT_MODELS) {
      expect(m.url).toMatch(/^https:\/\/github\.com\/ZhengPeng7\/BiRefNet\/releases\/download\//)
      expect(m.sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(m.bytes).toBeGreaterThan(100_000_000)
    }
  })
})

describe('fuseMasks and consensusMask', () => {
  const a = new Uint8Array([0, 200, 50, 255])
  const b = new Uint8Array([100, 0, 60, 255])
  it('keeps whatever either model sees', () => {
    expect(Array.from(fuseMasks([a, b]))).toEqual([100, 200, 60, 255])
  })
  it('keeps only what both models see', () => {
    expect(Array.from(consensusMask([a, b]))).toEqual([0, 0, 50, 255])
  })
  it('returns a single mask unchanged', () => {
    expect(Array.from(fuseMasks([a]))).toEqual(Array.from(a))
  })
})

describe('cutoutConfidence', () => {
  it('trusts a champion standing clear of the border', () => {
    const c = cutoutConfidence(maskWith(100, 60, [[30, 10, 40, 45]]), 100, 60)
    expect(c.border).toBe(0)
    expect(c.ok).toBe(true)
  })
  it('refuses a mask that runs along the border: the scene was kept', () => {
    const c = cutoutConfidence(maskWith(100, 60, [[0, 0, 100, 40]]), 100, 60)
    expect(c.border).toBeGreaterThan(0.4)
    expect(c.ok).toBe(false)
  })
  it('refuses a hazy mask the models are unsure about', () => {
    const m = maskWith(100, 60, [[40, 20, 10, 10]])
    for (let i = 0; i < m.length; i++) if (m[i] === 0 && i % 3 === 0) m[i] = 120
    expect(cutoutConfidence(m, 100, 60).ok).toBe(false)
  })
  it('refuses an empty mask', () => {
    expect(cutoutConfidence(new Uint8Array(100), 10, 10).ok).toBe(false)
  })
})

describe('luminance and boxMean', () => {
  it('weights green most, as the eye does', () => {
    const l = luminance(new Uint8Array([0, 255, 0, 255, 0, 0, 255, 255]), 2, 1) // BGRA: green, red
    expect(l[0]).toBeCloseTo(0.7152, 3)
    expect(l[1]).toBeCloseTo(0.2126, 3)
  })
  it('averages over the box, clamped at the edges', () => {
    const src = Float32Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9])
    const m = boxMean(src, 3, 3, 1)
    expect(m[4]).toBeCloseTo(5)
    expect(m[0]).toBeCloseTo((1 + 2 + 4 + 5) / 4)
  })
})

describe('guidedFilter', () => {
  it('snaps a soft, misplaced mask edge to the image edge', () => {
    const w = 40
    const h = 8
    // Image: dark left half, bright right half (edge between x 19 and 20).
    const bgra = new Uint8Array(w * h * 4)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) bgra.fill(x >= 20 ? 230 : 20, (y * w + x) * 4, (y * w + x) * 4 + 4)
    // Mask: a soft ramp centred two pixels off the edge.
    const mask = new Uint8Array(w * h)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) mask[y * w + x] = Math.round(255 * Math.min(1, Math.max(0, (x - 14) / 12)))
    const out = guidedFilter(luminance(bgra, w, h), mask, w, h, 4, 1e-4)
    const row = 4 * w
    // Sharper across the image's edge than the input ramp was.
    expect(out[row + 21] - out[row + 18]).toBeGreaterThan(mask[row + 21] - mask[row + 18])
    // Flat regions far from the edge keep their value.
    expect(out[row + 2]).toBeLessThan(20)
    expect(out[row + 37]).toBeGreaterThan(235)
  })
})

describe('buildCutout', () => {
  const w = 300
  const h = 180
  const bgra = new Uint8Array(w * h * 4).fill(128)
  it('cuts out and frames a champion both models see', () => {
    const body = maskWith(w, h, [[130, 20, 50, 150]])
    const cut = buildCutout(bgra, w, h, [body, body])
    expect(cut).not.toBeNull()
    expect(cut!.rect.h).toBeGreaterThan(140)
    expect(cut!.alpha.length).toBe(cut!.rect.w * cut!.rect.h)
  })
  it('keeps a weapon only one model saw', () => {
    const body = maskWith(w, h, [[130, 20, 50, 150]])
    const withWeapon = maskWith(w, h, [[130, 20, 50, 150], [180, 40, 30, 20]])
    const cut = buildCutout(bgra, w, h, [body, withWeapon])!
    const wx = 195 - cut.rect.x
    const wy = 50 - cut.rect.y
    expect(cut.alpha[wy * cut.rect.w + wx]).toBeGreaterThan(200)
  })
  it('refuses when the models kept the scene', () => {
    const scene = maskWith(w, h, [[0, 0, w, 120]])
    expect(buildCutout(bgra, w, h, [scene, scene])).toBeNull()
  })
})
