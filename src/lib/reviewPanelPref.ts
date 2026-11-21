/**
 * The review panel's place next to the video (21/11/2026, § 19 « Coin de la vidéo »): hidden or shown, on the left or
 * the right. A synced UserPreference (key REVIEW_PANEL_KEY), read by getUser and written by updateUser({ reviewPanel }).
 */
export const REVIEW_PANEL_KEY = 'reviewPanel'

export interface ReviewPanelPref {
  hidden: boolean
  side: 'left' | 'right'
}

export const DEFAULT_REVIEW_PANEL: ReviewPanelPref = { hidden: false, side: 'right' }

/** Stored value (JSON text, object or nothing) → a complete setting; unknown keys and bad values fall back to the default. */
export function normalizeReviewPanel(raw: unknown): ReviewPanelPref {
  let v: unknown = raw
  if (typeof v === 'string') {
    try { v = JSON.parse(v) } catch { v = null }
  }
  const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
  return {
    hidden: typeof o.hidden === 'boolean' ? o.hidden : DEFAULT_REVIEW_PANEL.hidden,
    side: o.side === 'left' || o.side === 'right' ? o.side : DEFAULT_REVIEW_PANEL.side,
  }
}
