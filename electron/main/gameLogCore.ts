/**
 * The real platform and match of the game being played, read from the League client's own game log
 * (`<install>/Logs/GameLogs/<start time>/<start time>_r3dlog.txt`). Its command line carries `-PlatformID=EUW1`
 * and `-GameID=8051837730`, so the Riot match id (`EUW1_8051837730`) is known without asking Riot which server
 * the account plays on (20/11/2026: transfers, accounts on several servers).
 *
 * Pure: no file access here (gameLog.ts reads the files). Only these two values are read, never logged with the
 * rest of the line (it holds the game's connection key).
 */
import { normalizePlatform, type Platform } from '../../src/lib/riotRegionCore'

export interface GameLogRef {
  platform: Platform
  gameId: string
  /** Riot match-v5 id. */
  matchId: string
}

/** The platform and game id in a game log's text, or null. */
export function parseGameLog(text: string): GameLogRef | null {
  const platform = normalizePlatform(/-PlatformID=([A-Za-z0-9]{2,5})\b/.exec(text)?.[1])
  const gameId = /-GameID=(\d{5,15})\b/.exec(text)?.[1] ?? /GameStartData::GameID=(\d{5,15})\b/.exec(text)?.[1]
  if (!platform || !gameId) return null
  return { platform, gameId, matchId: `${platform}_${gameId}` }
}

/** League install folders from RiotClientInstalls.json (keys of `associated_client` naming League of Legends). */
export function leagueDirsFromInstalls(json: unknown): string[] {
  const assoc = (json as { associated_client?: Record<string, unknown> } | null)?.associated_client
  if (!assoc || typeof assoc !== 'object') return []
  return Object.keys(assoc).filter((k) => /league of legends/i.test(k)).map((k) => k.replace(/[\\/]+$/, ''))
}

/**
 * The game log folder of the game that started at `startedAtMs`: folders are named after the local start time
 * (`2026-11-20T15-28-42`), and the newest one written after `startedAtMs - slackMs` wins.
 */
export function pickGameLogFolder(folders: Array<{ name: string; mtimeMs: number }>, startedAtMs: number, slackMs = 10 * 60_000): string | null {
  const recent = folders
    .filter((f) => /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/.test(f.name) && f.mtimeMs >= startedAtMs - slackMs)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
  return recent[0]?.name ?? null
}
