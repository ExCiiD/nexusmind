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

export interface CutoutModel {
  id: string
  /** File name in the author's GitHub release (and in the harness). */
  file: string
  url: string
  sha256: string
  bytes: number
  /** The export has a fixed 1×3×size×size input. */
  inputSize: number
  mean: readonly number[]
  std: readonly number[]
}

const RELEASE = 'https://github.com/ZhengPeng7/BiRefNet/releases/download/v1/'
const IMAGENET = { mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225] }

/**
 * The two BiRefNet models (MIT), downloaded once to userData and checked by
 * hash. Neither is right on every splash, so both run and their masks are
 * fused: "lite" (Swin-T, 1024 px) keeps fine, long parts such as Nami's
 * tail or Kai'Sa's claws; "512" (Swin-L, 512 px) understands the champion
 * better and keeps what a dark scene swallows, such as Jinx's weapons.
 */
export const CUTOUT_MODELS: readonly CutoutModel[] = [
  {
    id: 'birefnet-lite-general-232',
    file: 'BiRefNet-general-bb_swin_v1_tiny-epoch_232.onnx',
    url: `${RELEASE}BiRefNet-general-bb_swin_v1_tiny-epoch_232.onnx`,
    sha256: '5600024376f572a557870a5eb0afb1e5961636bef4e1e22132025467d0f03333',
    bytes: 224_005_088,
    inputSize: 1024,
    ...IMAGENET,
  },
  {
    id: 'birefnet-general-512-216',
    file: 'BiRefNet-general-resolution_512x512-fp16-epoch_216.onnx',
    url: `${RELEASE}BiRefNet-general-resolution_512x512-fp16-epoch_216.onnx`,
    sha256: '18b64a270d3abe7d36e665500c3f24136bcaf7616771b4cb21c6e8c57fec7237',
    bytes: 940_526_436,
    inputSize: 512,
    ...IMAGENET,
  },
]

/** The first model, kept as the default of the tensor helpers. */
export const CUTOUT_MODEL = CUTOUT_MODELS[0]

/** Bump when the model or the post-processing changes: the cache folder is
 *  named after it, so older cut-outs are simply not read again. */
export const CUTOUT_VERSION = 3

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

/**
 * The art that is cut out: Data Dragon's full splash (1215×717), not the
 * loading portrait. The portrait is a tight crop that slices the champion
 * at its edges (straight cuts, lost braids and weapons); on the splash the
 * whole silhouette is there, and `frameSubject` frames it for the card.
 */
export function cutoutArtUrl(championKey: string, skin = 0): string {
  return `https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${championKey}_${skin}.jpg`
}

export interface Rect { x: number; y: number; w: number; h: number }

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
  low: 20,
  high: 225,
  minSpeck: 0.002,
  feather: 1,
  // The splash keeps the silhouette whole: frameSubject fades the edges where its window cuts.
  fadeTop: 0,
  fadeRight: 0,
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

// ── Fusing two models, image-guided edges ───────────────────────────────

/** Pixel-wise maximum: whatever either model sees as the champion is kept
 *  (one keeps Jinx's weapons, the other Nami's tail). */
export function fuseMasks(masks: readonly Uint8Array[]): Uint8Array {
  const out = Uint8Array.from(masks[0] ?? [])
  for (let k = 1; k < masks.length; k++) {
    const m = masks[k]
    for (let i = 0; i < out.length; i++) if (m[i] > out[i]) out[i] = m[i]
  }
  return out
}

/** Pixel-wise minimum: only what every model sees as the champion, its body
 *  rather than a weapon, a pet or an effect one model added. */
export function consensusMask(masks: readonly Uint8Array[]): Uint8Array {
  const out = Uint8Array.from(masks[0] ?? [])
  for (let k = 1; k < masks.length; k++) {
    const m = masks[k]
    for (let i = 0; i < out.length; i++) if (m[i] < out[i]) out[i] = m[i]
  }
  return out
}

