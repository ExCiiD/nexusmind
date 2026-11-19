/**
 * Look of the looking-for-team announcements: the colour the user picks
 * (frame, outlines, glows, labels) and the faces. The announcement is
 * exported as a picture, so it doesn't follow the app's colour theme.
 */
export type LftAccentId = 'gold' | 'hextech' | 'crimson' | 'jade' | 'void'

export interface LftAccent {
  id: LftAccentId
  /** Lines, icons, labels. */
  main: string
  /** Text on dark. */
  bright: string
  /** Secondary text, values. */
  soft: string
  /** Dark tint of the panels. */
  deep: string
}

export const LFT_ACCENTS: readonly LftAccent[] = [
  { id: 'gold', main: '#D4A24C', bright: '#F5E3BE', soft: '#E4C285', deep: '#3A2C18' },
  { id: 'hextech', main: '#3EC2D4', bright: '#D6F5FA', soft: '#8ADBE6', deep: '#12343C' },
  { id: 'crimson', main: '#E0473A', bright: '#F8D6D0', soft: '#EE9185', deep: '#3D1512' },
  { id: 'jade', main: '#4FBF8F', bright: '#D6F5E7', soft: '#8CD9B8', deep: '#123327' },
  { id: 'void', main: '#A97BF0', bright: '#ECDFFD', soft: '#C8ABF7', deep: '#271A3F' },
]

export function accentOf(id: string | null | undefined): LftAccent {
  return LFT_ACCENTS.find((a) => a.id === id) ?? LFT_ACCENTS[0]
}

/** "#D4A24C" at `a` opacity. */
export function alpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

export const FONT_DISPLAY = '"Big Shoulders Display", "Arial Narrow", "Segoe UI", sans-serif'
export const FONT_MONO = '"JetBrains Mono", Consolas, monospace'
export const FONT_BODY = 'Inter, "Segoe UI", system-ui, sans-serif'

/** Near-black behind everything (the app's own black). */
export const INK = '#0B0805'
export const TEXT_DIM = '#A99A7E'
