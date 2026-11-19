/**
 * Champion cut-outs for the player cards (Team → Roster): the pure half of
 * the background removal run in electron/main/championCutout.ts.
 *
 * The model is BiRefNet "lite" (Swin-T backbone, general use), MIT licence,
 * weights and ONNX export published by its author on GitHub. It was picked
 * over U²-Net-p, ISNet general-use and ISNet anime (Apache-2.0) on Data
 * Dragon's painted loading art: the only one that keeps hair, braids and
 * weapons whole, at ~5 s per champion on CPU. Everything here is plain
 * arithmetic on pixel arrays so it can be tested without Electron or ONNX:
 * the crop that drops the art's dark vignette, the model's input tensor,
 * the mask (sigmoid, resize, levels, specks, feathering, faded cut edges),
 * the usable/unusable decision and a small PNG encoder.
 */

/** The ONNX model, downloaded once to userData and checked by hash. */
export const CUTOUT_MODEL = {
  id: 'birefnet-lite-general-232',
  url: 'https://github.com/ZhengPeng7/BiRefNet/releases/download/v1/BiRefNet-general-bb_swin_v1_tiny-epoch_232.onnx',
  sha256: '5600024376f572a557870a5eb0afb1e5961636bef4e1e22132025467d0f03333',
  bytes: 224_005_088,
  /** The export has a fixed 1×3×1024×1024 input. */
  inputSize: 1024,
  mean: [0.485, 0.456, 0.406] as const,
  std: [0.229, 0.224, 0.225] as const,
}

/** Bump when the model or the post-processing changes: the cache folder is
 *  named after it, so older cut-outs are simply not read again. */
export const CUTOUT_VERSION = 1

/**
 * The cache file name of a champion's cut-out (without extension), or null
 * when the key could reach outside the cache folder. Data Dragon keys are
 * letters and digits only (`MonkeyKing`, `Kaisa`).
 */
export function cutoutCacheKey(championKey: string, skin = 0): string | null {
  if (!/^[A-Za-z0-9]{1,40}$/.test(championKey)) return null
  if (!Number.isInteger(skin) || skin < 0 || skin > 999) return null
  return `${championKey}_${skin}`
}

/** The art that is cut out: Data Dragon's loading-screen portrait, the same
 *  image as `loadingArtUrl` in playerCard.ts (kept here so the main process
 *  does not import renderer modules). */
export function cutoutArtUrl(championKey: string, skin = 0): string {
  return `https://ddragon.leagueoflegends.com/cdn/img/champion/loading/${championKey}_${skin}.jpg`
}

export interface Rect { x: number; y: number; w: number; h: number }

/**
 * The part of the loading art that is kept: Data Dragon darkens a ~13 px
 * border (~20 px at the bottom) of its 308×560 portraits, which would show
 * as a dark line wherever the champion touches the edge. Scaled for other
 * sizes.
 */
export function artCrop(width: number, height: number): Rect {
  const sx = width / 308
  const sy = height / 560
  const left = Math.round(14 * sx)
  const right = Math.round(14 * sx)
  const top = Math.round(14 * sy)
  const bottom = Math.round(22 * sy)
  return { x: left, y: top, w: Math.max(1, width - left - right), h: Math.max(1, height - top - bottom) }
}

/** Bilinear sample of one channel of an interleaved image at (fx, fy). */
function sample(px: ArrayLike<number>, w: number, h: number, stride: number, ch: number, fx: number, fy: number): number {
  const x = Math.min(Math.max(fx, 0), w - 1)
  const y = Math.min(Math.max(fy, 0), h - 1)
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const x1 = Math.min(x0 + 1, w - 1)
  const y1 = Math.min(y0 + 1, h - 1)
  const tx = x - x0
  const ty = y - y0
  const a = px[(y0 * w + x0) * stride + ch]
  const b = px[(y0 * w + x1) * stride + ch]
  const c = px[(y1 * w + x0) * stride + ch]
  const d = px[(y1 * w + x1) * stride + ch]
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty
}

/**
 * The model's NCHW float input: the cropped region of a BGRA bitmap (what
 * Electron's `nativeImage.toBitmap()` gives) stretched to size×size, RGB,
 * scaled to 0–1 then normalised with the ImageNet mean and deviation.
 */
