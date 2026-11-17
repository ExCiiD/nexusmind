/**
 * Color themes (Settings → Appearance). Pure client-side preference — no
 * backend, no sync — applied via a `data-theme` attribute on `<html>` that
 * the CSS custom properties in `src/index.css` key off of. Every other
 * color token in the app (`hextech-*`, plus the shadcn `primary`/`accent`/
 * etc. aliases in tailwind.config.ts) reads those same variables, so
 * switching themes re-colors the whole app without a rebuild.
 *
 * `red`/`green` are deliberately NOT themed (see index.css) — they carry a
 * fixed semantic meaning (loss/danger, win/success) that shouldn't change
 * with the cosmetic theme.
 */

export const COLOR_THEMES = ['hextech', 'piltover', 'noxus', 'void', 'ionia', 'shurima', 'freljord', 'zaun', 'custom'] as const
export type ColorTheme = (typeof COLOR_THEMES)[number]

const STORAGE_KEY = 'ascend_color_theme'
const CUSTOM_KEY = 'ascend_custom_theme'
const DEFAULT_THEME: ColorTheme = 'hextech'

/** The three colors a user picks for the "custom" theme; every other token
 *  is derived from them by `deriveCustomTokens`. */
export interface CustomPalette {
  /** App background (darkest surface). */
  base: string
  /** Main accent: buttons, highlights, titles (the "gold" slot). */
  accent: string
  /** Secondary accent: links, info, charts (the "cyan" slot). */
  secondary: string
}

export const DEFAULT_CUSTOM_PALETTE: CustomPalette = { base: '#0E0F14', accent: '#FF6B3D', secondary: '#4FB3D9' }

const HEX = /^#[0-9a-f]{6}$/i
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
const toHex = (c: number[]) => '#' + c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('').toUpperCase()
/** Linear mix: t = 0 → a, t = 1 → b. */
export function mixHex(a: string, b: string, t: number): string {
  const x = rgb(a)
  const y = rgb(b)
  return toHex(x.map((v, i) => v + (y[i] - v) * t))
}

/** Full token set for the custom theme. The base is clamped dark enough that
 *  the light text tokens keep their contrast whatever the user picks. */
export function deriveCustomTokens(p: CustomPalette): Record<string, string> {
  const lum = (h: string) => { const [r, g, b] = rgb(h); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 }
  const base = lum(p.base) > 0.12 ? mixHex(p.base, '#000000', 1 - 0.12 / lum(p.base)) : p.base
  const white = '#FFFFFF'
  return {
    '--hextech-black': base,
    '--hextech-dark': mixHex(base, white, 0.04),
    '--hextech-elevated': mixHex(base, white, 0.09),
    '--hextech-panel': mixHex(base, white, 0.09),
    '--hextech-border': mixHex(base, p.accent, 0.55),
    '--hextech-border-dim': mixHex(mixHex(base, white, 0.08), p.accent, 0.22),
    '--hextech-cyan': p.secondary,
    '--hextech-teal': mixHex(p.secondary, base, 0.4),
    '--hextech-gold': p.accent,
    '--hextech-gold-bright': mixHex(p.accent, white, 0.72),
    '--hextech-text': mixHex(mixHex(white, p.accent, 0.12), base, 0.3),
    '--hextech-text-bright': mixHex(white, p.accent, 0.08),
    '--hextech-text-dim': mixHex(mixHex(white, p.accent, 0.12), base, 0.58),
    '--hextech-blue': mixHex(base, white, 0.06),
    '--hextech-blue-bright': mixHex(p.accent, white, 0.35),
  }
}

export function isColorTheme(value: string | null): value is ColorTheme {
  return !!value && (COLOR_THEMES as readonly string[]).includes(value)
}

export function getStoredTheme(): ColorTheme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return isColorTheme(stored) ? stored : DEFAULT_THEME
  } catch {
    return DEFAULT_THEME
  }
}

export function getCustomPalette(): CustomPalette {
  try {
    const r = JSON.parse(localStorage.getItem(CUSTOM_KEY) ?? 'null') ?? {}
    const pick = (k: keyof CustomPalette) => (typeof r[k] === 'string' && HEX.test(r[k]) ? r[k] : DEFAULT_CUSTOM_PALETTE[k])
    return { base: pick('base'), accent: pick('accent'), secondary: pick('secondary') }
  } catch {
    return DEFAULT_CUSTOM_PALETTE
  }
}

export function saveCustomPalette(p: CustomPalette): void {
  try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(p)) } catch { /* per-viewer convenience only */ }
}

/** Sets the `data-theme` attribute and persists the choice. Call once at
 *  boot with `getStoredTheme()`, and again whenever the user picks a new
 *  theme in Settings. The custom theme writes its derived tokens inline on
 *  `<html>` (they win over the stylesheet); any other theme clears them. */
export function applyTheme(theme: ColorTheme, palette?: CustomPalette): void {
  const root = document.documentElement
  root.setAttribute('data-theme', theme)
  const tokens = deriveCustomTokens(palette ?? getCustomPalette())
  for (const k of Object.keys(tokens)) {
    if (theme === 'custom') root.style.setProperty(k, tokens[k])
    else root.style.removeProperty(k)
  }
  try { localStorage.setItem(STORAGE_KEY, theme) } catch { /* per-viewer convenience only */ }
}
