/**
 * Season clock of a Summoner's Rift game, read from Match-V5 `info.gameVersion`.
 *
 * The engine knows the current season only (game version 16.x, 2026): minions spawn at 0:30, camps at 0:55, Krugs and
 * Gromp at 1:07, the Scuttle Crabs at 2:55. Games of an older season (15.x and below) are not analysed: their clock
 * and timers are not the engine's (user's decision, 20/11/2026, docs/engine-reports/2026-11-20-inventaire-regles-avant-2026.md).
 * Checked on cached 16.x games: median laner level 2 at 1:40, support level 2 at 1:44, jungler level 3 at 1:59,
 * jungler first back at 3:45, support first ward at 1:10.
 *
 * Respawn timers (League of Legends Wiki, "Death", read 19/11/2026): a base wait by level, times a factor that grows
 * from 15:00 and is capped at +50 %.
 */

/** 'current' for the season the engine knows, 'unsupported' for an older one (not analysed). */
export type Season = 'current' | 'unsupported'

/** Season of the game: unsupported for game versions below 16 (patches 15.x and older), current otherwise, unknown included. */
export function seasonOf(match: any): Season {
  const major = Number.parseInt(String(match?.info?.gameVersion ?? '').split('.')[0], 10)
  return Number.isFinite(major) && major < 16 ? 'unsupported' : 'current'
}

/**
 * The early-game times the micro-review cards quote (seconds). The detector's own copy lives in DETECTOR_SPEC
 * (anomalyDetector.ts); tests keep the two equal. Kept here so the renderer can word a card without importing the
 * detector.
 */
export const CLOCK_TIMES = {
  gank1: [110, 145], gank2: [160, 230], cheaterBack: [120, 160], supportWardBy: 70, jungleFirstBack: 210,
} as const satisfies {
  gank1: readonly [number, number]; gank2: readonly [number, number]; cheaterBack: readonly [number, number]
  supportWardBy: number; jungleFirstBack: number
}

/** "m:ss" of a second count. */
export const clockText = (sec: number): string => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`

/** Base respawn wait by level 1–18 (s). */
export const BASE_RESPAWN_SEC: readonly number[] = [10, 10, 12, 12, 14, 16, 20, 25, 28, 32.5, 35, 37.5, 40, 42.5, 45, 47.5, 50, 52.5]

/**
 * Share added to the base wait as the game goes on: 0 before 15:00; then ceil(2 × (min − 15)) × 0.425 % to 30:00;
 * 12.75 % + ceil(2 × (min − 30)) × 0.30 % to 45:00; 21.75 % + ceil(2 × (min − 45)) × 1.45 %; capped at 50 %.
 */
export function respawnTimeFactor(minutes: number): number {
  if (minutes < 15) return 0
  if (minutes < 30) return Math.ceil(2 * (minutes - 15)) * 0.00425
  if (minutes < 45) return 0.1275 + Math.ceil(2 * (minutes - 30)) * 0.003
  if (minutes < 55) return Math.min(0.5, 0.2175 + Math.ceil(2 * (minutes - 45)) * 0.0145)
  return 0.5
}

/**
 * Respawn timer (s) of a champion of `level` dying at `minutes`.
 * #45 D4: since 2026 the top lane quest raises the level cap to 20, but the wiki gives base waits for levels 1-18 only
 * ("Death", read 19/11/2026: nothing for 19-20). Levels 19 and 20 use the level-18 wait, on purpose, until a source
 * gives theirs: a guess would move every analysis that relies on it.
 */
export const MAX_SOURCED_RESPAWN_LEVEL = 18

export function deathTimerSec(level: number, minutes: number): number {
  const base = BASE_RESPAWN_SEC[Math.min(MAX_SOURCED_RESPAWN_LEVEL, BASE_RESPAWN_SEC.length, Math.max(1, Math.round(level))) - 1]
  return base * (1 + respawnTimeFactor(minutes))
}
