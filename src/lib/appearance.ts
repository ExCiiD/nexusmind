/**
 * App background (Settings → Appearance), next to the color theme in
 * `theme.ts`. Pure client-side preference — no backend, no sync — applied
 * through CSS custom properties on `<html>` that `.ascend-texture-bg`
 * (src/index.css, put on the layout root) reads. Changing a value re-paints
 * the whole app immediately, which is what gives the settings screen its
 * live preview.
 */
import swirl from '@/assets/ascend-bg-swirl-1.jpg'
import abysse from '@/assets/backgrounds/abysse.webp'
import abysseThumb from '@/assets/backgrounds/abysse-thumb.webp'
import ecarlate from '@/assets/backgrounds/ecarlate.webp'
import ecarlateThumb from '@/assets/backgrounds/ecarlate-thumb.webp'
import braise from '@/assets/backgrounds/braise.webp'
import braiseThumb from '@/assets/backgrounds/braise-thumb.webp'
import fracture from '@/assets/backgrounds/fracture.webp'
import fractureThumb from '@/assets/backgrounds/fracture-thumb.webp'

/** `dim` is the darkness that keeps text readable on that image — applied
 *  when the user picks it (they can still move the slider afterwards). */
export const BACKGROUND_IMAGES = {
  swirl: { full: swirl, thumb: swirl, dim: 90 },
  abysse: { full: abysse, thumb: abysseThumb, dim: 55 },
  ecarlate: { full: ecarlate, thumb: ecarlateThumb, dim: 70 },
  braise: { full: braise, thumb: braiseThumb, dim: 55 },
  fracture: { full: fracture, thumb: fractureThumb, dim: 65 },
} as const
export type BackgroundImageId = keyof typeof BACKGROUND_IMAGES
export const BACKGROUND_IMAGE_IDS = Object.keys(BACKGROUND_IMAGES) as BackgroundImageId[]

/** The user's own picture (Settings → Appearance → "Mon image"). Stored only
 *  in this device's IndexedDB (src/lib/localImageStore.ts) — never synced or
 *  uploaded. Its object URL is resolved at boot by `loadCustomBackground()`. */
export const CUSTOM_IMAGE_ID = 'custom'
let customImageUrl: string | null = null
export function setCustomImageUrl(url: string | null): void { customImageUrl = url }
export function getCustomImageUrl(): string | null { return customImageUrl }

export type BackgroundMode = 'image' | 'color'

export interface AppearancePrefs {
  mode: BackgroundMode
  imageId: BackgroundImageId | typeof CUSTOM_IMAGE_ID
  /** Color filter laid over the image (colorize blend), `#rrggbb`. */
  tintColor: string
  /** 0 = no filter, 100 = fully recolored. */
  tintStrength: number
  /** 0 = image at full brightness, 100 = black. Keeps text readable. */
  dim: number
  /** px of blur on the image. */
  blur: number
  /** Used when `mode === 'color'`, `#rrggbb`. */
  solidColor: string
  /** Panel/card fill over the background, 40 (see-through) – 100 (solid). */
  panelOpacity: number
}

export const DEFAULT_APPEARANCE: AppearancePrefs = {
  mode: 'image',
  imageId: 'swirl',
  tintColor: '#D4A24C',
  tintStrength: 0,
  dim: 90,
  blur: 0,
  solidColor: '#0D0A06',
  panelOpacity: 90,
}

const STORAGE_KEY = 'ascend_appearance'
const HEX = /^#[0-9a-f]{6}$/i
const clamp = (v: unknown, lo: number, hi: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback

/** Fills gaps / rejects garbage so a corrupted localStorage entry can never
 *  break the layout. */
export function sanitizeAppearance(raw: unknown): AppearancePrefs {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<AppearancePrefs>
  const d = DEFAULT_APPEARANCE
  return {
    mode: r.mode === 'color' ? 'color' : 'image',
    imageId: r.imageId === CUSTOM_IMAGE_ID || (r.imageId && r.imageId in BACKGROUND_IMAGES) ? r.imageId : d.imageId,
    tintColor: typeof r.tintColor === 'string' && HEX.test(r.tintColor) ? r.tintColor : d.tintColor,
    tintStrength: clamp(r.tintStrength, 0, 100, d.tintStrength),
    dim: clamp(r.dim, 0, 95, d.dim),
    blur: clamp(r.blur, 0, 16, d.blur),
    solidColor: typeof r.solidColor === 'string' && HEX.test(r.solidColor) ? r.solidColor : d.solidColor,
    panelOpacity: clamp(r.panelOpacity, 40, 100, d.panelOpacity),
  }
}

export function getStoredAppearance(): AppearancePrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return sanitizeAppearance(raw ? JSON.parse(raw) : null)
  } catch {
    return DEFAULT_APPEARANCE
  }
}

/** CSS custom properties for a given preference set — also used inline by
 *  the small preview tile in Settings so it matches the real thing. */
export function appearanceVars(p: AppearancePrefs): Record<string, string> {
  const src = p.imageId === CUSTOM_IMAGE_ID ? customImageUrl : BACKGROUND_IMAGES[p.imageId].full
  // Custom image not loaded (yet / deleted elsewhere): fall back to the default.
  const image = p.mode !== 'image' ? 'none' : `url("${src ?? BACKGROUND_IMAGES.swirl.full}")`
  return {
    '--app-bg-color': p.mode === 'color' ? p.solidColor : 'var(--hextech-black)',
    '--app-bg-image': image,
    '--app-bg-brightness': String(Number((1 - p.dim / 100).toFixed(2))),
    '--app-bg-blur': `${p.blur}px`,
    '--app-bg-tint': p.tintColor,
    '--app-bg-tint-opacity': p.mode === 'image' ? String(p.tintStrength / 100) : '0',
    '--app-panel-opacity': `${p.panelOpacity}%`,
  }
}

export function applyAppearance(p: AppearancePrefs, persist = true): void {
  const style = document.documentElement.style
  for (const [k, v] of Object.entries(appearanceVars(p))) style.setProperty(k, v)
  if (persist) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(p)) } catch { /* per-viewer convenience only */ }
  }
}

/** Boot helper: resolves the user's own image from local storage, then
 *  (re)applies the stored preferences so it shows once ready. */
export async function loadCustomBackground(): Promise<void> {
  const { getLocalImage } = await import('./localImageStore')
  const blob = await getLocalImage(CUSTOM_IMAGE_ID).catch(() => null)
  if (customImageUrl) URL.revokeObjectURL(customImageUrl)
  setCustomImageUrl(blob ? URL.createObjectURL(blob) : null)
  applyAppearance(getStoredAppearance(), false)
}
