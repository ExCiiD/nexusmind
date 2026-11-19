/**
 * K (UX-3): the one win-rate scale of the app (docs/DESIGN_STATE.md § 9). Four steps, the same on every theme:
 * ≥ 60 high, 50–59 mid, 40–49 low, < 40 bad (tokens --wr-*, classes text-wr-* / bg-wr-*). A small sample
 * (< MIN_GAMES games, or a caller's lowSample) reads dim, without a step colour.
 *
 * Rules for the screens: the percentage is always written next to the colour (the colour never carries the
 * information alone), and the result of ONE game (win / loss) keeps hextech-green / hextech-red: a result, not a rate.
 * Tailwind only sees literal class names, so every class below is written out in full.
 */

export const WR_THRESHOLDS = [60, 50, 40] as const
/** Fewer games than this: no step colour (too few to mean anything). */
export const MIN_GAMES = 3

export type WrLevel = 'high' | 'mid' | 'low' | 'bad' | 'sample'

/**
 * The step of a win rate (0–100). `games` (when known) below MIN_GAMES, or `lowSample`, gives 'sample'.
 */
export function wrLevel(winRate: number, games?: number | null, lowSample = false): WrLevel {
  if (lowSample || (games != null && games < MIN_GAMES)) return 'sample'
  if (winRate >= WR_THRESHOLDS[0]) return 'high'
  if (winRate >= WR_THRESHOLDS[1]) return 'mid'
  if (winRate >= WR_THRESHOLDS[2]) return 'low'
  return 'bad'
}

const TEXT: Record<WrLevel, string> = {
  high: 'text-wr-high',
  mid: 'text-wr-mid',
  low: 'text-wr-low',
  bad: 'text-wr-bad',
  sample: 'text-hextech-text-dim',
}
const PILL: Record<WrLevel, string> = {
  high: 'bg-wr-high/15 text-wr-high',
  mid: 'bg-wr-mid/15 text-wr-mid',
  low: 'bg-wr-low/15 text-wr-low',
  bad: 'bg-wr-bad/15 text-wr-bad',
  sample: 'bg-hextech-elevated text-hextech-text-dim',
}
const BAR: Record<WrLevel, string> = {
  high: 'bg-wr-high',
  mid: 'bg-wr-mid',
  low: 'bg-wr-low',
  bad: 'bg-wr-bad',
  sample: 'bg-hextech-text-dim',
}

/** Text colour of a win rate. */
export const wrText = (winRate: number, games?: number | null, lowSample?: boolean): string => TEXT[wrLevel(winRate, games, lowSample)]
/** Pill: the step colour at 15 % behind text of the same colour. */
export const wrPill = (winRate: number, games?: number | null, lowSample?: boolean): string => PILL[wrLevel(winRate, games, lowSample)]
/** Bar fill (e.g. the pool's win-rate bar). */
export const wrBar = (winRate: number, games?: number | null, lowSample?: boolean): string => BAR[wrLevel(winRate, games, lowSample)]
