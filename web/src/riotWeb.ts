import { sb } from './supabase'
import { RIOT_LIMITS } from '@/lib/riotLimits'
import { mergeMatchIdsByRecency } from '@/lib/scoutingCore'
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

/** Waits out a cooldown another request of this tab was given (or fails at once if it is too long). */
async function waitForCooldown(): Promise<void> {
  const left = Math.ceil((blockedUntil - Date.now()) / 1000)
  if (left <= 0) return
  if (left > MAX_WAIT_SEC) throw rateLimitedError(left)
  await new Promise((r) => setTimeout(r, left * 1000))
}

/** Tests only. */
export function resetRiotRateLimitForTests(): void { blockedUntil = 0 }

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
  if (!token) throw new RiotWebError('Sign in to your Ascend account to load Riot data.')
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
  for (let attempt = 1; ; attempt++) {
    await waitForCooldown()
    res = await fetch(`${PROXY_BASE}/${host}${path}`, { headers })
    if (res.status !== 429) break
    const wait = retryAfterSeconds(res.headers.get('retry-after'))
    blockedUntil = Math.max(blockedUntil, Date.now() + wait * 1000)
    if (attempt >= MAX_RIOT_TRIES || wait > MAX_WAIT_SEC) throw rateLimitedError(wait)
    await new Promise((r) => setTimeout(r, wait * 1000))
  }
  if (!res.ok) {
    if (allowedFallbackStatus?.includes(res.status)) return { data: null, status: res.status }
    if (res.status === 401) throw new RiotWebError('Your Ascend session expired — sign in again.')
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

export async function getAccountByRiotId(gameName: string, tagLine: string, region: string, opts: RiotCallOptions = {}): Promise<{ puuid: string; gameName: string; tagLine: string }> {
  const routing = REGION_TO_ROUTING[region] || 'europe'
  return regionalFetch(routing, `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`, opts) as Promise<{ puuid: string; gameName: string; tagLine: string }>
}

export async function getChampionMasteries(puuid: string, region: string, count = 20, opts: RiotCallOptions = {}): Promise<Array<{ championId: number; championPoints: number }>> {
  const host = PLATFORM_HOSTS[region]
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
  const routing = REGION_TO_ROUTING[region] || 'europe'
  const ts = Math.floor(since.getTime() / 1000)
  const [solo, flex, clash] = await Promise.all([
    getMatchIdsInRange(puuid, routing, 420, ts, RIOT_LIMITS.SEASON_LIST_MAX_PAGES_RANKED, opts).catch(() => [] as string[]),
    getMatchIdsInRange(puuid, routing, 440, ts, RIOT_LIMITS.SEASON_LIST_MAX_PAGES_RANKED, opts).catch(() => [] as string[]),
    getMatchIdsInRange(puuid, routing, 700, ts, RIOT_LIMITS.SEASON_LIST_MAX_PAGES_CLASH, opts).catch(() => [] as string[]),
  ])
  return mergeMatchIdsByRecency(mergeMatchIdsByRecency(solo, flex), clash)
}

/** The latest `count` match ids of one queue (Stats collectives: Flex = 440), most recent first. One request. */
export async function getRecentMatchIds(puuid: string, region: string, count: number, queueId: 420 | 440 | 700 = 440, opts: RiotCallOptions = {}): Promise<string[]> {
  const routing = REGION_TO_ROUTING[region] || 'europe'
  const n = Math.max(1, Math.min(count, RIOT_LIMITS.MAX_IDS_PER_REQUEST))
  const ids = await regionalFetch(routing, `/lol/match/v5/matches/by-puuid/${puuid}/ids?queue=${queueId}&start=0&count=${n}`, opts)
  return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : []
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
  const host = PLATFORM_HOSTS[region]
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
