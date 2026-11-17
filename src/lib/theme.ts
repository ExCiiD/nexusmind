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

export const COLOR_THEMES = ['hextech', 'piltover', 'noxus', 'void', 'ionia', 'shurima', 'freljord', 'zaun'] as const
export type ColorTheme = (typeof COLOR_THEMES)[number]

const STORAGE_KEY = 'ascend_color_theme'
const DEFAULT_THEME: ColorTheme = 'hextech'

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

/** Sets the `data-theme` attribute and persists the choice. Call once at
 *  boot with `getStoredTheme()`, and again whenever the user picks a new
 *  theme in Settings. */
export function applyTheme(theme: ColorTheme): void {
  document.documentElement.setAttribute('data-theme', theme)
  try { localStorage.setItem(STORAGE_KEY, theme) } catch { /* per-viewer convenience only */ }
}