export interface CutoutConfidence {
  /** Share of the splash's outer border the mask covers. A champion cut out
   *  cleanly touches it in a few places (a close-up's shoulder, the
   *  ground); a mask that runs along most of it kept the scene. */
  border: number
  /** Pixels the models are unsure about (alpha 10–90 %), per solid pixel. */
  unsure: number
  ok: boolean
}

/**
 * Whether a fused mask can be trusted, so a bad cut-out never reaches a
 * card: the card keeps its art instead. Measured on 15 splashes: clean
 * cut-outs touch at most 28 % of the border and have at most 21 % unsure
 * pixels; Aatrox (a dark giant fused with the scene) covers 53 % of it.
 */
export function cutoutConfidence(mask: Uint8Array, w: number, h: number, maxBorder = 0.4, maxUnsure = 0.3): CutoutConfidence {
  let edge = 0
  let edgeAll = 0
  const hit = (i: number): void => {
    edgeAll++
    if (mask[i] >= 128) edge++
  }
  for (let x = 0; x < w; x++) {
    hit(x)
    hit((h - 1) * w + x)
  }
  for (let y = 1; y < h - 1; y++) {
    hit(y * w)
    hit(y * w + w - 1)
  }
  let unsure = 0
  let solid = 0
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] >= 128) solid++
    if (mask[i] > 25 && mask[i] < 230) unsure++
  }
  const border = edgeAll ? edge / edgeAll : 0
  const ratio = solid ? unsure / solid : 1
  return { border, unsure: ratio, ok: solid > 0 && border <= maxBorder && ratio <= maxUnsure }
}

/** Luminance (0–1) of a BGRA bitmap. */
export function luminance(bgra: Uint8Array, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h)
  for (let i = 0; i < out.length; i++) out[i] = (0.0722 * bgra[i * 4] + 0.7152 * bgra[i * 4 + 1] + 0.2126 * bgra[i * 4 + 2]) / 255
  return out
}

/** Mean over a (2r+1)² box, edges clamped, through a summed-area table. */
export function boxMean(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const sat = new Float64Array((w + 1) * (h + 1))
  for (let y = 0; y < h; y++) {
    let row = 0
    for (let x = 0; x < w; x++) {
      row += src[y * w + x]
      sat[(y + 1) * (w + 1) + x + 1] = sat[y * (w + 1) + x + 1] + row
    }
  }
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r)
    const y1 = Math.min(h, y + r + 1)
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r)
      const x1 = Math.min(w, x + r + 1)
      const sum = sat[y1 * (w + 1) + x1] - sat[y0 * (w + 1) + x1] - sat[y1 * (w + 1) + x0] + sat[y0 * (w + 1) + x0]
      out[y * w + x] = sum / ((x1 - x0) * (y1 - y0))
    }
  }
  return out
}

/**
 * Guided filter (He, Sun & Tang): reshapes the mask's edges to follow the
 * edges of the painting itself. Both models see the splash at 1024 or 512
 * px; their masks, stretched back to 1215 px, are soft and slightly off.
 * The filter makes the mask a local linear function of the image's
 * luminance, so the cut snaps to where the colour actually changes (hair,
 * a blade, armour against the sky) while flat areas stay as they were.
 */
export function guidedFilter(guide: Float32Array, mask: Uint8Array, w: number, h: number, r = 4, eps = 1e-3): Uint8Array {
  const n = w * h
  const p = new Float32Array(n)
  const ip = new Float32Array(n)
  const ii = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    p[i] = mask[i] / 255
    ip[i] = guide[i] * p[i]
    ii[i] = guide[i] * guide[i]
  }
  const mI = boxMean(guide, w, h, r)
  const mP = boxMean(p, w, h, r)
  const mIP = boxMean(ip, w, h, r)
  const mII = boxMean(ii, w, h, r)
  const a = new Float32Array(n)
  const b = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const varI = mII[i] - mI[i] * mI[i]
    a[i] = (mIP[i] - mI[i] * mP[i]) / (varI + eps)
    b[i] = mP[i] - a[i] * mI[i]
  }
  const mA = boxMean(a, w, h, r)
  const mB = boxMean(b, w, h, r)
  const out = new Uint8Array(n)
  for (let i = 0; i < n; i++) out[i] = Math.round(255 * Math.min(1, Math.max(0, mA[i] * guide[i] + mB[i])))
  return out
}

