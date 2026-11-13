// Boost the global HTTP connection pool. By default Undici (Node's fetch
// client) opens at most 10 connections per host. With each Riot call
// averaging 200-500ms RTT, 10 connections = 20-50 req/s ceiling per host
// regardless of how aggressive our rate limiter is. For a season scout
// (5 members × 500 matches = 2500 requests to europe.api.riotgames.com),
// this was the *actual* bottleneck — the rate limiter never got a chance
// to saturate. 50 connections allows ~100-250 req/s to a single Riot host.
//
// Wrapped in try/catch because undici's API surface (and Node-version
// compatibility) shifts between releases. An app key MUST NOT fail to
// start because the dispatcher tweak doesn't work — we fall back to
// Node's default 10-connection pool, which is slow but functional.
// Undici 7.x added a hard dependency on `webidl.util.markAsUncloneable`
// (Node 23+) and crashed Electron 33 (Node 20); pinning to ^6.21 fixes
// that, but the try/catch is the actual safety net.
import { prepareRiotRequest, RiotAuthError } from './riotTransport'

try {
  // Lazy require — keeps any import-time errors inside the try/catch
  // (top-level ESM imports throw before our handler sees them).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Agent, setGlobalDispatcher } = require('undici') as typeof import('undici')
  setGlobalDispatcher(new Agent({ connections: 50, keepAliveTimeout: 30_000, keepAliveMaxTimeout: 60_000 }))
  console.info('[riotClient] Undici dispatcher boosted to 50 connections')
} catch (err) {
  console.warn('[riotClient] could not boost Undici dispatcher — falling back to Node default (10 conn/host). Scouting will be slower but functional.', (err as Error)?.message)
}

const PLATFORM_URLS: Record<string, string> = {
  BR1: 'https://br1.api.riotgames.com',
  EUN1: 'https://eun1.api.riotgames.com',
  EUW1: 'https://euw1.api.riotgames.com',
  JP1: 'https://jp1.api.riotgames.com',
  KR: 'https://kr.api.riotgames.com',
  LA1: 'https://la1.api.riotgames.com',
  LA2: 'https://la2.api.riotgames.com',
  NA1: 'https://na1.api.riotgames.com',
  OC1: 'https://oc1.api.riotgames.com',
  PH2: 'https://ph2.api.riotgames.com',
  RU: 'https://ru.api.riotgames.com',
  SG2: 'https://sg2.api.riotgames.com',
  TH2: 'https://th2.api.riotgames.com',
  TR1: 'https://tr1.api.riotgames.com',
  TW2: 'https://tw2.api.riotgames.com',
  VN2: 'https://vn2.api.riotgames.com',
}

const REGIONAL_URLS: Record<string, string> = {
  americas: 'https://americas.api.riotgames.com',
  asia: 'https://asia.api.riotgames.com',
  europe: 'https://europe.api.riotgames.com',
  sea: 'https://sea.api.riotgames.com',
}

const REGION_TO_ROUTING: Record<string, string> = {
  BR1: 'americas',
  LA1: 'americas',
  LA2: 'americas',
  NA1: 'americas',
  OC1: 'sea',
  PH2: 'sea',
  SG2: 'sea',
  TH2: 'sea',
  TW2: 'sea',
  VN2: 'sea',
  JP1: 'asia',
  KR: 'asia',
  EUN1: 'europe',
  EUW1: 'europe',
  RU: 'europe',
  TR1: 'europe',
}

/**
 * Multi-window token bucket — Riot enforces several rolling windows
 * simultaneously (typically "X requests per 10s" AND "Y requests per
 * 10min"), so a single-window limiter is insufficient. We track each
 * window separately and the slowest one wins.
 *
 * Windows can be reconfigured at runtime from the rate-limit headers
 * (`X-App-Rate-Limit: 500:10,30000:600` → 500/10s, 30000/600s) so the
 * limiter auto-tunes itself to whatever tier the API key actually has,
 * without us having to hard-code assumptions about Personal vs
 * Production keys.
 */
interface RateWindow {
  capacity: number  // max requests in the window
  windowSec: number // window size in seconds
  used: number[]    // timestamps (ms) of recent requests
}
class MultiWindowLimiter {
  private windows: RateWindow[]
  private label: string
  /**
   * Serializes acquire() calls. Without this, 25 workers calling
   * acquire() concurrently all read "99/100 tokens used" simultaneously,
   * each decide they can proceed, each push their timestamp — bucket
   * overshoots by 24, Riot returns 429 cascade with 19s backoffs.
   *
   * Chaining through a single queue promise means each acquire only
   * starts checking limits AFTER the previous one has finished its
   * push, so the count is always accurate.
   */
  private acquireQueue: Promise<void> = Promise.resolve()

