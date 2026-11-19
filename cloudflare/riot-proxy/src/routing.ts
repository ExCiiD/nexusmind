/**
 * Pure routing rules for the Riot proxy (no Workers APIs → unit-testable).
 *
 * The app calls `https://<proxy>/<host>/<riot path>?<query>` where <host> is
 * a Riot platform (euw1, na1…) or regional cluster (europe, americas…).
 * Only the read-only endpoints Ascend actually uses are forwarded; the
 * proxy must never become a general-purpose relay for our API key.
 */

export const RIOT_HOSTS = new Set([
  // platforms
  'br1', 'eun1', 'euw1', 'jp1', 'kr', 'la1', 'la2', 'na1', 'oc1', 'ph2', 'ru', 'sg2', 'th2', 'tr1', 'tw2', 'vn2',
  // regional routing
  'americas', 'asia', 'europe', 'sea',
])

const ID = '[A-Za-z0-9_-]{1,100}'
/**
 * Each allowed path, with the label it is counted under (P1-10). The label never holds the ids of the request:
 * a Riot ID or a puuid is personal data and must not reach the metrics or the logs.
 */
const ALLOWED_PATHS: Array<{ re: RegExp; label: string }> = [
  // Percent-encoded Riot IDs: up to 16/5 unicode chars, i.e. ~9 bytes each.
  { re: new RegExp(`^/riot/account/v1/accounts/by-riot-id/[^/]{1,200}/[^/]{1,64}$`), label: '/riot/account/v1/accounts/by-riot-id/{name}/{tag}' },
  { re: new RegExp(`^/riot/account/v1/accounts/by-puuid/${ID}$`), label: '/riot/account/v1/accounts/by-puuid/{id}' },
  { re: new RegExp(`^/lol/summoner/v4/summoners/by-puuid/${ID}$`), label: '/lol/summoner/v4/summoners/by-puuid/{id}' },
  { re: new RegExp(`^/lol/champion-mastery/v4/champion-masteries/by-puuid/${ID}/top$`), label: '/lol/champion-mastery/v4/champion-masteries/by-puuid/{id}/top' },
  { re: new RegExp(`^/lol/league/v4/entries/by-summoner/${ID}$`), label: '/lol/league/v4/entries/by-summoner/{id}' },
  { re: new RegExp(`^/lol/league/v4/entries/by-puuid/${ID}$`), label: '/lol/league/v4/entries/by-puuid/{id}' },
  { re: new RegExp(`^/lol/match/v5/matches/by-puuid/${ID}/ids$`), label: '/lol/match/v5/matches/by-puuid/{id}/ids' },
  { re: new RegExp(`^/lol/match/v5/matches/[A-Z0-9]{2,5}_\\d{1,15}$`), label: '/lol/match/v5/matches/{matchId}' },
  { re: new RegExp(`^/lol/match/v5/matches/[A-Z0-9]{2,5}_\\d{1,15}/timeline$`), label: '/lol/match/v5/matches/{matchId}/timeline' },
]

export type RouteResult =
  /** host: the Riot platform or region, path: the Riot path without query (for the shared store and the budget). */
  | { ok: true; upstream: string; endpoint: string; host: string; path: string; query: string }
  | { ok: false; status: number; error: string }

/** Maps an incoming proxy URL to the Riot URL, or explains the refusal. */
export function routeRequest(method: string, url: URL): RouteResult {
  if (method !== 'GET') return { ok: false, status: 405, error: 'method_not_allowed' }

  const match = /^\/([a-z0-9]+)(\/.*)$/.exec(url.pathname)
  if (!match) return { ok: false, status: 404, error: 'unknown_route' }
  const [, host, path] = match
  if (!RIOT_HOSTS.has(host)) return { ok: false, status: 400, error: 'unknown_riot_host' }
  const allowed = path.includes('..') ? undefined : ALLOWED_PATHS.find((a) => a.re.test(path))
  if (!allowed) {
    return { ok: false, status: 403, error: 'endpoint_not_allowed' }
  }
  const query = allowedQuery(allowed.label, url.searchParams)
  if (query === null) return { ok: false, status: 400, error: 'query_not_allowed' }

  return {
    ok: true,
    upstream: `https://${host}.api.riotgames.com${path}${query}`,
    endpoint: allowed.label,
    host,
    path,
    query,
  }
}

/**
 * CyberSecurity: the query parameters each route may carry, and the values they accept. Anything else is
 * refused, and the query sent to Riot is rebuilt from these only (never the raw one): the proxy must not
 * forward what Ascend does not use, nor let a different query share a stored answer.
 */
const NUMBER = /^\d{1,13}$/
const QUERY_RULES: Record<string, Record<string, RegExp>> = {
  '/lol/match/v5/matches/by-puuid/{id}/ids': {
    queue: NUMBER, type: /^(ranked|normal|tourney|tutorial)$/, start: NUMBER, count: NUMBER, startTime: NUMBER, endTime: NUMBER,
  },
  '/lol/champion-mastery/v4/champion-masteries/by-puuid/{id}/top': { count: NUMBER },
}

/** The checked query (`?a=1&b=2`, '' when none), or null when a parameter is unknown, repeated or malformed. */
export function allowedQuery(label: string, params: URLSearchParams): string | null {
  const rules = QUERY_RULES[label] ?? {}
  const out = new URLSearchParams()
  const seen = new Set<string>()
  for (const [key, value] of params) {
    const rule = rules[key]
    if (!rule || seen.has(key) || !rule.test(value)) return null
    seen.add(key)
    out.append(key, value)
  }
  const s = out.toString()
  return s ? `?${s}` : ''
}

/**
 * P1-2: calls only ever made by background work (scouts, pool auto-fill, weekly awards), whatever priority the
 * client claims: champion masteries, and match id lists from a start date without an end (season listings).
 * The stranded-game recovery lists ids between two dates: that one stays interactive.
 */
export function backgroundOnly(path: string, params: URLSearchParams): boolean {
  if (path.startsWith('/lol/champion-mastery/')) return true
  return path.endsWith('/ids') && params.has('startTime') && !params.has('endTime')
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
