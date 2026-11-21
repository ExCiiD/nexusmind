/**
 * The video player's timeline filters (decision of 21/11/2026, DESIGN_STATE § 19): saved at every change in the
 * player's settings, synced to their devices (UserPreference, key `reviewPlayerFilters`), applied to every player of
 * the app, never reset when a page opens. Only « Réinitialiser » goes back to the default. Pure.
 */

export const PLAYER_FILTERS_KEY = 'reviewPlayerFilters'

export interface PlayerFilters {
  /** TOI */
  notes: boolean
  microReview: boolean
  /** The detected mistakes; hidden from the menu when the player tags their mistakes themselves. */
  mistakes: boolean
  deaths: boolean
  /** PARTIE */
  dragon: boolean
  baron: boolean
  herald: boolean
  grubs: boolean
  turrets: boolean
  inhibs: boolean
  fights: boolean
  /** Timeline zoom, 1× to 8× (optional for the screens: 1 when absent). */
  zoom: number
}

/** The first launch only: my notes and the micro-review. */
export const DEFAULT_PLAYER_FILTERS: PlayerFilters = {
  notes: true, microReview: true, mistakes: false, deaths: false,
  dragon: false, baron: false, herald: false, grubs: false, turrets: false, inhibs: false, fights: false,
  zoom: 1,
}

export const ZOOM_MIN = 1
export const ZOOM_MAX = 8

const BOOL_KEYS = Object.keys(DEFAULT_PLAYER_FILTERS).filter((k) => k !== 'zoom') as Array<Exclude<keyof PlayerFilters, 'zoom'>>

/**
 * The filters to store or to apply: known keys only, booleans for the switches, the zoom kept within 1-8. A missing
 * key takes the default; anything unknown is dropped. Never throws (a bad stored value gives the default).
 */
export function normalizePlayerFilters(raw: unknown): PlayerFilters {
  let v: any = raw
  if (typeof v === 'string') { try { v = JSON.parse(v) } catch { v = null } }
  const out: PlayerFilters = { ...DEFAULT_PLAYER_FILTERS }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out
  for (const k of BOOL_KEYS) if (typeof v[k] === 'boolean') out[k] = v[k]
  if (typeof v.zoom === 'number' && Number.isFinite(v.zoom)) out.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(v.zoom * 4) / 4))
  return out
}