  constructor(label: string, initial: Array<{ capacity: number; windowSec: number }>) {
    this.label = label
    this.windows = initial.map((w) => ({ ...w, used: [] }))
  }
  /** Replace the windows in-place when we learn the actual limits from a response header. */
  configure(spec: Array<{ capacity: number; windowSec: number }>) {
    const same =
      spec.length === this.windows.length &&
      spec.every((s, i) => s.capacity === this.windows[i].capacity && s.windowSec === this.windows[i].windowSec)
    if (same) return
    console.info(`[rateLimiter:${this.label}] updated from headers →`, spec.map((s) => `${s.capacity}/${s.windowSec}s`).join(', '))
    // Preserve `used` timestamps from any matching window so we don't lose
    // existing budget when reconfiguring mid-flight.
    this.windows = spec.map((s) => {
      const existing = this.windows.find((w) => w.windowSec === s.windowSec)
      return { capacity: s.capacity, windowSec: s.windowSec, used: existing?.used ?? [] }
    })
  }
  private prune(now: number) {
    for (const w of this.windows) {
      const cutoff = now - w.windowSec * 1000
      while (w.used.length > 0 && w.used[0] < cutoff) w.used.shift()
    }
  }
  /** How many ms until the *most-constrained* window has room. 0 = go now. */
  private waitMs(now: number): number {
    this.prune(now)
    let worstWait = 0
    for (const w of this.windows) {
      if (w.used.length >= w.capacity) {
        // Oldest entry must drop out before we can take another slot.
        // Add 50ms slack so we don't race with the boundary tick — Riot
        // counts requests by *received-at* timestamps which can drift
        // ~50ms from our locally-measured `now`.
        const earliest = w.used[0] + w.windowSec * 1000 - now + 50
        if (earliest > worstWait) worstWait = earliest
      }
    }
    return worstWait
  }
  /**
   * Serialized acquire — only one caller is inside the wait/push critical
   * section at a time. The actual HTTP request after this returns can
   * still happen in parallel (caller's responsibility), but the slot
   * accounting is atomic.
   */
  async acquire(): Promise<void> {
    // Chain onto the queue. Each acquirer is awaited by the next one
    // before they get to check limits & push.
    const previous = this.acquireQueue
    let releaseNext!: () => void
    this.acquireQueue = new Promise<void>((r) => { releaseNext = r })
    try {
      await previous
      while (true) {
        const now = Date.now()
        const w = this.waitMs(now)
        if (w <= 0) {
          for (const win of this.windows) win.used.push(now)
          return
        }
        // Wait the full computed duration (no 1000ms cap) so we don't
        // wake spuriously to find the slot already taken by the next
        // queued caller. Re-checks happen automatically via the while
        // loop if the wait was too short.
        await new Promise((r) => setTimeout(r, w))
      }
    } finally {
      releaseNext()
    }
  }
}

// Two limiters: a global "app-tier" budget shared by every endpoint, and
// a per-method limiter that's set lazily on first response. Both start
// with PERSONAL-TIER defaults (20/s + 100/120s) because:
//   1. If the key is Personal, we'd otherwise burst over the limit on
//      the very first batch of requests before any response header
//      arrives to teach us the real limits.
//   2. If the key is Production-tier, the first response will upgrade
//      these limits within milliseconds.
// Starting permissive and downgrading on 429 = thrashing. Starting
// strict and upgrading on success = no overshoots, ever.
const appLimiter = new MultiWindowLimiter('app', [
  { capacity: 20, windowSec: 1 },
  { capacity: 100, windowSec: 120 },
])
const methodLimiters = new Map<string, MultiWindowLimiter>()
function methodLimiterFor(endpointKey: string): MultiWindowLimiter {
  let lim = methodLimiters.get(endpointKey)
  if (!lim) {
    // Same logic — start conservative, let headers expand if applicable.
    lim = new MultiWindowLimiter(endpointKey, [{ capacity: 50, windowSec: 10 }])
    methodLimiters.set(endpointKey, lim)
  }
  return lim
}

/**
 * Parse a Riot rate-limit header like `100:120,1000:600` into an array
 * of windows. Empty / malformed input returns null so callers can keep
 * their current config.
 */
function parseLimitHeader(value: string | null): Array<{ capacity: number; windowSec: number }> | null {
  if (!value) return null
  const parts = value.split(',').map((p) => p.trim()).filter(Boolean)
  const out: Array<{ capacity: number; windowSec: number }> = []
  for (const p of parts) {
    const m = /^(\d+):(\d+)$/.exec(p)
    if (!m) continue
    out.push({ capacity: parseInt(m[1], 10), windowSec: parseInt(m[2], 10) })
  }
  return out.length > 0 ? out : null
}

/**
 * Extract the endpoint key from a Riot API URL so per-method limits can
 * be tracked separately. Strips IDs by collapsing numeric/alphanumeric
 * segments after the version (e.g. `/lol/match/v5/matches/EUW1_123/timeline`
 * → `/lol/match/v5/matches/{id}/timeline`).
 */
