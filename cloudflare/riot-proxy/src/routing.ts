/**
 * Pure routing rules for the Riot proxy (no Workers APIs → unit-testable).
 *
 * The app calls `https://<proxy>/<host>/<riot path>?<query>` where <host> is
 * a Riot platform (euw1, na1…) or regional cluster (europe, americas…).
 * Only the read-only endpoints NexusMind actually uses are forwarded; the
 * proxy must never become a general-purpose relay for our API key.
 */

export const RIOT_HOSTS = new Set([
  // platforms
  'br1', 'eun1', 'euw1', 'jp1', 'kr', 'la1', 'la2', 'na1', 'oc1', 'ph2', 'ru', 'sg2', 'th2', 'tr1', 'tw2', 'vn2',
  // regional routing
  'americas', 'asia', 'europe', 'sea',
])

const ID = '[A-Za-z0-9_-]{1,100}'
const ALLOWED_PATHS: RegExp[] = [
  // Percent-encoded Riot IDs: up to 16/5 unicode chars, i.e. ~9 bytes each.
  new RegExp(`^/riot/account/v1/accounts/by-riot-id/[^/]{1,200}/[^/]{1,64}$`),
  new RegExp(`^/riot/account/v1/accounts/by-puuid/${ID}$`),
  new RegExp(`^/lol/summoner/v4/summoners/by-puuid/${ID}$`),
  new RegExp(`^/lol/champion-mastery/v4/champion-masteries/by-puuid/${ID}/top$`),
  new RegExp(`^/lol/league/v4/entries/by-summoner/${ID}$`),
  new RegExp(`^/lol/league/v4/entries/by-puuid/${ID}$`),
  new RegExp(`^/lol/match/v5/matches/by-puuid/${ID}/ids$`),
  new RegExp(`^/lol/match/v5/matches/[A-Z0-9]{2,5}_\\d{1,15}$`),
  new RegExp(`^/lol/match/v5/matches/[A-Z0-9]{2,5}_\\d{1,15}/timeline$`),
]

export type RouteResult =
  | { ok: true; upstream: string; endpoint: string }
  | { ok: false; status: number; error: string }

/** Maps an incoming proxy URL to the Riot URL, or explains the refusal. */
export function routeRequest(method: string, url: URL): RouteResult {
  if (method !== 'GET') return { ok: false, status: 405, error: 'method_not_allowed' }

  const match = /^\/([a-z0-9]+)(\/.*)$/.exec(url.pathname)
  if (!match) return { ok: false, status: 404, error: 'unknown_route' }
  const [, host, path] = match
  if (!RIOT_HOSTS.has(host)) return { ok: false, status: 400, error: 'unknown_riot_host' }
  if (path.includes('..') || !ALLOWED_PATHS.some((re) => re.test(path))) {
    return { ok: false, status: 403, error: 'endpoint_not_allowed' }
  }

  return {
    ok: true,
    upstream: `https://${host}.api.riotgames.com${path}${url.search}`,
    endpoint: path.replace(/\/[A-Za-z0-9_%-]{20,}/g, '/{id}').replace(/[A-Z0-9]{2,5}_\d+/g, '{matchId}'),
  }
}

/** Riot response headers worth forwarding (rate-limit tuning on the client). */
export const FORWARDED_HEADERS = [
  'content-type',
  'retry-after',
  'x-app-rate-limit',
  'x-app-rate-limit-count',
  'x-method-rate-limit',
  'x-method-rate-limit-count',
  'x-rate-limit-type',
]
