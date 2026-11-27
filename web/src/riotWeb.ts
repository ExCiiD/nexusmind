import { sb } from './supabase'
import { RIOT_LIMITS } from '@/lib/riotLimits'
import { mergeMatchIdsByRecency } from '@/lib/scoutingCore'
import { ACTIVE_REGION_PATH, accountRoutingFor, createRegionResolver, platformFromActiveRegion } from '@/lib/riotRegionCore'
import { DDRAGON_BASE, getDdragonVersion } from '@/lib/ddragon'

/**
 * Browser-side Riot client for the web Team page (E14: scouting/auto-fill
 * on the web). Calls the SAME Cloudflare proxy the packaged desktop app
 * uses (cloudflare/riot-proxy) with the signed-in user's Supabase access
 * token — the Riot key never reaches the browser. This is intentionally a
 * separate, simpler implementation from electron/main/riotClient.ts: that
 * file's sophistication (a multi-window token-bucket rate limiter, a
 * 50-connection Undici pool) is Node-specific and not portable, and desktop
 * already has its own persistent match cache, which the web has no
 * equivalent of yet — a plain concurrency-capped fetch is the right amount
 * of complexity here, not a 1:1 port.
 */

const PROXY_BASE = ((import.meta.env.WEB_RIOT_PROXY_URL as string | undefined) ?? '').trim().replace(/\/+$/, '')

export class RiotWebError extends Error {
  /** 'rate-limited': Riot (through the proxy) answered 429 and the wait or the tries ran out. */
  /** `status`: Riot's HTTP status when it refused the call (404 no such account, 400 malformed, …). */
  constructor(message: string, readonly code?: 'rate-limited', readonly retryAfterSec?: number, readonly status?: number) {
    super(message)
    this.name = 'RiotWebError'
  }
}

/** 429 handling: at most this many tries of one request (so 2 waits), then a RiotWebError. */
export const MAX_RIOT_TRIES = 3
/** A Retry-After longer than this is not waited for in the page: the request fails at once, saying how long to wait. */
const MAX_WAIT_SEC = 30
/** Wait between two tries when the proxy's Retry-After cannot be read (headers hidden by CORS). */
const MAX_BLIND_BACKOFF_SEC = 10
/** Every request of this tab waits until then after a 429: the shared key is never hit during Riot's cooldown. */
let blockedUntil = 0

/** Retry-After in seconds (delta-seconds or an HTTP date); 1 s when missing or unreadable. */
export function retryAfterSeconds(header: string | null, now = Date.now()): number {
  if (!header) return 1
  const n = Number(header.trim())
  if (Number.isFinite(n) && n >= 0) return Math.ceil(n)
  const at = Date.parse(header)
  return Number.isNaN(at) ? 1 : Math.max(0, Math.ceil((at - now) / 1000))
}

function rateLimitedError(waitSec: number): RiotWebError {
  return new RiotWebError(`Riot is limiting requests right now. Try again in ${waitSec} s.`, 'rate-limited', waitSec)
}

/**
 * Pacing of a BACKGROUND scout through the Ascend proxy (27/11/2026, same as electron/main/riotClient.ts): what the proxy
 * lets one player do in the background is 16 calls a minute and 18 every 2 minutes (RIOT_LIMITS mirrors the worker).
 * A 429 about that share pauses background calls only; the proxy keeps a separate budget for what a screen waits for.
 */
const MAX_PACING_WAIT_SEC = 120
let backgroundBlockedUntil = 0
let shareSeenAt = 0
const SHARE_MEMORY_MS = 10 * 60_000
const backgroundCalls: number[] = []

/** Waits for a free background slot (16 / min, plus 18 / 2 min once the proxy has refused the 2-minute share). */
async function waitForBackgroundSlot(): Promise<void> {
  for (;;) {
    const now = Date.now()
    while (backgroundCalls.length > 0 && backgroundCalls[0] <= now - 120_000) backgroundCalls.shift()
    const perMin = backgroundCalls.filter((t) => t > now - 60_000)
    let waitMs = perMin.length >= RIOT_LIMITS.PROXY_BACKGROUND_PER_MINUTE ? perMin[0] + 60_000 - now : 0
    if (now - shareSeenAt < SHARE_MEMORY_MS && backgroundCalls.length >= RIOT_LIMITS.PROXY_BACKGROUND_PER_2_MIN) {
      waitMs = Math.max(waitMs, backgroundCalls[0] + 120_000 - now)
    }
    if (waitMs <= 0) { backgroundCalls.push(now); return }
    await new Promise((r) => setTimeout(r, waitMs + 20))
  }
}

