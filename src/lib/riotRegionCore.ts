/**
 * The server (platform) each Riot account plays on, found from its puuid (decision of 20/11/2026, DECISIONS.md).
 *
 * A stored region goes stale: a player transfers their account (SG2 → EUW1, the puuid stays the same), or plays
 * several accounts on different servers. Every by-puuid call (match ids, rank, masteries, summoner) must use the
 * server the account plays on now, never one region for the whole user.
 *
 * - **Detection**: account-v1 `GET /riot/account/v1/region/by-game/lol/by-puuid/{puuid}` ("Get active region",
 *   lol and tft). `active-shards` does not accept `lol`. Answered on americas, asia or europe (not sea).
 * - **Manual choice** per account ("Auto" by default) wins over the detection when it is set.
 * - **Short cache** (10 min), and a fresh detection when a match search finds nothing (at most once a minute per
 *   account), so a transfer is picked up during a session.
 * - **Old history**: after a transfer the earlier games stay on the old server's cluster. Match id listings read
 *   both clusters, the current one first; a match id carries its own platform, so reading it needs nothing more.
 *
 * Pure: the caller supplies the Riot call and the clock. Shared by the desktop (electron/main/riotClient.ts) and the
 * web (web/src/riotWeb.ts).
 */

export const PLATFORMS = ['BR1', 'EUN1', 'EUW1', 'JP1', 'KR', 'LA1', 'LA2', 'NA1', 'OC1', 'PH2', 'RU', 'SG2', 'TH2', 'TR1', 'TW2', 'VN2'] as const
export type Platform = (typeof PLATFORMS)[number]

export const PLATFORM_ROUTING: Record<Platform, 'americas' | 'asia' | 'europe' | 'sea'> = {
  BR1: 'americas', LA1: 'americas', LA2: 'americas', NA1: 'americas',
  OC1: 'sea', PH2: 'sea', SG2: 'sea', TH2: 'sea', TW2: 'sea', VN2: 'sea',
  JP1: 'asia', KR: 'asia',
  EUN1: 'europe', EUW1: 'europe', RU: 'europe', TR1: 'europe',
}

/** `auto`: detected from the puuid. A platform: chosen by the player, wins over the detection. */
export type RegionMode = 'auto' | Platform

export const REGION_CACHE_MS = 10 * 60_000
export const REDETECT_AFTER_EMPTY_MS = 60_000

/** 'euw1', 'EUW1', ' euw1 ' → 'EUW1'; anything unknown → null. */
export function normalizePlatform(value: unknown): Platform | null {
  if (typeof value !== 'string') return null
  const up = value.trim().toUpperCase()
  return (PLATFORMS as readonly string[]).includes(up) ? (up as Platform) : null
}

/** A stored `regionMode`: a known platform, otherwise 'auto' (also for null, '', 'AUTO'). */
export function normalizeRegionMode(value: unknown): RegionMode {
  return normalizePlatform(value) ?? 'auto'
}

export function routingOf(platform: string): 'americas' | 'asia' | 'europe' | 'sea' {
  return PLATFORM_ROUTING[normalizePlatform(platform) ?? 'EUW1']
}

/** account-v1 is not served on sea: the closest cluster that answers it. */
export function accountRoutingFor(platformHint: string | null | undefined): 'americas' | 'asia' | 'europe' {
  const r = platformHint ? routingOf(platformHint) : 'europe'
  return r === 'sea' ? 'asia' : r
}

export const ACTIVE_REGION_PATH = (puuid: string) => `/riot/account/v1/region/by-game/lol/by-puuid/${encodeURIComponent(puuid)}`

/** The platform in an account-v1 "active region" answer ({ puuid, game, region: 'euw1' }), or null. */
export function platformFromActiveRegion(body: unknown): Platform | null {
  if (!body || typeof body !== 'object') return null
  return normalizePlatform((body as { region?: unknown }).region)
}

export interface RegionResolution {
  /** Where to send by-puuid calls now. */
  platform: Platform
  /** Why: the player's choice, a detection, or the stored region (detection unavailable). */
  source: 'manual' | 'detected' | 'stored'
  /** The stored region when it differs from `platform` (old history after a transfer), else null. */
  previous: Platform | null
}

/** Who is asking: a detection made for a background scout is a background call, one made for a screen is not. */
export interface RegionCallContext { background?: boolean }

export interface RegionResolverDeps {
  /** One account-v1 "active region" call; null when Riot has no answer. Throws on a network or key error. */
  detect: (puuid: string, platformHint: Platform | null, ctx?: RegionCallContext) => Promise<Platform | null>
  now?: () => number
  /** Told when a detection differs from the stored region, so the caller can save it (Auto accounts only). */
  onDetectedChange?: (puuid: string, from: Platform | null, to: Platform) => void
}

interface CacheEntry { platform: Platform | null; at: number }

