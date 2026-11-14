import { sb } from './supabase'

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

export class RiotWebError extends Error {}

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

async function proxyFetch(host: string, path: string, allowedFallbackStatus?: number[]): Promise<{ data: unknown; status: number }> {
  if (!PROXY_BASE) throw new RiotWebError('Riot access is not configured for the web app.')
  const headers = await authHeader()
  const res = await fetch(`${PROXY_BASE}/${host}${path}`, { headers })
  if (res.status === 429) {
    const retryAfter = Math.min(parseInt(res.headers.get('retry-after') || '1', 10) || 1, 10)
    await new Promise((r) => setTimeout(r, retryAfter * 1000))
    return proxyFetch(host, path, allowedFallbackStatus)
  }
  if (!res.ok) {
    if (allowedFallbackStatus?.includes(res.status)) return { data: null, status: res.status }
    if (res.status === 401) throw new RiotWebError('Your Ascend session expired — sign in again.')
    if (res.status === 404) throw new RiotWebError('Account not found. Check the Game Name and Tag.')
    if (res.status === 502) throw new RiotWebError('Riot access is temporarily unavailable. Try again shortly.')
    throw new RiotWebError(`Riot API error ${res.status}`)
  }
  return { data: await res.json(), status: res.status }
}

async function regionalFetch(routing: string, path: string): Promise<unknown> {
  const { data, status } = await proxyFetch(routing, path, [403])
  if (status === 403) {
    for (const fb of ROUTING_FALLBACKS[routing] ?? []) {
      const r = await proxyFetch(fb, path, [403])
      if (r.status !== 403) return r.data
    }
    throw new RiotWebError('Riot access is temporarily unavailable for this region.')
  }
  return data
}

export async function getAccountByRiotId(gameName: string, tagLine: string, region: string): Promise<{ puuid: string; gameName: string; tagLine: string }> {
  const routing = REGION_TO_ROUTING[region] || 'europe'
  return regionalFetch(routing, `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`) as Promise<{ puuid: string; gameName: string; tagLine: string }>
}

export async function getChampionMasteries(puuid: string, region: string, count = 20): Promise<Array<{ championId: number; championPoints: number }>> {
  const host = PLATFORM_HOSTS[region]
  if (!host) throw new RiotWebError(`Unknown region: ${region}`)
  const { data } = await proxyFetch(host, `/lol/champion-mastery/v4/champion-masteries/by-puuid/${puuid}/top?count=${Math.min(count, 50)}`)
  return (data ?? []) as Array<{ championId: number; championPoints: number }>
}

function currentSeasonStart(): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), 0, 1))
}

async function getMatchIdsInRange(puuid: string, routing: string, queueId: 420 | 440 | 700, startTimestampSec: number, maxPages: number): Promise<string[]> {
  const out: string[] = []
  for (let page = 0; page < maxPages; page++) {
    const ids = await regionalFetch(routing, `/lol/match/v5/matches/by-puuid/${puuid}/ids?queue=${queueId}&startTime=${startTimestampSec}&start=${page * 100}&count=100`)
    if (!Array.isArray(ids) || ids.length === 0) break
    out.push(...ids)
    if (ids.length < 100) break
  }
  return out
}

/** SoloQ + Flex + Clash match ids since the start of the current season, most-recent first. */
export async function getSeasonMatchIds(puuid: string, region: string, since: Date = currentSeasonStart()): Promise<string[]> {
  const routing = REGION_TO_ROUTING[region] || 'europe'
  const ts = Math.floor(since.getTime() / 1000)
  const [solo, flex, clash] = await Promise.all([
    getMatchIdsInRange(puuid, routing, 420, ts, 10).catch(() => [] as string[]),
    getMatchIdsInRange(puuid, routing, 440, ts, 10).catch(() => [] as string[]),
    getMatchIdsInRange(puuid, routing, 700, ts, 5).catch(() => [] as string[]),
  ])
  const merged = [...new Set([...solo, ...flex, ...clash])]
  merged.sort((a, b) => parseInt(b.split('_')[1] ?? '0', 10) - parseInt(a.split('_')[1] ?? '0', 10))
  return merged
}

export async function getMatch(matchId: string, region: string): Promise<any> {
  const platformFromId = matchId.split('_')[0]
  const routing = REGION_TO_ROUTING[platformFromId] || REGION_TO_ROUTING[region] || 'europe'
  return regionalFetch(routing, `/lol/match/v5/matches/${matchId}`)
}

/**
 * Bulk match fetch with a small concurrency cap — the browser has no
 * persistent match cache (unlike desktop's MatchCache), so every scout
 * re-fetches; capped concurrency keeps this under the proxy's per-user
 * rate limit (300/min) instead of firing hundreds of requests at once.
 */
export async function getMatchesBulk(matchIds: string[], region: string, concurrency = 8): Promise<Map<string, any>> {
  const out = new Map<string, any>()
  let next = 0
  async function worker() {
    while (next < matchIds.length) {
      const id = matchIds[next++]
      try {
        out.set(id, await getMatch(id, region))
      } catch (err) {
        console.warn('[riotWeb] match fetch failed:', id, (err as Error)?.message)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, matchIds.length) }, worker))
  return out
}

let idToKeyCache: Record<number, string> | null = null
/** Data Dragon's public, unauthenticated CDN — no proxy needed. */
export async function getChampionIdToKey(): Promise<Record<number, string>> {
  if (idToKeyCache) return idToKeyCache
  try {
    const versionsRes = await fetch('https://ddragon.leagueoflegends.com/api/versions.json')
    const versions: string[] = await versionsRes.json()
    const version = versions[0] ?? '15.7.1'
    const res = await fetch(`https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/champion.json`)
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