/** Waits out a cooldown another request of this tab was given (or fails at once if it is too long). */
async function waitForCooldown(background = false): Promise<void> {
  for (;;) {
    const global = Math.ceil((blockedUntil - Date.now()) / 1000)
    if (global > MAX_WAIT_SEC) throw rateLimitedError(global)
    const own = background ? Math.ceil((backgroundBlockedUntil - Date.now()) / 1000) : 0
    if (own > MAX_PACING_WAIT_SEC) throw rateLimitedError(own)
    const left = Math.max(global, own)
    if (left <= 0) return
    await new Promise((r) => setTimeout(r, left * 1000))
    // Loop: another request may have extended the pause while this one slept.
  }
}

/** Tests only. */
export function resetRiotRateLimitForTests(): void {
  blockedUntil = 0
  backgroundBlockedUntil = 0
  shareSeenAt = 0
  backgroundCalls.length = 0
}

const PLATFORM_HOSTS: Record<string, string> = {
  BR1: 'br1', EUN1: 'eun1', EUW1: 'euw1', JP1: 'jp1', KR: 'kr', LA1: 'la1', LA2: 'la2',
  NA1: 'na1', OC1: 'oc1', PH2: 'ph2', RU: 'ru', SG2: 'sg2', TH2: 'th2', TR1: 'tr1', TW2: 'tw2', VN2: 'vn2',
}
const REGION_TO_ROUTING: Record<string, string> = {
  BR1: 'americas', LA1: 'americas', LA2: 'americas', NA1: 'americas',
  OC1: 'sea', PH2: 'sea', SG2: 'sea', TH2: 'sea', TW2: 'sea', VN2: 'sea',
  JP1: 'asia', KR: 'asia', EUN1: 'europe', EUW1: 'europe', RU: 'europe', TR1: 'europe',
}
// Fallback cluster order when the primary one 403s (e.g. a dev key without SEA access).
const ROUTING_FALLBACKS: Record<string, string[]> = { sea: ['asia', 'americas', 'europe'] }

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await sb.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new RiotWebError('Sign in to your Ascend account to load Riot data.', undefined, undefined, 401)
  return { Authorization: `Bearer ${token}` }
}

/**
 * P2 (Audit): `background` marks calls nobody is waiting on (team stats, scouting / auto-fill, synergy) with the
 * `x-nxm-priority: background` header, so the proxy can serve a user's direct action (a player lookup, an opened
 * page) first. Same header as the desktop client.
 */
export interface RiotCallOptions { background?: boolean }
export const BACKGROUND: RiotCallOptions = { background: true }