function endpointKeyFromUrl(url: string): string {
  try {
    const u = new URL(url)
    return u.pathname
      .replace(/\/by-puuid\/[^/]+/g, '/by-puuid/{x}')
      .replace(/\/by-riot-id\/[^/]+\/[^/]+/g, '/by-riot-id/{x}/{x}')
      .replace(/\/matches\/[^/]+/g, '/matches/{id}')
      .replace(/\/by-champion\/\d+/g, '/by-champion/{id}')
  } catch {
    return url
  }
}

async function riotFetch(url: string, allowedFallbackStatus?: number[]): Promise<{ data: any; status: number }> {
  // Proxy (Supabase token) in builds, local dev key only under `npm run dev`.
  const request = await prepareRiotRequest(url)

  const endpointKey = endpointKeyFromUrl(url)
  const methodLimiter = methodLimiterFor(endpointKey)

  // Acquire both limiters before sending. Order matters: acquire app
  // first (cheaper to check), then method.
  await appLimiter.acquire()
  await methodLimiter.acquire()

  const res = await fetch(request.url, { headers: request.headers })

  // Auto-tune limiters from response headers. Riot returns:
  //   X-App-Rate-Limit: "100:120,1000:600"
  //   X-Method-Rate-Limit: "2000:10"
  // We update on every response so newly-discovered methods inherit
  // their actual limits without a separate config step.
  const appSpec = parseLimitHeader(res.headers.get('X-App-Rate-Limit'))
  if (appSpec) appLimiter.configure(appSpec)
  const methodSpec = parseLimitHeader(res.headers.get('X-Method-Rate-Limit'))
  if (methodSpec) methodLimiter.configure(methodSpec)

  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get('Retry-After') || '1', 10)
    const limitType = res.headers.get('X-Rate-Limit-Type') ?? 'unknown'
    console.warn(`[riotFetch] 429 (${limitType}) — backing off ${retryAfter}s · ${endpointKey}`)
    await new Promise((r) => setTimeout(r, retryAfter * 1000))
    return riotFetch(url, allowedFallbackStatus)
  }

  if (!res.ok) {
    if (allowedFallbackStatus?.includes(res.status)) {
      return { data: null, status: res.status }
    }
    // Statuses produced by the NexusMind proxy itself (never by Riot).
    if (res.status === 401) {
      throw new RiotAuthError('LOGIN_REQUIRED', 'Your NexusMind session expired — please sign in again.')
    }
    if (res.status === 502) {
      throw new Error('NexusMind Riot service is temporarily unavailable. Please try again later.')
    }
    if (res.status === 403) {
      throw new Error('Riot API key is expired or invalid. Development keys expire every 24 hours — please regenerate at developer.riotgames.com')
    }
    if (res.status === 404) {
      throw new Error(`Account not found (404). Make sure your Game Name and Tag are correct for the selected region.`)
    }
    if (res.status === 400) {
      throw new Error(`Bad request (400). Check that your Game Name and Tag are spelled correctly.`)
    }
    throw new Error(`Riot API error ${res.status}: ${res.statusText}`)
  }

  return { data: await res.json(), status: res.status }
}

async function riotFetchJson(url: string): Promise<any> {
  const { data } = await riotFetch(url)
  return data
}

// Routing fallback order when the primary cluster returns 403 (e.g. dev keys lack SEA access)
const ROUTING_FALLBACKS: Record<string, string[]> = {
  sea: ['asia', 'americas', 'europe'],
}

async function riotFetchWithRoutingFallback(
  path: string,
  routing: string,
): Promise<any> {
  const primaryBase = REGIONAL_URLS[routing]
  const { data, status } = await riotFetch(`${primaryBase}${path}`, [403])
  if (status === 403) {
    const fallbacks = ROUTING_FALLBACKS[routing] ?? []
    for (const fb of fallbacks) {
      const fbBase = REGIONAL_URLS[fb]
      const result = await riotFetch(`${fbBase}${path}`, [403])
      if (result.status !== 403) return result.data
    }
    throw new Error('Riot API key is expired or invalid. Development keys expire every 24 hours — please regenerate at developer.riotgames.com')
  }
  return data
}

export async function getAccountByRiotId(
  gameName: string,
  tagLine: string,
  region: string,
): Promise<{ puuid: string; gameName: string; tagLine: string }> {
  const routing = REGION_TO_ROUTING[region] || 'europe'
  const path = `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`
  return riotFetchWithRoutingFallback(path, routing)
}

export async function getSummonerByPuuid(
  puuid: string,
  region: string,
): Promise<{ id: string; accountId: string; puuid: string; profileIconId: number; summonerLevel: number }> {
  const base = PLATFORM_URLS[region]
  return riotFetchJson(`${base}/lol/summoner/v4/summoners/by-puuid/${puuid}`)
}

/**
 * Fetches the top-N champion masteries for a PUUID. Returns champions ordered
 * by mastery points (highest first). `count` defaults to 20 — enough to seed
 * a champion pool while keeping the response tiny.
 */
