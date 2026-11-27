/**
 * Centralized Riot API fetch quotas (E16, docs/PLAN_GESTION_EQUIPE.md).
 *
 * All team-management scouting/stats code (desktop: electron/main/
 * riotClient.ts + team.ipc.ts; web: web/src/riotWeb.ts + scoutingWeb.ts)
 * is tuned for the current dev/Personal-tier key. A future Product key
 * (more requests/sec, possibly more match history) should be a change to
 * the numbers below, not a hunt through both platforms' fetch code for
 * scattered magic numbers — that's the whole point of this file.
 *
 * Each constant says whether it's "ours to raise" (a throughput/depth
 * choice tuned for the current key) or a Riot-side hard limit (raising it
 * does nothing — Riot ignores/caps the value itself regardless of key
 * tier). Only the former are candidates for a Product-key config bump.
 */
export const RIOT_LIMITS = {
  // ── Riot-side hard limits (NOT ours to raise) ──────────────────────────
  /** match-v5 `.../ids?count=` caps at 100 server-side on every key tier. */
  MAX_IDS_PER_REQUEST: 100,
  /** champion-mastery-v4 `.../top?count=` caps at 50 server-side on every key tier. */
  MAX_MASTERY_COUNT: 50,

  // ── Our own throughput/depth tuning (raise these for a Product key) ───
  /** Default match count for a "quick" scout/auto-fill scope. */
  QUICK_SCOUT_MATCH_COUNT: 100,
  /** Hard ceiling on total match ids processed in one scout/auto-fill
   *  call regardless of scope — matches getSeasonMatchIds' worst case
   *  (1000 solo + 1000 flex + 500 clash pages). Prevents a runaway
   *  allocation; raise alongside the season-list page caps below if a
   *  Product key's deeper history needs more room. */
  MAX_MATCH_IDS_PER_CALL: 2500,
  /** getSeasonMatchIds pagination depth per queue (100 ids/page, Riot-
   *  side cap above) — ranked queues (SoloQ 420 / Flex 440). */
  SEASON_LIST_MAX_PAGES_RANKED: 10,
  /** Clash (700) is rare; capped lower to avoid wasted calls on players
   *  who've played few/no Clash games. */
  SEASON_LIST_MAX_PAGES_CLASH: 5,
  /** Default champion-mastery count fetched during auto-fill (well under
   *  the Riot-side cap — most pools don't need the full top-50). */
  DEFAULT_MASTERY_COUNT: 30,
  /** Recent flex games pulled per member for synergy/combined-stats. */
  SYNERGY_MATCHES_PER_MEMBER: 100,
  /** Concurrent Riot requests queued behind the rate limiter when bulk-
   *  fetching match bodies. Doesn't bottleneck a Personal key (already
   *  gated by its long-window rate limit either way) — only matters once
   *  a Product key's higher throughput makes queue depth the limiter. */
  MATCH_FETCH_CONCURRENCY: 10,

  // ── What the Ascend proxy lets ONE player do in the background (cloudflare/riot-proxy/wrangler.toml) ──────
  // Mirror of the worker, so the app paces itself instead of being answered 429 (every 429 still counts against
  // the player's own per-minute limiter). Change them with the worker's USER_LIMITER_BACKGROUND / USER_WINDOW_SHARE.
  /** Background calls per minute per player (USER_LIMITER_BACKGROUND: counts every call, cached or not). */
  PROXY_BACKGROUND_PER_MINUTE: 16,
  /** Background calls per 2 minutes per player that reach Riot (USER_WINDOW_SHARE 25 % of 95, 80 % of it, less one). */
  PROXY_BACKGROUND_PER_2_MIN: 18,
  /** Tries for a call the proxy only asked to slow down (proxy-user*, proxy-global 429): pacing, not failure. */
  PROXY_PACING_MAX_ATTEMPTS: 12,
} as const

/** Scout / auto-fill depth picked in the scope dialog. */
export type FetchScope = 'quick' | 'complete'

/** The `matchCount` the scout and auto-fill IPC calls expect for a scope:
 *  QUICK_SCOUT_MATCH_COUNT, or -1 for no cap (the entire season). */
export function scopeToMatchCount(scope: FetchScope): number {
  return scope === 'quick' ? RIOT_LIMITS.QUICK_SCOUT_MATCH_COUNT : -1
}