async function proxyFetch(host: string, path: string, allowedFallbackStatus?: number[], opts: RiotCallOptions = {}): Promise<{ data: unknown; status: number }> {
  if (!PROXY_BASE) throw new RiotWebError('Riot access is not configured for the web app.')
  const headers: Record<string, string> = { ...(await authHeader()), ...(opts.background ? { 'x-nxm-priority': 'background' } : {}) }
  // 429: Retry-After is honoured in full (never shortened), MAX_RIOT_TRIES tries at most, and the whole tab pauses
  // meanwhile, so a burst never keeps hitting the shared key during Riot's cooldown.
  let res: Response | null = null
  const background = !!opts.background
  for (let attempt = 1; ; attempt++) {
    await waitForCooldown(background)
    if (background) await waitForBackgroundSlot()
    res = await fetch(`${PROXY_BASE}/${host}${path}`, { headers })
    // 429, or 503 when the proxy cannot reach its budget (it then says when to come back, like the desktop client handles it).
    if (!(res.status === 429 || (res.status === 503 && res.headers.get('retry-after')))) break
    // A browser only reads these two headers when the proxy lists them in access-control-expose-headers; when it does not,
    // both are null: the delay then grows by itself (1, 2, 4 s…) and the type is unknown.
    const retryHeader = res.headers.get('retry-after')
    const wait = retryHeader ? retryAfterSeconds(retryHeader) : Math.min(2 ** (attempt - 1), MAX_BLIND_BACKOFF_SEC)
    const type = res.headers.get('x-rate-limit-type') ?? (res.status === 503 ? 'proxy-budget-unavailable' : '')
    // The proxy only asking this player to slow down (own share, background reserve, global): pacing, not Riot's own limit.
    const proxyPacing = background && type.startsWith('proxy-') && type !== 'proxy-budget-unavailable'
    if (background) {
      // Any 429 received by a BACKGROUND call holds background calls only: the screens keep their share of the proxy budget.
      backgroundBlockedUntil = Math.max(backgroundBlockedUntil, Date.now() + Math.min(wait, MAX_PACING_WAIT_SEC) * 1000)
      if (type === 'proxy-user-share') shareSeenAt = Date.now()
    } else {
      blockedUntil = Math.max(blockedUntil, Date.now() + wait * 1000)
    }
    if (attempt >= (proxyPacing ? RIOT_LIMITS.PROXY_PACING_MAX_ATTEMPTS : MAX_RIOT_TRIES) || wait > (proxyPacing ? MAX_PACING_WAIT_SEC : MAX_WAIT_SEC)) throw rateLimitedError(wait)
    await new Promise((r) => setTimeout(r, wait * 1000))
  }
  if (!res.ok) {
    if (allowedFallbackStatus?.includes(res.status)) return { data: null, status: res.status }
    if (res.status === 401) throw new RiotWebError('Your Ascend session expired — sign in again.', undefined, undefined, 401)
    if (res.status === 404) throw new RiotWebError('Account not found. Check the Game Name and Tag.', undefined, undefined, 404)
    if (res.status === 502) throw new RiotWebError('Riot access is temporarily unavailable. Try again shortly.', undefined, undefined, 502)
    throw new RiotWebError(`Riot API error ${res.status}`, undefined, undefined, res.status)
  }
  return { data: await res.json(), status: res.status }
}

async function regionalFetch(routing: string, path: string, opts: RiotCallOptions = {}): Promise<unknown> {
  const { data, status } = await proxyFetch(routing, path, [403], opts)
  if (status === 403) {
    for (const fb of ROUTING_FALLBACKS[routing] ?? []) {
      const r = await proxyFetch(fb, path, [403], opts)
      if (r.status !== 403) return r.data
    }
    throw new RiotWebError('Riot access is temporarily unavailable for this region.')
  }
  return data
}

/**
 * The server each account plays on now, from its puuid (20/11/2026, src/lib/riotRegionCore.ts): a roster or a profile
 * keeps the region it was saved with, which goes stale after a transfer. Detected per puuid, cached 10 min, detected
 * again when a listing finds nothing. The web has no manual choice: that one lives in the desktop settings.
 */
export const regionResolver = createRegionResolver({
  detect: async (puuid, hint, ctx) => {
    // 403: a proxy without this route yet, 404: no lol account. Both: keep the stored region.
    // The detection has the priority of the call that needs it: a screen's lookup must not wait in the background lane.
    const { data, status } = await proxyFetch(accountRoutingFor(hint), ACTIVE_REGION_PATH(puuid), [403, 404], ctx?.background ? BACKGROUND : {})
    return status === 200 ? platformFromActiveRegion(data) : null
  },
})

async function platformFor(puuid: string, region: string, opts: RiotCallOptions = {}): Promise<string> {
  return (await regionResolver.resolve(puuid, region, { background: !!opts.background })).platform
}

export async function getAccountByRiotId(gameName: string, tagLine: string, region: string, opts: RiotCallOptions = {}): Promise<{ puuid: string; gameName: string; tagLine: string }> {
  const routing = REGION_TO_ROUTING[region] || 'europe'
  return regionalFetch(routing, `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`, opts) as Promise<{ puuid: string; gameName: string; tagLine: string }>
}

