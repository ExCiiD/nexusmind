/**
 * Season clock of a Summoner's Rift game, read from Match-V5 `info.gameVersion`.
 *
 * Patch 26.1 (game version 16.1, January 2026) moved the start of the game 35 s earlier: minions spawn at 0:30 (1:05
 * before), camps at 0:55 (1:30), the Scuttle Crabs at 2:55 (3:30). Cached games of 2025 (15.x) keep the 2025 clock, so
 * an analysis of an old game does not change meaning. Checked on cached games (431 of 16.x, 73 of 15.x): median laner
 * level 2 at 1:40 vs 2:11, support level 2 at 1:44 vs 2:16, jungler level 3 at 1:59 vs 2:31, jungler first back at 3:45
 * vs 4:18, support first ward at 1:10 vs 1:47.
 *
 * Respawn timers (League of Legends Wiki, "Death", read 19/11/2026): a base wait by level, times a factor that grows
 * from 15:00 and is capped at +50 %. The 2026 base wait is the wiki's; 15.x games keep the table the detector used
 * until then (not sourced: kept so that cached 2025 analyses do not move).
 */

export type GameClock = 2025 | 2026

/** Season of the game: 2025 for game versions below 16 (patches 15.x and older), 2026 otherwise, unknown included. */
export function gameClockOf(match: any): GameClock {
  const major = Number.parseInt(String(match?.info?.gameVersion ?? '').split('.')[0], 10)
  return Number.isFinite(major) && major < 16 ? 2025 : 2026
}

/**
 * The early-game times the micro-review cards quote, by season (seconds). The detector's own copy lives in
 * DETECTOR_SPEC / CLOCK_2025 (anomalyDetector.ts); tests keep the two equal. Kept here so the renderer can word a card
 * without importing the detector.
 */
export const CLOCK_TIMES: Record<GameClock, {
  gank1: readonly [number, number]; gank2: readonly [number, number]; cheaterBack: readonly [number, number]
  supportWardBy: number; jungleFirstBack: number
}> = {
  2025: { gank1: [145, 180], gank2: [195, 265], cheaterBack: [155, 195], supportWardBy: 105, jungleFirstBack: 245 },
  2026: { gank1: [110, 145], gank2: [160, 230], cheaterBack: [120, 160], supportWardBy: 70, jungleFirstBack: 210 },
}

/** "m:ss" of a second count. */
export const clockText = (sec: number): string => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`

/** Base respawn wait by level 1–18 (s). */
export const BASE_RESPAWN_SEC: Record<GameClock, readonly number[]> = {
  2025: [6, 6, 8, 8, 10, 12, 16, 21, 26, 32.5, 35, 37.5, 40, 42.5, 45, 47.5, 50, 52.5],
  2026: [10, 10, 12, 12, 14, 16, 20, 25, 28, 32.5, 35, 37.5, 40, 42.5, 45, 47.5, 50, 52.5],
}

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

/** Respawn timer (s) of a champion of `level` (clamped to 1–18) dying at `minutes`. */
export function deathTimerSec(level: number, minutes: number, clock: GameClock = 2026): number {
  const table = BASE_RESPAWN_SEC[clock]
  const base = table[Math.min(table.length, Math.max(1, Math.round(level))) - 1]
  return base * (1 + respawnTimeFactor(minutes))
}