export async function getChampionMasteries(
  puuid: string,
  region: string,
  count = 20,
): Promise<Array<{
  championId: number
  championLevel: number
  championPoints: number
  lastPlayTime: number
  championPointsSinceLastLevel: number
}>> {
  const base = PLATFORM_URLS[region]
  if (!base) throw new Error(`Unknown region: ${region}`)
  return riotFetchJson(`${base}/lol/champion-mastery/v4/champion-masteries/by-puuid/${puuid}/top?count=${Math.min(count, 50)}`)
}

export async function getRankedStats(
  summonerId: string,
  region: string,
): Promise<
  Array<{
    queueType: string
    tier: string
    rank: string
    leaguePoints: number
    wins: number
    losses: number
  }>
> {
  const base = PLATFORM_URLS[region]
  return riotFetchJson(`${base}/lol/league/v4/entries/by-summoner/${summonerId}`)
}

export async function getMatchIds(
  puuid: string,
  region: string,
  count = 5,
  start = 0,
  queueFilter: 'soloq' | 'flex' | 'both' = 'both',
): Promise<string[]> {
  const routing = REGION_TO_ROUTING[region] || 'europe'

  if (queueFilter === 'both') {
    // Fetch SoloQ and Flex separately, merge and sort by recency
    const [soloIds, flexIds] = await Promise.all([
      riotFetchWithRoutingFallback(
        `/lol/match/v5/matches/by-puuid/${puuid}/ids?queue=420&start=0&count=${count}`,
        routing,
      ),
      riotFetchWithRoutingFallback(
        `/lol/match/v5/matches/by-puuid/${puuid}/ids?queue=440&start=0&count=${count}`,
        routing,
      ),
    ])
    // Merge, deduplicate, and take the most recent `count` entries
    const merged = [...new Set([...soloIds, ...flexIds])]
    // Match IDs embed a timestamp (last segment), sort descending
    merged.sort((a, b) => {
      const tsA = parseInt(a.split('_')[1] ?? '0', 10)
      const tsB = parseInt(b.split('_')[1] ?? '0', 10)
      return tsB - tsA
    })
    return merged.slice(start, start + count)
  }

  const queue = queueFilter === 'soloq' ? 420 : 440
  const path = `/lol/match/v5/matches/by-puuid/${puuid}/ids?queue=${queue}&start=${start}&count=${count}`
  return riotFetchWithRoutingFallback(path, routing)
}

/**
 * Fetches recent match IDs for a puuid across ALL queues — soloq, flex,
 * normals, ARAM, Arena, customs, the lot. Used by the orphan-recording
 * backfill flow which needs to find ANY match that lines up with a video
 * file, not just ranked ones.
 *
 * No queue parameter on the Riot endpoint = no filter, so we just hit it
 * with start/count. Default 20 covers "the last few sessions" without
 * burning rate limit budget on a long history.
 */
export async function getAnyQueueMatchIds(
  puuid: string,
  region: string,
  count = 20,
  start = 0,
): Promise<string[]> {
  const routing = REGION_TO_ROUTING[region] || 'europe'
  const path = `/lol/match/v5/matches/by-puuid/${puuid}/ids?start=${start}&count=${count}`
  const ids = await riotFetchWithRoutingFallback(path, routing)
  return Array.isArray(ids) ? ids : []
}

/**
 * Returns the start of the current ranked season as a JavaScript Date.
 * Riot resets ranks at the start of each year-split; for the active S1 split
 * we treat January 1st 00:00 UTC of the current year as the boundary. This
 * is a conservative choice (a bit before the actual ranked reset), so we
 * capture every game from the start of the year.
 */
export function getCurrentSeasonStart(): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), 0, 1, 0, 0, 0))
}

/**
 * Paginated fetch of match IDs for a single queue, since a Unix timestamp.
 * Iterates 100-at-a-time until either an empty page is returned (no more
 * games in window) or maxPages is reached. We expose a hard cap to keep
 * worst-case API usage bounded — a season-long fetch for a hyper-active
 * player might hit it, which is fine (we still get the most recent N games).
 */
export async function getMatchIdsInRange(
  puuid: string,
  region: string,
  queueId: 420 | 440 | 700,
  startTimestampSec: number,
  maxPages = 10,
): Promise<string[]> {
  const routing = REGION_TO_ROUTING[region] || 'europe'
  const out: string[] = []
  for (let page = 0; page < maxPages; page++) {
    const ids: string[] = await riotFetchWithRoutingFallback(
      `/lol/match/v5/matches/by-puuid/${puuid}/ids?queue=${queueId}&startTime=${startTimestampSec}&start=${page * 100}&count=100`,
      routing,
    )
    if (!Array.isArray(ids) || ids.length === 0) break
    out.push(...ids)
    if (ids.length < 100) break
  }
  return out
}

