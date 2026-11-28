/** Bounds of the video retention rules (docs/design/RETENTION_VIDEO.md): age 7–365 days, total size 10–2000 GB. A value outside is brought back to the bound on blur. */
export const AGE_BOUNDS = { min: 7, max: 365, def: 30 } as const
export const SIZE_BOUNDS = { min: 10, max: 2000, def: 15 } as const

/** Parses what the player typed and clamps it to [min, max]; an empty or unreadable entry falls back to `fallback`. */
export function clampInt(raw: string, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(raw.replace(',', '.')))
  return Number.isFinite(n) && raw.trim() !== '' ? Math.min(max, Math.max(min, n)) : fallback
}
