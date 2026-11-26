/**
 * P1-1 (docs/prod/PLAN_CLE_PROD.md): which Riot answers the proxy keeps and shares between every user and device.
 *
 * Only the match-v5 match body and its timeline: Riot publishes them once the game is over and never changes
 * them, so the second request for the same game, from a teammate, another device or the web app, costs
 * nothing on the key. Never the match id lists, ranks, accounts or masteries: those change.
 */

const MATCH = /^\/lol\/match\/v5\/matches\/[A-Z0-9]{2,5}_\d{1,15}(\/timeline)?$/

/** True for a match body or timeline (the path after the Riot host, without query). */
export function isImmutableRiotPath(path: string): boolean {
  return MATCH.test(path)
}

/** Storage key of a cached answer: the routing host and the path, e.g. `europe/lol/match/v5/matches/EUW1_1/timeline`. */
export function cacheKeyFor(host: string, path: string): string {
  return `${host}${path}`
}

/** Only a complete success is kept: never an error, a rate limit, or an empty or truncated body. */
export function shouldStore(status: number, body: ArrayBuffer, contentType: string | null): boolean {
  return status === 200 && body.byteLength > 2 && (contentType ?? '').includes('json')
}

/** Answers the proxy stores are at most this big (a timeline weighs 0.5 to 2 MB). */
export const MAX_STORED_BYTES = 8 * 1024 * 1024