/**
 * Convenience helper that aggregates SoloQ (420), Flex (440) and Clash (700)
 * match IDs since `since` for the given puuid. Returns a deduplicated list
 * sorted by most-recent-first (match IDs embed a timestamp in their second
 * segment, so we can sort lexicographically by parsing it).
 *
 * Clash is rare; we cap it at 5 pages to avoid wasted calls. Solo + Flex
 * get the default 10 pages each which is enough to cover the full season
 * for all but the most extreme grinders (1000+ ranked games/year).
 */
export async function getSeasonMatchIds(
  puuid: string,
  region: string,
  since: Date = getCurrentSeasonStart(),
): Promise<string[]> {
  const ts = Math.floor(since.getTime() / 1000)
  const [solo, flex, clash] = await Promise.all([
    getMatchIdsInRange(puuid, region, 420, ts, 10).catch((err) => {
      console.warn('[getSeasonMatchIds] soloq failed:', err?.message)
      return [] as string[]
    }),
    getMatchIdsInRange(puuid, region, 440, ts, 10).catch((err) => {
      console.warn('[getSeasonMatchIds] flex failed:', err?.message)
      return [] as string[]
    }),
    getMatchIdsInRange(puuid, region, 700, ts, 5).catch((err) => {
      console.warn('[getSeasonMatchIds] clash failed:', err?.message)
      return [] as string[]
    }),
  ])
  const merged = [...new Set([...solo, ...flex, ...clash])]
  merged.sort((a, b) => {
    const tsA = parseInt(a.split('_')[1] ?? '0', 10)
    const tsB = parseInt(b.split('_')[1] ?? '0', 10)
    return tsB - tsA
  })
  return merged
}

export async function getMatch(
  matchId: string,
  region: string,
): Promise<any> {
  // Match IDs encode the platform prefix (e.g., "EUW1_12345", "NA1_67890").
  // Always prefer routing derived from the matchId itself — this handles cross-region smurfs.
  const platformFromId = matchId.split('_')[0]
  const routingFromId = REGION_TO_ROUTING[platformFromId]
  const routing = routingFromId || REGION_TO_ROUTING[region] || 'europe'
  const path = `/lol/match/v5/matches/${matchId}`
  return riotFetchWithRoutingFallback(path, routing)
}

/**
 * Maps a Riot queueId + gameMode string to a normalized NexusMind queue type.
 * Queue IDs: 420=SoloQ, 440=Flex, 450=ARAM, 1700/1710=Arena, 0=Custom/Practice
 */
export function resolveQueueType(queueId: number, gameMode: string): string {
  switch (queueId) {
    case 420: return 'soloq'
    case 440: return 'flex'
    case 450: return 'aram'
    case 1700:
    case 1710: return 'arena'
    case 0: return gameMode === 'CLASSIC' || gameMode === 'CUSTOM' ? 'custom' : 'normal'
    default: return 'normal'
  }
}

/** Returns true for ranked modes where session coaching is meaningful. */
export function isQueueSessionEligible(queueType: string): boolean {
  return queueType === 'soloq' || queueType === 'flex'
}

export function extractPlayerStats(matchData: any, puuid: string) {
  const participant = matchData.info.participants.find((p: any) => p.puuid === puuid)
  if (!participant) return null

  const opponent = findLaneOpponent(matchData, puuid)
  const queueId: number = matchData.info.queueId ?? 0
  const gameMode: string = matchData.info.gameMode ?? 'CLASSIC'
  const queueType = resolveQueueType(queueId, gameMode)

  return {
    champion: participant.championName,
    role: participant.teamPosition || participant.individualPosition || 'UNKNOWN',
    kills: participant.kills,
    deaths: participant.deaths,
    assists: participant.assists,
    cs: participant.totalMinionsKilled + participant.neutralMinionsKilled,
    visionScore: participant.visionScore,
    duration: matchData.info.gameDuration,
    win: participant.win,
    gameEndAt: new Date(matchData.info.gameEndTimestamp),
    matchId: matchData.metadata.matchId,
    opponentChampion: opponent?.championName ?? null,
    queueId,
    gameMode,
    queueType,
  }
}

export async function getMatchTimeline(
  matchId: string,
  region: string,
): Promise<any> {
  const platformFromId = matchId.split('_')[0]
  const routingFromId = REGION_TO_ROUTING[platformFromId]
  const routing = routingFromId || REGION_TO_ROUTING[region] || 'europe'
  const path = `/lol/match/v5/matches/${matchId}/timeline`
  return riotFetchWithRoutingFallback(path, routing)
}

function findLaneOpponent(matchData: any, puuid: string): any | null {
  const player = matchData.info.participants.find((p: any) => p.puuid === puuid)
  if (!player) return null
  const enemies = matchData.info.participants.filter((p: any) => p.teamId !== player.teamId)

  const position = player.teamPosition || player.individualPosition
  if (position) {
    const byPosition = enemies.find(
      (p: any) => p.teamPosition === position || p.individualPosition === position,
    )
    if (byPosition) return byPosition
  }

  const lane = player.lane
  if (lane && lane !== 'NONE') {
    const byLane = enemies.find((p: any) => p.lane === lane)
    if (byLane) return byLane
  }

  return null
}