// ── Framing the champion for the card ───────────────────────────────────

/** Bounding box of the alpha at or over `threshold`; null when empty. */
export function subjectBox(alpha: Uint8Array, w: number, h: number, threshold = 96): Rect | null {
  let x0 = w
  let y0 = h
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (alpha[y * w + x] < threshold) continue
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
}

/**
 * How much each column of the box holds, the upper body counting most: a
 * row's weight falls from 1 at the top of the silhouette (head, shoulders)
 * to 0.25 at its bottom (legs, tails, a weapon's tip).
 */
export function columnWeights(alpha: Uint8Array, w: number, box: Rect): Float64Array {
  const cols = new Float64Array(box.w)
  for (let y = box.y; y < box.y + box.h; y++) {
    const rw = 1 - 0.75 * ((y - box.y) / Math.max(1, box.h - 1))
    const row = y * w
    for (let x = 0; x < box.w; x++) cols[x] += alpha[row + box.x + x] * rw
  }
  return cols
}

/**
 * How much a column at `t` (0–1 across the window) is worth on the card.
 * The card shows the window from 5 % to 95 % of its width; the vertical
 * name covers the right of that, so the body is wanted in the open area.
 */
export function placementWeight(t: number): number {
  if (t < 0.05 || t > 0.95) return 0.15 // behind the frame
  if (t > 0.74) return 0.45 // under the name
  return 1
}

export interface FrameOptions {
  /** Width / height of the framed cut-out. The card shows it 84 % of its
   *  height tall, so 0.75 spans the card's width plus a little either side:
   *  the window's cut edges fall behind the frame. */
  aspect: number
  /** Room kept above the champion, as a share of its height. */
  headroom: number
  /** Soft fade on the window's left and right edges, as a share of its width. */
  sideFade: number
}

export const FRAME_DEFAULTS: FrameOptions = { aspect: 0.75, headroom: 0.04, sideFade: 0.04 }

/**
 * The champion's window in the splash: the silhouette's full height, and
 * across, the position that shows the most of the upper body in the card's
 * open area (columnWeights × placementWeight). Wide poses (a kick, long
 * tails, braids) are cut by the window's sides, behind the frame.
 */
export function portraitWindow(
  alpha: Uint8Array, box: Rect, w: number, h: number,
  aspect = FRAME_DEFAULTS.aspect, headroom = FRAME_DEFAULTS.headroom,
): Rect {
  const top = Math.max(0, box.y - Math.round(box.h * headroom))
  const bottom = Math.min(h, box.y + box.h)
  const height = Math.max(1, bottom - top)
  const width = Math.max(1, Math.min(w, Math.round(height * aspect)))
  let x: number
  if (box.w <= width) {
    x = Math.round(box.x + box.w / 2 - width / 2)
  } else {
    const cols = columnWeights(alpha, w, box)
    const place = Array.from({ length: width }, (_, i) => placementWeight((i + 0.5) / width))
    // The window may reach past the silhouette into the empty splash, so a
    // body standing at one end of a wide pose can still sit in the open area.
    const from = Math.max(0, box.x - Math.floor(width / 2))
    const to = Math.min(w - width, box.x + box.w - Math.ceil(width / 2))
    let best = -1
    x = box.x
    for (let start = from; start <= to; start++) {
      let score = 0
      for (let i = 0; i < width; i++) {
        const c = start + i - box.x
        if (c >= 0 && c < box.w) score += cols[c] * place[i]
      }
      if (score > best) {
        best = score
        x = start
      }
    }
  }
  x = Math.min(Math.max(x, 0), w - width)
  return { x, y: top, w: width, h: height }
}

