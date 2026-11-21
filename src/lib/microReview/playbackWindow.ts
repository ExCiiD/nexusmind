/**
 * Playback of an error dated from a death (Chief, 20/11/2026, report lieux-et-extraits-video § 6): on a bad trade the
 * player only saw the death, not the trade. Every error the engine dates from a death (M1, M2, M4, M5, M8, M9, M10
 * bad-trade, M11, M15, M19, micro-review answers on a death) plays from death − 45 s to death + 30 s, everywhere: the
 * player, the Lab « Revoir », the bookmarks and the review notes. The stored time does not change (deduplication
 * depends on it), only playback. Other errors and manual tags: null, the caller keeps its own behaviour. Pure, tested.
 */
import { PLAIN_POST_SEC, PLAIN_PRE_SEC } from './vodTiming'
import { isDeathDatedMistake } from '../mistakeDeathDated'

export interface PlaybackWindow {
  /** Where a click starts (never before 0). */
  startSec: number
  endSec: number
  /** The death: the second marker on the player, next to the window's start. */
  deathSec: number
}

/** `datedFromDeath`: the engine's flag on a mistake or a micro-review answer (Back-end, 20/11). */
export function playbackWindowOf(e: { atSec: number; datedFromDeath?: boolean | null }): PlaybackWindow | null {
  if (!e.datedFromDeath) return null
  return { startSec: Math.max(0, e.atSec - PLAIN_PRE_SEC), endSec: e.atSec + PLAIN_POST_SEC, deathSec: e.atSec }
}

/** Where a replay of a stored mistake starts, in game time: the window's start for one dated from a death. */
export function mistakePlayFromSec(m: { gameTimeSec: number; tagSlug?: string | null; autoDetected?: boolean | null; answerTrigger?: string | null }): number {
  const w = playbackWindowOf({ atSec: m.gameTimeSec, datedFromDeath: isDeathDatedMistake(m) })
  return w ? w.startSec : m.gameTimeSec
}

/** Seconds before the stored time a bookmark of this error starts (the old fixed lead when not dated from a death). */
export function playbackLeadSec(e: { atSec: number; datedFromDeath?: boolean | null }, fallbackLeadSec: number): number {
  const w = playbackWindowOf(e)
  return w ? e.atSec - w.startSec : Math.min(fallbackLeadSec, e.atSec)
}