function getTimelineFrameAt(timelineData: any, participantId: number, targetMs: number) {
  if (!timelineData?.info?.frames) return null
  let closest: any = null
  let closestDiff = Infinity
  for (const frame of timelineData.info.frames) {
    const diff = Math.abs(frame.timestamp - targetMs)
    if (diff < closestDiff) {
      closestDiff = diff
      closest = frame
    }
  }
  if (!closest) return null
  return closest.participantFrames?.[String(participantId)] ?? null
}

function getLatestTimelineFrame(timelineData: any, participantId: number) {
  const frames = timelineData?.info?.frames
  if (!frames?.length) return null
  const latest = frames[frames.length - 1]
  return latest?.participantFrames?.[String(participantId)] ?? null
}

function getTimelineEventsUntil(timelineData: any, targetMs: number): any[] {
  if (!timelineData?.info?.frames) return []
  return timelineData.info.frames
    .filter((frame: any) => (frame.timestamp ?? 0) <= targetMs)
    .flatMap((frame: any) => frame.events ?? [])
}

function countTurretPlatesByParticipantUntil(
  timelineData: any,
  participantId: number,
  targetMs: number,
): number | null {
  if (!timelineData?.info?.frames) return null
  const events = getTimelineEventsUntil(timelineData, targetMs)
  return events.filter((event: any) => {
    if (event?.type !== 'TURRET_PLATE_DESTROYED') return false
    const participants = [
      event.killerId,
      ...(event.assistingParticipantIds ?? []),
    ].filter((id: any) => typeof id === 'number')
    return participants.includes(participantId)
  }).length
}