export function createRegionResolver(deps: RegionResolverDeps) {
  const now = deps.now ?? Date.now
  const overrides = new Map<string, Platform>()
  const cache = new Map<string, CacheEntry>()
  const inflight = new Map<string, Promise<Platform | null>>()
  const lastEmptyRedetect = new Map<string, number>()
  const previousOf = new Map<string, Platform>()
  const notified = new Map<string, Platform>()

  const previousFor = (puuid: string, stored: Platform | null, platform: Platform): Platform | null => {
    if (stored && stored !== platform) return stored
    const prev = previousOf.get(puuid)
    return prev && prev !== platform ? prev : null
  }

  async function detectOnce(puuid: string, hint: Platform | null, ctx?: RegionCallContext): Promise<Platform | null> {
    const running = inflight.get(puuid)
    if (running) return running
    const p = deps.detect(puuid, hint, ctx)
      .then((platform) => { cache.set(puuid, { platform, at: now() }); return platform })
      .catch(() => {
        // A failed detection is cached briefly too, so an outage does not double every Riot call.
        cache.set(puuid, { platform: null, at: now() })
        return null
      })
      .finally(() => inflight.delete(puuid))
    inflight.set(puuid, p)
    return p
  }

  async function resolve(puuid: string, storedRegion: string | null | undefined, ctx?: RegionCallContext): Promise<RegionResolution> {
    const stored = normalizePlatform(storedRegion)
    const manual = overrides.get(puuid)
    if (manual) return { platform: manual, source: 'manual', previous: previousFor(puuid, stored, manual) }
    if (!puuid) return { platform: stored ?? 'EUW1', source: 'stored', previous: null }
    const hit = cache.get(puuid)
    const detected = hit && now() - hit.at < REGION_CACHE_MS ? hit.platform : await detectOnce(puuid, stored, ctx)
    if (!detected) return { platform: stored ?? 'EUW1', source: 'stored', previous: null }
    if (detected !== stored && notified.get(puuid) !== detected) {
      notified.set(puuid, detected)
      if (stored) previousOf.set(puuid, stored)
      deps.onDetectedChange?.(puuid, stored, detected)
    }
    return { platform: detected, source: 'detected', previous: previousFor(puuid, stored, detected) }
  }

  /**
   * Runs a by-puuid listing on the account's server. Nothing found: one fresh detection (at most once a minute per
   * account) and, if the server changed, the listing again there. `mergePrevious`: after a transfer, the old
   * server's cluster is read too and merged by recency (match ids only).
   */
  async function list(puuid: string, storedRegion: string | null | undefined, fetchIds: (platform: Platform) => Promise<string[]>, opts: { mergePrevious?: boolean; ctx?: RegionCallContext } = {}): Promise<string[]> {
    let res = await resolve(puuid, storedRegion, opts.ctx)
    let ids = await fetchIds(res.platform)
    if (ids.length === 0 && res.source !== 'manual') {
      const last = lastEmptyRedetect.get(puuid) ?? -Infinity
      if (now() - last >= REDETECT_AFTER_EMPTY_MS) {
        lastEmptyRedetect.set(puuid, now())
        cache.delete(puuid)
        const again = await resolve(puuid, storedRegion, opts.ctx)
        if (again.platform !== res.platform) {
          res = again
          ids = await fetchIds(res.platform)
        }
      }
    }
    if (opts.mergePrevious && res.previous && routingOf(res.previous) !== routingOf(res.platform)) {
      const old = await fetchIds(res.previous).catch(() => [] as string[])
      // Never sorted by id: ids of two servers do not compare. The old server only has games from before the
      // transfer, so they come after.
      if (old.length) ids = [...ids, ...old.filter((id) => !ids.includes(id))]
    }
    return ids
  }

  return {
    resolve,
    list,
    /** The player's choice for one account: a platform, or 'auto' / null to go back to the detection. */
    setMode(puuid: string, mode: RegionMode | string | null | undefined) {
      const p = normalizePlatform(mode)
      if (p) overrides.set(puuid, p)
      else overrides.delete(puuid)
    },
    /** The server an account's older games are on (saved after a transfer), so listings still find them. */
    setPrevious(puuid: string, platform: string | null | undefined) {
      const p = normalizePlatform(platform)
      if (p) previousOf.set(puuid, p)
      else previousOf.delete(puuid)
    },
    /**
     * A server seen for sure, e.g. the platform of the account's latest game (its match id, the League game log):
     * taken as the detection, without asking Riot. A manual choice still wins.
     */
    observe(puuid: string, platform: string | null | undefined) {
      const p = normalizePlatform(platform)
      if (puuid && p) cache.set(puuid, { platform: p, at: now() })
    },
    /** Forget the detection of one account (or all), e.g. when the player asks to detect again. */
    invalidate(puuid?: string) {
      if (puuid) { cache.delete(puuid); lastEmptyRedetect.delete(puuid) } else { cache.clear(); lastEmptyRedetect.clear() }
    },
    /** The cached detection, without calling Riot (for the settings screen). */
    peek(puuid: string): { platform: Platform | null; at: number } | null {
      return cache.get(puuid) ?? null
    },
  }
}

/** One line of the settings screen (desktop: `account:regions`). */
export interface AccountRegionInfo {
  /** 'main' for the profile's own account, otherwise the Account id. */
  accountId: string
  puuid: string
  gameName: string
  tagLine: string
  /** The player's choice: 'auto' or a platform. */
  mode: RegionMode
  /** The server calls go to now. */
  region: Platform | null
  /** The server found from the puuid (null: not detected, e.g. Riot unreachable). */
  detected: Platform | null
  detectedAt: string | null
  /** The server before a transfer, still read for older games. */
  previousRegion: Platform | null
}

export type RegionResolver = ReturnType<typeof createRegionResolver>