export async function getChampionMasteries(puuid: string, region: string, count = 20, opts: RiotCallOptions = {}): Promise<Array<{ championId: number; championPoints: number }>> {
  const host = PLATFORM_HOSTS[await platformFor(puuid, region, opts)]
  if (!host) throw new RiotWebError(`Unknown region: ${region}`)
  const { data } = await proxyFetch(host, `/lol/champion-mastery/v4/champion-masteries/by-puuid/${puuid}/top?count=${Math.min(count, RIOT_LIMITS.MAX_MASTERY_COUNT)}`, undefined, opts)
  return (data ?? []) as Array<{ championId: number; championPoints: number }>
}

function currentSeasonStart(): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), 0, 1))
}

async function getMatchIdsInRange(puuid: string, routing: string, queueId: 420 | 440 | 700, startTimestampSec: number, maxPages: number, opts: RiotCallOptions): Promise<string[]> {
  const pageSize = RIOT_LIMITS.MAX_IDS_PER_REQUEST
  const out: string[] = []
  for (let page = 0; page < maxPages; page++) {
    const ids = await regionalFetch(routing, `/lol/match/v5/matches/by-puuid/${puuid}/ids?queue=${queueId}&startTime=${startTimestampSec}&start=${page * pageSize}&count=${pageSize}`, opts)
    if (!Array.isArray(ids) || ids.length === 0) break
    out.push(...ids)
    if (ids.length < pageSize) break
  }
  return out
}

/** SoloQ + Flex + Clash match ids since the start of the current season, most-recent first. */
export async function getSeasonMatchIds(puuid: string, region: string, since: Date = currentSeasonStart(), opts: RiotCallOptions = {}): Promise<string[]> {
  const ts = Math.floor(since.getTime() / 1000)
  // After a transfer the old server's games of the season are read too.
  return regionResolver.list(puuid, region, async (platform) => {
    const routing = REGION_TO_ROUTING[platform] || 'europe'
    // A queue whose list failed is an error (the rate limit first), never "no games".
    const failures: unknown[] = []
    const settle = (p: Promise<string[]>) => p.catch((err) => { failures.push(err); return [] as string[] })
    const [solo, flex, clash] = await Promise.all([
      settle(getMatchIdsInRange(puuid, routing, 420, ts, RIOT_LIMITS.SEASON_LIST_MAX_PAGES_RANKED, opts)),
      settle(getMatchIdsInRange(puuid, routing, 440, ts, RIOT_LIMITS.SEASON_LIST_MAX_PAGES_RANKED, opts)),
      settle(getMatchIdsInRange(puuid, routing, 700, ts, RIOT_LIMITS.SEASON_LIST_MAX_PAGES_CLASH, opts)),
    ])
    // The session first (nothing else can work), then the rate limit, then the first failure.
    if (failures.length > 0) throw failures.find((e) => e instanceof RiotWebError && e.status === 401) ?? failures.find((e) => e instanceof RiotWebError && e.code === 'rate-limited') ?? failures[0]
    return mergeMatchIdsByRecency(mergeMatchIdsByRecency(solo, flex), clash)
  }, { mergePrevious: true, ctx: { background: !!opts.background } })
}

/** The latest `count` match ids of one queue (Stats collectives: Flex = 440), most recent first. One request. */
export async function getRecentMatchIds(puuid: string, region: string, count: number, queueId: 420 | 440 | 700 = 440, opts: RiotCallOptions = {}): Promise<string[]> {
  const n = Math.max(1, Math.min(count, RIOT_LIMITS.MAX_IDS_PER_REQUEST))
  const ids = await regionResolver.list(puuid, region, async (platform) => {
    const page = await regionalFetch(REGION_TO_ROUTING[platform] || 'europe', `/lol/match/v5/matches/by-puuid/${puuid}/ids?queue=${queueId}&start=0&count=${n}`, opts)
    return Array.isArray(page) ? page.filter((x): x is string => typeof x === 'string') : []
  }, { mergePrevious: true, ctx: { background: !!opts.background } })
  return ids.slice(0, n)
}
export async function getMatch(matchId: string, region: string, opts: RiotCallOptions = {}): Promise<any> {
  const platformFromId = matchId.split('_')[0]
  const routing = REGION_TO_ROUTING[platformFromId] || REGION_TO_ROUTING[region] || 'europe'
  return regionalFetch(routing, `/lol/match/v5/matches/${matchId}`, opts)
}