export function extractDetailedStats(matchData: any, timelineData: any | null, puuid: string) {
  const p = matchData.info.participants.find((pp: any) => pp.puuid === puuid)
  if (!p) return null

  const gameDurationMin = matchData.info.gameDuration / 60
  const ch = p.challenges || {}
  const teamParticipants = matchData.info.participants.filter((pp: any) => pp.teamId === p.teamId)
  const teamKills = teamParticipants.reduce((s: number, pp: any) => s + pp.kills, 0)
  const teamGold = teamParticipants.reduce((s: number, pp: any) => s + pp.goldEarned, 0)
  const teamDamage = teamParticipants.reduce((s: number, pp: any) => s + pp.totalDamageDealtToChampions, 0)
  const teamDamageTaken = teamParticipants.reduce((s: number, pp: any) => s + pp.totalDamageTaken, 0)
  const teamObjectiveDamage = teamParticipants.reduce((s: number, pp: any) => s + (pp.damageDealtToObjectives ?? 0), 0)
  const teamBuildingDamage = teamParticipants.reduce((s: number, pp: any) => s + (pp.damageDealtToBuildings ?? 0), 0)
  // Epic monster damage = objective damage minus building damage
  const playerEpicMonsterDmg = Math.max(0, (p.damageDealtToObjectives ?? 0) - (p.damageDealtToBuildings ?? 0))
  const teamEpicMonsterDmg = Math.max(0, teamObjectiveDamage - teamBuildingDamage)

  const opponent = findLaneOpponent(matchData, puuid)

  // Timeline participant IDs (1-indexed in the match data)
  const participantId = p.participantId
  const opponentParticipantId = opponent?.participantId

  // @15 min stats from timeline
  let gold15: number | null = null
  let xp15: number | null = null
  let xpPerMin15: number | null = null
  let cs15: number | null = null
  let damage15: number | null = null
  let damagePerMin15: number | null = null
  let goldDiff15: number | null = null
  let xpDiff15: number | null = null
  let csDiff15: number | null = null
  let damageDiff15: number | null = null
  let turretPlates15: number | null = null
  let xpTotal: number | null = null
  let xpPerMin: number | null = null

  // Opponent @15 stats
  let oppGold15: number | null = null
  let oppXp15: number | null = null
  let oppXpPerMin15: number | null = null
  let oppCs15: number | null = null
  let oppDamage15: number | null = null
  let oppDamagePerMin15: number | null = null
  let oppTurretPlates15: number | null = null

  if (timelineData && matchData.info.gameDuration >= 900) {
    const frame = getTimelineFrameAt(timelineData, participantId, 900_000)
    if (frame) {
      gold15 = frame.totalGold ?? null
      xp15 = frame.xp ?? null
      xpPerMin15 = xp15 !== null ? Number((xp15 / 15).toFixed(1)) : null
      cs15 = (frame.minionsKilled ?? 0) + (frame.jungleMinionsKilled ?? 0)
      damage15 = frame.damageStats?.totalDamageDoneToChampions ?? null
      damagePerMin15 = damage15 !== null ? Number((damage15 / 15).toFixed(1)) : null
      turretPlates15 = countTurretPlatesByParticipantUntil(timelineData, participantId, 900_000)

      if (opponentParticipantId) {
        const oppFrame = getTimelineFrameAt(timelineData, opponentParticipantId, 900_000)
        if (oppFrame) {
          oppGold15 = oppFrame.totalGold ?? null
          oppXp15 = oppFrame.xp ?? null
          oppXpPerMin15 = oppXp15 !== null ? Number((oppXp15 / 15).toFixed(1)) : null
          oppCs15 = (oppFrame.minionsKilled ?? 0) + (oppFrame.jungleMinionsKilled ?? 0)
          oppDamage15 = oppFrame.damageStats?.totalDamageDoneToChampions ?? null
          oppDamagePerMin15 = oppDamage15 !== null ? Number((oppDamage15 / 15).toFixed(1)) : null
          oppTurretPlates15 = countTurretPlatesByParticipantUntil(timelineData, opponentParticipantId, 900_000)

          goldDiff15 = (gold15 ?? 0) - (oppGold15 ?? 0)
          xpDiff15 = (xp15 ?? 0) - (oppXp15 ?? 0)
          csDiff15 = (cs15 ?? 0) - (oppCs15 ?? 0)
          damageDiff15 = (damage15 ?? 0) - (oppDamage15 ?? 0)
        }
      }
    }
  }

  if (timelineData) {
    const latestFrame = getLatestTimelineFrame(timelineData, participantId)
    if (latestFrame) {
      xpTotal = latestFrame.xp ?? null
      xpPerMin = xpTotal !== null && gameDurationMin > 0
        ? Number((xpTotal / gameDurationMin).toFixed(1))
        : null
    }
  }

  const visionScoreAdv = opponent
    ? p.visionScore - (opponent.visionScore ?? 0)
    : null

  const oppTeamParticipants = opponent
    ? matchData.info.participants.filter((pp: any) => pp.teamId !== p.teamId)
    : []
  const oppTeamKills = oppTeamParticipants.reduce((s: number, pp: any) => s + pp.kills, 0)

  return {
    laning: {
      gold15,
      xp15,
      xpPerMin15,
      cs15,
      damage15,
      damagePerMin15,
      goldDiff15,
      xpDiff15,
      csDiff15,
      damageDiff15,
      turretPlates15,
      firstBloodParticipation: p.firstBloodKill || p.firstBloodAssist || false,
    },
    economy: {
      xp: xpTotal,
      xpPerMin,
      goldPerMin: gameDurationMin > 0 ? Math.round(p.goldEarned / gameDurationMin) : 0,
      csPerMin: gameDurationMin > 0 ? Number((p.totalMinionsKilled + p.neutralMinionsKilled) / gameDurationMin).toFixed(1) : '0',
      teamGoldPercent: teamGold > 0 ? Number(((p.goldEarned / teamGold) * 100).toFixed(1)) : 0,
      laneCS: p.totalMinionsKilled,
      jungleCS: p.neutralMinionsKilled,
      maxCsAdvantage: ch.maxCsAdvantageOnLaneOpponent != null
        ? Math.round(ch.maxCsAdvantageOnLaneOpponent)
        : null,
    },
    combat: {
      killParticipation: teamKills > 0 ? Number((((p.kills + p.assists) / teamKills) * 100).toFixed(1)) : 0,
      damagePerMin: gameDurationMin > 0 ? Math.round(p.totalDamageDealtToChampions / gameDurationMin) : 0,
      teamDamagePercent: teamDamage > 0 ? Number(((p.totalDamageDealtToChampions / teamDamage) * 100).toFixed(1)) : 0,
      damagePerGold: p.goldEarned > 0 ? Number((p.totalDamageDealtToChampions / p.goldEarned).toFixed(2)) : 0,
      soloKills: ch.soloKills ?? null,
      damageTaken: p.totalDamageTaken,
      damageMitigated: p.damageSelfMitigated ?? 0,
      damageTakenPercent: teamDamageTaken > 0 ? Number(((p.totalDamageTaken / teamDamageTaken) * 100).toFixed(1)) : 0,
    },
    objectives: {
      damageToEpicMonsters: playerEpicMonsterDmg,
      teamEpicMonsterDmgPercent: teamEpicMonsterDmg > 0
        ? Number(((playerEpicMonsterDmg / teamEpicMonsterDmg) * 100).toFixed(1))
        : 0,
      damageToBuildings: p.damageDealtToBuildings ?? 0,
      teamBuildingDamagePercent: teamBuildingDamage > 0
        ? Number((((p.damageDealtToBuildings ?? 0) / teamBuildingDamage) * 100).toFixed(1))
        : 0,
      objectivesStolen: p.objectivesStolen ?? 0,
      firstTowerParticipation: p.firstTowerKill || p.firstTowerAssist || false,
      turretPlates: ch.turretPlatesTaken ?? 0,
      inhibitorTakedowns: p.inhibitorTakedowns ?? p.inhibitorKills ?? 0,
    },
    vision: {
      visionScorePerMin: gameDurationMin > 0 ? Number((p.visionScore / gameDurationMin).toFixed(2)) : 0,
      controlWardsPurchased: p.visionWardsBoughtInGame ?? 0,
      wardsPlaced: p.wardsPlaced ?? 0,
      wardsDestroyed: p.wardsKilled ?? 0,
      stealthWardsPlaced: ch.stealthWardsPlaced ?? null,
      visionScoreAdvantage: visionScoreAdv,
    },
    behavioral: {
      skillshotsDodged: ch.skillshotsDodged ?? null,
      killsNearEnemyTurret: ch.killsNearEnemyTurret ?? null,
      outnumberedKills: ch.outnumberedKills ?? null,
      takedownsInEnemyJungle: ch.takedownsInEnemyJungle ?? null,
    },
    meta: {
      champion: p.championName,
      role: p.teamPosition || p.individualPosition || 'UNKNOWN',
      win: p.win,
      kills: p.kills,
      deaths: p.deaths,
      assists: p.assists,
      cs: p.totalMinionsKilled + p.neutralMinionsKilled,
      visionScore: p.visionScore,
      duration: matchData.info.gameDuration,
      gameEndAt: matchData.info.gameEndTimestamp,
      matchId: matchData.metadata.matchId,
      opponentChampion: opponent?.championName ?? null,
    },
    opponent: opponent ? (() => {
      const oppCh = opponent.challenges ?? {}
      const oppCs = (opponent.totalMinionsKilled ?? 0) + (opponent.neutralMinionsKilled ?? 0)
      const oppTotalDamage = opponent.totalDamageDealtToChampions ?? 0
      const oppGold = opponent.goldEarned ?? 0
      const oppEpicMonsterDmg = Math.max(0, (opponent.damageDealtToObjectives ?? 0) - (opponent.damageDealtToBuildings ?? 0))
      return {
        champion: opponent.championName,
        kills: opponent.kills,
        deaths: opponent.deaths,
        assists: opponent.assists,
        cs: oppCs,
        laneCS: opponent.totalMinionsKilled ?? 0,
        jungleCS: opponent.neutralMinionsKilled ?? 0,
        visionScore: opponent.visionScore ?? 0,
        totalDamage: oppTotalDamage,
        damagePerMin: gameDurationMin > 0 ? Math.round(oppTotalDamage / gameDurationMin) : 0,
        goldEarned: oppGold,
        goldPerMin: gameDurationMin > 0 ? Math.round(oppGold / gameDurationMin) : 0,
        csPerMin: gameDurationMin > 0 ? Number((oppCs / gameDurationMin).toFixed(1)) : 0,
        visionScorePerMin: gameDurationMin > 0 ? Number(((opponent.visionScore ?? 0) / gameDurationMin).toFixed(2)) : 0,
        wardsPlaced: opponent.wardsPlaced ?? 0,
        wardsDestroyed: opponent.wardsKilled ?? 0,
        controlWardsPurchased: opponent.visionWardsBoughtInGame ?? 0,
        stealthWardsPlaced: oppCh.stealthWardsPlaced ?? null,
        damageTaken: opponent.totalDamageTaken ?? 0,
        damageMitigated: opponent.damageSelfMitigated ?? 0,
        damagePerGold: oppGold > 0 ? Number((oppTotalDamage / oppGold).toFixed(2)) : 0,
        killParticipation: oppTeamKills > 0 ? Number((((opponent.kills + opponent.assists) / oppTeamKills) * 100).toFixed(1)) : 0,
        epicMonsterDamage: oppEpicMonsterDmg,
        damageToBuildings: opponent.damageDealtToBuildings ?? 0,
        objectivesStolen: opponent.objectivesStolen ?? 0,
        inhibitorTakedowns: opponent.inhibitorTakedowns ?? opponent.inhibitorKills ?? 0,
        turretPlates: oppCh.turretPlatesTaken ?? 0,
        firstTowerParticipation: opponent.firstTowerKill || opponent.firstTowerAssist || false,
        firstBloodParticipation: opponent.firstBloodKill || opponent.firstBloodAssist || false,
        soloKills: oppCh.soloKills ?? null,
        skillshotsDodged: oppCh.skillshotsDodged ?? null,
        killsNearEnemyTurret: oppCh.killsNearEnemyTurret ?? null,
        outnumberedKills: oppCh.outnumberedKills ?? null,
        takedownsInEnemyJungle: oppCh.takedownsInEnemyJungle ?? null,
        gold15: oppGold15,
        xp15: oppXp15,
        xpPerMin15: oppXpPerMin15,
        cs15: oppCs15,
        damage15: oppDamage15,
        damagePerMin15: oppDamagePerMin15,
        turretPlates15: oppTurretPlates15,
      }
    })() : null,
  }
}