export function toInputTensor(
  bgra: Uint8Array, width: number, height: number, rect: Rect,
  size = CUTOUT_MODEL.inputSize, mean: readonly number[] = CUTOUT_MODEL.mean, std: readonly number[] = CUTOUT_MODEL.std,
): Float32Array {
  const n = size * size
  const out = new Float32Array(3 * n)
  const sx = rect.w / size
  const sy = rect.h / size
  for (let y = 0; y < size; y++) {
    // Clamped to the crop so the vignette never bleeds in.
    const fy = Math.min(Math.max(rect.y + (y + 0.5) * sy - 0.5, rect.y), rect.y + rect.h - 1)
    for (let x = 0; x < size; x++) {
      const fx = Math.min(Math.max(rect.x + (x + 0.5) * sx - 0.5, rect.x), rect.x + rect.w - 1)
      const i = y * size + x
      // BGRA → R, G, B planes.
      for (let c = 0; c < 3; c++) out[c * n + i] = (sample(bgra, width, height, 4, 2 - c, fx, fy) / 255 - mean[c]) / std[c]
    }
  }
  return out
}

/** The model's size×size logits as a 0–255 alpha mask of outW×outH. */
export function maskFromLogits(logits: ArrayLike<number>, size: number, outW: number, outH: number): Uint8Array {
  const prob = new Float32Array(size * size)
  for (let i = 0; i < prob.length; i++) prob[i] = 1 / (1 + Math.exp(-logits[i]))
  const out = new Uint8Array(outW * outH)
  const sx = size / outW
  const sy = size / outH
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      out[y * outW + x] = Math.round(255 * sample(prob, size, size, 1, 0, (x + 0.5) * sx - 0.5, (y + 0.5) * sy - 0.5))
    }
  }
  return out
}

export interface RefineOptions {
  /** Alpha at or under this is cleared (model haze over the scenery). */
  low: number
  /** Alpha at or over this is made fully opaque. */
  high: number
  /** Opaque islands smaller than this share of the image are dropped. */
  minSpeck: number
  /** Box-blur passes (radius 1) softening the edge. */
  feather: number
  /** Width of the fade on the top and right edges, as a share of the side,
   *  where the champion is cut by the art's frame. Left and bottom bleed
   *  past the card and stay hard. */
  fadeTop: number
  fadeRight: number
}

export const REFINE_DEFAULTS: RefineOptions = {
  low: 28,
  high: 225,
  minSpeck: 0.004,
  feather: 1,
  fadeTop: 0.07,
  fadeRight: 0.08,
}

/** Linear levels: [low, high] stretched to [0, 255]. */
export function levels(mask: Uint8Array, low: number, high: number): Uint8Array {
  const out = new Uint8Array(mask.length)
  const span = Math.max(1, high - low)
  for (let i = 0; i < mask.length; i++) {
    const v = mask[i]
    out[i] = v <= low ? 0 : v >= high ? 255 : Math.round(((v - low) / span) * 255)
  }
  return out
}

/**
 * Clears the islands of non-zero alpha (8-connected) smaller than
 * `minArea` pixels: stray bits of scenery the model half-kept. The largest
 * island always stays.
 */
export function removeSpecks(mask: Uint8Array, w: number, h: number, minArea: number): Uint8Array {
  const out = Uint8Array.from(mask)
  const label = new Int32Array(w * h).fill(-1)
  const sizes: number[] = []
  const stack: number[] = []
  for (let start = 0; start < out.length; start++) {
    if (out[start] === 0 || label[start] !== -1) continue
    const id = sizes.length
    let area = 0
    label[start] = id
    stack.push(start)
    while (stack.length) {
      const p = stack.pop()!
      area++
      const px = p % w
      const py = (p - px) / w
      for (let dy = -1; dy <= 1; dy++) {
        const ny = py + dy
        if (ny < 0 || ny >= h) continue
        for (let dx = -1; dx <= 1; dx++) {
          const nx = px + dx
          if (nx < 0 || nx >= w || (dx === 0 && dy === 0)) continue
          const q = ny * w + nx
          if (out[q] !== 0 && label[q] === -1) {
            label[q] = id
            stack.push(q)
          }
        }
      }
    }
    sizes.push(area)
  }
  if (sizes.length === 0) return out
  const largest = sizes.indexOf(Math.max(...sizes))
  for (let i = 0; i < out.length; i++) {
    const id = label[i]
    if (id >= 0 && id !== largest && sizes[id] < minArea) out[i] = 0
  }
  return out
}