/**
 * #40 (Objectifs): a finished game's match-v5 timeline (0.5-2 MB). The proxy keeps it in its shared store, so a
 * timeline anyone already read costs nothing on the key. The region of the match id wins, `region` is the fallback.
 */
export async function getMatchTimeline(matchId: string, region = 'EUW1', opts: RiotCallOptions = {}): Promise<any> {
  const platformFromId = matchId.split('_')[0]
  const routing = REGION_TO_ROUTING[platformFromId] || REGION_TO_ROUTING[region] || 'europe'
  return regionalFetch(routing, `/lol/match/v5/matches/${matchId}/timeline`, opts)
}

export interface LeagueEntry {
  queueType: string
  tier: string
  rank: string
  leaguePoints: number
  wins: number
  losses: number
}

/** #40 (Dossier): a player's ranked entries (solo / flex), from their platform. [] when unranked. */
export async function getLeagueEntriesByPuuid(puuid: string, region: string, opts: RiotCallOptions = {}): Promise<LeagueEntry[]> {
  const host = PLATFORM_HOSTS[await platformFor(puuid, region, opts)]
  if (!host) throw new RiotWebError(`Unknown region: ${region}`)
  const { data } = await proxyFetch(host, `/lol/league/v4/entries/by-puuid/${puuid}`, undefined, opts)
  return Array.isArray(data) ? (data as LeagueEntry[]) : []
}

/** #40 (Dossier): the latest ranked solo/duo match ids (queue 420), most recent first. One request. */
export function getRankedSoloMatchIds(puuid: string, region: string, count: number, opts: RiotCallOptions = {}): Promise<string[]> {
  return getRecentMatchIds(puuid, region, count, 420, opts)
}

/**
 * Bulk match fetch with a small concurrency cap — the browser has no
 * persistent match cache (unlike desktop's MatchCache), so every scout
 * re-fetches; capped concurrency keeps this under the proxy's per-user
 * rate limit (300/min) instead of firing hundreds of requests at once.
 */
export async function getMatchesBulk(matchIds: string[], region: string, concurrency: number = RIOT_LIMITS.MATCH_FETCH_CONCURRENCY, opts: RiotCallOptions = {}): Promise<Map<string, any>> {
  const out = new Map<string, any>()
  let next = 0
  // A rate limit stops every worker and reaches the screen (its toast / error state): one match missing is skipped,
  // but continuing after a 429 would only hit the shared key again and show incomplete numbers as if complete.
  let limited: RiotWebError | null = null
  async function worker() {
    while (next < matchIds.length && !limited) {
      const id = matchIds[next++]
      try {
        out.set(id, await getMatch(id, region, opts))
      } catch (err) {
        if (err instanceof RiotWebError && err.code === 'rate-limited') { limited = err; return }
        console.warn('[riotWeb] match fetch failed:', id, (err as Error)?.message)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, matchIds.length) }, worker))
  if (limited) throw limited
  return out
}

let idToKeyCache: Record<number, string> | null = null
/** Data Dragon's public, unauthenticated CDN — no proxy needed. */
export async function getChampionIdToKey(): Promise<Record<number, string>> {
  if (idToKeyCache) return idToKeyCache
  try {
    const version = await getDdragonVersion() // T (L07): the shared version request
    const res = await fetch(`${DDRAGON_BASE}/cdn/${version}/data/en_US/champion.json`)
    const data = (await res.json()) as { data: Record<string, { id: string; key: string }> }
    const map: Record<number, string> = {}
    for (const c of Object.values(data.data ?? {})) {
      const numericId = parseInt(c.key, 10)
      if (!Number.isNaN(numericId)) map[numericId] = c.id
    }
    idToKeyCache = map
    return map
  } catch (err) {
    console.warn('[riotWeb] Failed to fetch champion list:', (err as Error)?.message)
    return {}
  }
}
