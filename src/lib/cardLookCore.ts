/**
 * Look of the player cards (Espace d'équipe) and of the looking-for-team
 * announcements: which line pattern sits over the glow, and the same
 * filters as Settings → Appearance (colour filter, blur, dark ↔ light).
 * Pure: the styles come from here, the choice is kept per device.
 */

/** Line patterns (src/assets/cards/*.svg), the original first. */
export const CARD_BACKGROUNDS = ['topo', 'hextech', 'ripples', 'currents', 'shards', 'constellation', 'circuit'] as const
export type CardBackgroundId = (typeof CARD_BACKGROUNDS)[number]

/** How strongly each pattern shows: the sparse ones a little more. */
export const CARD_PATTERN_OPACITY: Record<CardBackgroundId, number> = {
  topo: 0.13,
  hextech: 0.12,
  ripples: 0.13,
  currents: 0.12,
  shards: 0.16,
  constellation: 0.22,
  circuit: 0.16,
}

export interface CardLook {
  background: CardBackgroundId
  /** Colour filter over the background (colour blend), `#rrggbb`. */
  tintColor: string
  /** 0 = none, 100 = fully recoloured. */
  tintStrength: number
  /** px of blur on the background. */
  blur: number
  /** -100 = dark, 0 = as drawn, 100 = light. */
  light: number
}

export const DEFAULT_CARD_LOOK: CardLook = { background: 'topo', tintColor: '#3EC2D4', tintStrength: 0, blur: 0, light: 0 }

export const CARD_LOOK_LIMITS = { blur: 12, light: 100 } as const

const HEX = /^#[0-9a-f]{6}$/i
const num = (v: unknown, lo: number, hi: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : fallback

/** A stored look, garbage replaced by the defaults. */
export function sanitizeCardLook(raw: unknown): CardLook {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof CardLook, unknown>>
  const d = DEFAULT_CARD_LOOK
  return {
    background: (CARD_BACKGROUNDS as readonly unknown[]).includes(r.background) ? (r.background as CardBackgroundId) : d.background,
    tintColor: typeof r.tintColor === 'string' && HEX.test(r.tintColor) ? r.tintColor.toUpperCase() : d.tintColor,
    tintStrength: num(r.tintStrength, 0, 100, d.tintStrength),
    blur: num(r.blur, 0, CARD_LOOK_LIMITS.blur, d.blur),
    light: num(r.light, -CARD_LOOK_LIMITS.light, CARD_LOOK_LIMITS.light, d.light),
  }
}

export interface CardLookStyle {
  /** CSS filter on the background layers (not the text). */
  filter: string
  /** Colour layer over the background, blended with `mix-blend-mode: color`. */
  tint: { color: string; opacity: number } | null
}

/**
 * CSS for a look. `scale` turns the blur from card pixels into the size
 * drawn (a 1920 px announcement needs more blur than a 200 px card).
 */
export function cardLookStyle(look: CardLook, scale = 1): CardLookStyle {
  const parts: string[] = []
  if (look.blur > 0) parts.push(`blur(${+(look.blur * scale).toFixed(2)}px)`)
  // Light: 0.4 at -100, 1.6 at +100; a little saturation follows it.
  if (look.light !== 0) parts.push(`brightness(${+(1 + look.light * 0.006).toFixed(3)})`, `saturate(${+(1 + look.light * 0.002).toFixed(3)})`)
  return {
    filter: parts.length ? parts.join(' ') : 'none',
    tint: look.tintStrength > 0 ? { color: look.tintColor, opacity: look.tintStrength / 100 } : null,
  }
}