/** One 3×3 box blur of the mask, edges clamped. */
export function boxBlur(mask: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(mask.length)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0
      for (let dy = -1; dy <= 1; dy++) {
        const yy = Math.min(Math.max(y + dy, 0), h - 1)
        for (let dx = -1; dx <= 1; dx++) sum += mask[yy * w + Math.min(Math.max(x + dx, 0), w - 1)]
      }
      out[y * w + x] = Math.round(sum / 9)
    }
  }
  return out
}

/** Fades the alpha to 0 toward the top and right edges (smoothstep). */
export function fadeEdges(mask: Uint8Array, w: number, h: number, fadeTop: number, fadeRight: number): Uint8Array {
  const out = Uint8Array.from(mask)
  const bandT = Math.max(0, fadeTop * h)
  const bandR = Math.max(0, fadeRight * w)
  const ease = (t: number): number => (t >= 1 ? 1 : t <= 0 ? 0 : t * t * (3 - 2 * t))
  for (let y = 0; y < h; y++) {
    const ft = bandT > 0 ? ease(y / bandT) : 1
    for (let x = 0; x < w; x++) {
      const fr = bandR > 0 ? ease((w - 1 - x) / bandR) : 1
      const f = ft * fr
      if (f < 1) out[y * w + x] = Math.round(out[y * w + x] * f)
    }
  }
  return out
}

/** The model's raw mask → the alpha used on the card. */
export function refineMask(mask: Uint8Array, w: number, h: number, opts: Partial<RefineOptions> = {}): Uint8Array {
  const o = { ...REFINE_DEFAULTS, ...opts }
  let m = levels(mask, o.low, o.high)
  m = removeSpecks(m, w, h, Math.round(o.minSpeck * w * h))
  for (let i = 0; i < o.feather; i++) m = boxBlur(m, w, h)
  return fadeEdges(m, w, h, o.fadeTop, o.fadeRight)
}

/** Share of the image the champion covers (alpha-weighted, 0–1). */
export function maskCoverage(mask: Uint8Array): number {
  if (mask.length === 0) return 0
  let sum = 0
  for (let i = 0; i < mask.length; i++) sum += mask[i]
  return sum / (255 * mask.length)
}

/**
 * Whether the cut-out is worth showing. Under 12 % the model found little
 * more than effects (Thresh's lantern, scattered sparks): the card keeps
 * the full art. Over 94 % it kept the scene: nothing gained either.
 */
export function isUsableMask(mask: Uint8Array): boolean {
  const c = maskCoverage(mask)
  return c >= 0.12 && c <= 0.94
}

/** The cropped region of a BGRA bitmap as straight RGBA with the given alpha. */
export function composeRgba(bgra: Uint8Array, width: number, rect: Rect, alpha: Uint8Array): Uint8Array {
  const out = new Uint8Array(rect.w * rect.h * 4)
  for (let y = 0; y < rect.h; y++) {
    for (let x = 0; x < rect.w; x++) {
      const s = ((rect.y + y) * width + rect.x + x) * 4
      const d = (y * rect.w + x) * 4
      out[d] = bgra[s + 2]
      out[d + 1] = bgra[s + 1]
      out[d + 2] = bgra[s]
      out[d + 3] = alpha[y * rect.w + x]
    }
  }
  return out
}

// ── PNG ───────────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(bytes: Uint8Array, crc = 0xffffffff): number {
  let c = crc
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return c
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  view.setUint32(8 + data.length, (crc32(out.subarray(4, 8 + data.length)) ^ 0xffffffff) >>> 0)
  return out
}

/**
 * An 8-bit RGBA PNG. `deflate` is zlib's deflate (node:zlib `deflateSync`
 * in the main process), passed in so this file stays free of Node imports.
 */
export function encodePng(rgba: Uint8Array, w: number, h: number, deflate: (raw: Uint8Array) => Uint8Array): Uint8Array {
  const raw = new Uint8Array(h * (w * 4 + 1))
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0 // filter: none
    raw.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1)
  }
  const ihdr = new Uint8Array(13)
  const v = new DataView(ihdr.buffer)
  v.setUint32(0, w)
  v.setUint32(4, h)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflate(raw)),
    chunk('IEND', new Uint8Array(0)),
  ]
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}
