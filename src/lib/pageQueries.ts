/**
 * The cached queries shared by several pages and by the start-up warm-up (components/PageCacheWarmup.tsx): one
 * key and one fetcher each, so a page and the warm-up fill the same cache entry (lib/queryCache.ts).
 * Keys under `games:` are refetched after every game (GameEndNav). Desktop only: the web bundle's shared screens
 * use lib/staffQueries.ts.
 */
export const HISTORY_KEY = 'games:history-100'
export const SNAPSHOTS_KEY = 'games:snapshots'

export const fetchHistory = () => window.api.getMatchHistoryWithStatus(100)
export const fetchSnapshots = () => window.api.getStatsSnapshots()

/** Perf gain 3: per-game and per-group keys. Group data never shows under another group's key. */
export const lanePhaseKey = (gameId: string) => `games:lane-phase:${gameId}`
export const matchDetailKey = (matchId: string) => `games:match:${matchId}`
/** The Stats page's tabs (their data lives in the game store; this key times its reloads). */
export const ANALYTICS_KEY = 'games:analytics'
export const BADGES_KEY = 'games:badges'
/** The linked Riot accounts (Settings, the Stats landing page). */
export const ACCOUNTS_KEY = 'accounts:list'
export const gameContextKey = (gameId: string) => `games:context:${gameId}`
export const mistakeOccurrencesKey = (f: { days: number; role: string | null; champion: string | null }) =>
  `games:mistakes:${f.days}:${f.role ?? ''}:${(f.champion ?? '').toLowerCase()}`
