/**
 * The flame on top of the MVP frame of a player card (src/components/team/
 * AwardFrame.tsx): its colour climbs with the player's MVP streak, in weeks
 * won in a row. Pure, so the thresholds are tested.
 */

export type FlameTier = 'grey' | 'white' | 'blue' | 'red' | 'purple'

/** First streak (weeks in a row) of each tier, highest first. */
export const FLAME_TIERS: ReadonlyArray<{ tier: FlameTier; from: number }> = [
  { tier: 'purple', from: 8 },
  { tier: 'red', from: 5 },
  { tier: 'blue', from: 3 },
  { tier: 'white', from: 2 },
  { tier: 'grey', from: 1 },
]

/** The flame's tier for an MVP streak; null under one week (no flame). */
export function flameTier(streak: number): FlameTier | null {
  if (!Number.isFinite(streak)) return null
  return FLAME_TIERS.find((t) => streak >= t.from)?.tier ?? null
}

export interface FlamePalette {
  /** Bottom → top of the flame body. */
  deep: string
  mid: string
  light: string
  /** The soft halo around it. */
  glow: string
  /** Tint of the white-hot core. */
  core: string
}

export const FLAME_PALETTES: Record<FlameTier, FlamePalette> = {
  grey: { deep: '#3f4652', mid: '#8b93a1', light: '#d6dbe3', glow: 'rgba(170,178,192,0.55)', core: '#eef1f5' },
  white: { deep: '#9fb0c8', mid: '#e6ecf5', light: '#ffffff', glow: 'rgba(240,246,255,0.75)', core: '#ffffff' },
  blue: { deep: '#1e40af', mid: '#3b82f6', light: '#bfdbfe', glow: 'rgba(59,130,246,0.75)', core: '#e0f2fe' },
  red: { deep: '#7f1d1d', mid: '#ef4444', light: '#fecaca', glow: 'rgba(239,68,68,0.75)', core: '#fff1e6' },
  purple: { deep: '#581c87', mid: '#a855f7', light: '#f0abfc', glow: 'rgba(192,38,211,0.8)', core: '#fdf4ff' },
}

/** Higher tiers burn bigger (+11 % a tier: 0.78 grey → 1.22 purple, scaled
 *  around the wings' line) and faster. */
export function flameIntensity(tier: FlameTier): { scale: number; speed: number } {
  const i = ['grey', 'white', 'blue', 'red', 'purple'].indexOf(tier)
  return { scale: Math.round((0.78 + i * 0.11) * 100) / 100, speed: 1 - i * 0.07 }
}

/** '#rrggbb' → [r, g, b] in 0–1, as the flame shader's uniforms want. */
export function hexToRgb01(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return [1, 1, 1]
  const v = parseInt(m[1], 16)
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255]
}