/** The alpha inside `rect`. */
export function cropMask(alpha: Uint8Array, w: number, rect: Rect): Uint8Array {
  const out = new Uint8Array(rect.w * rect.h)
  for (let y = 0; y < rect.h; y++) {
    const s = (rect.y + y) * w + rect.x
    out.set(alpha.subarray(s, s + rect.w), y * rect.w)
  }
  return out
}

/** Fades the alpha to 0 toward the left and right edges (smoothstep). */
export function fadeSides(mask: Uint8Array, w: number, h: number, share: number): Uint8Array {
  const out = Uint8Array.from(mask)
  const band = share * w
  if (band <= 0) return out
  const ease = (t: number): number => (t >= 1 ? 1 : t <= 0 ? 0 : t * t * (3 - 2 * t))
  for (let x = 0; x < w; x++) {
    const f = ease(Math.min(x, w - 1 - x) / band)
    if (f >= 1) continue
    for (let y = 0; y < h; y++) out[y * w + x] = Math.round(out[y * w + x] * f)
  }
  return out
}

/**
 * From the refined alpha of the whole splash to the card's cut-out: the
 * window around the champion and its alpha, or null when no champion worth
 * showing was found. Rejected: almost nothing kept (under 3 % of the
 * splash: only a weapon or an effect), a silhouette under 40 % of the
 * splash's height (a weapon or a pet, not the champion), or a window still
 * over 94 % full (the scene was kept).
 */
export function frameSubject(
  alpha: Uint8Array, w: number, h: number, opts: Partial<FrameOptions> = {}, focus: Uint8Array = alpha,
): { rect: Rect; alpha: Uint8Array } | null {
  const o = { ...FRAME_DEFAULTS, ...opts }
  if (maskCoverage(alpha) < 0.03) return null
  const box = subjectBox(alpha, w, h)
  if (!box || box.h < h * 0.4) return null
  // `focus` says where the body is (the models' consensus); `alpha` is what is cut out.
  const rect = portraitWindow(focus, box, w, h, o.aspect, o.headroom)
  const cropped = fadeSides(cropMask(alpha, w, rect), rect.w, rect.h, o.sideFade)
  if (maskCoverage(cropped) > 0.94) return null
  return { rect, alpha: cropped }
}

/**
 * The whole algorithm, from the models' masks of a splash to the card's
 * cut-out, the same for every champion (nothing tuned per champion):
 *   1. fuse the models' masks (whatever either sees as the champion stays);
 *   2. confidence check: a mask that kept the scene is refused, and the
 *      card keeps its art rather than show a bad cut-out;
 *   3. guided filter: the edges snap to the painting's own edges;
 *   4. clean-up: haze cleared, stray specks dropped, edge softened;
 *   5. framing: a portrait window on the upper body, clear of the name.
 */
export function buildCutout(
  bgra: Uint8Array, w: number, h: number, masks: readonly Uint8Array[],
): { rect: Rect; alpha: Uint8Array; confidence: CutoutConfidence } | null {
  const fused = fuseMasks(masks)
  const confidence = cutoutConfidence(fused, w, h)
  if (!confidence.ok) return null
  const alpha = refineMask(guidedFilter(luminance(bgra, w, h), fused, w, h), w, h)
  // Framed on what every model agrees is the champion (Nami's body, not the
  // water whip only one model kept); everything any model kept is cut out.
  // When the consensus is a small part of the silhouette (one model saw
  // only Thresh's scythe), it says little about the body: the whole
  // silhouette is used instead.
  const consensus = consensusMask(masks)
  const focus = maskCoverage(consensus) >= 0.4 * maskCoverage(fused) ? consensus : alpha
  const framed = frameSubject(alpha, w, h, {}, focus)
  return framed && { ...framed, confidence }
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
