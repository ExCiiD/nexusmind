/**
 * Lightweight Data Dragon helpers for the main process.
 *
 * Data Dragon serves static LoL metadata (champion list, items, runes…).
 * The renderer has its own `useAllChampions` hook for UI use; this module
 * is for backend operations that need to map Riot API numeric IDs
 * (`championId: 266`) to Data Dragon string keys (`"Aatrox"`).
 */

const FALLBACK_VERSION = '15.7.1'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24h — patches roll out daily at most

let cachedVersion: { value: string; expires: number } | null = null
let cachedIdToKey: { value: Record<number, string>; expires: number } | null = null
let inflightVersion: Promise<string> | null = null
let inflightIdToKey: Promise<Record<number, string>> | null = null

async function fetchLatestVersion(): Promise<string> {
  if (cachedVersion && cachedVersion.expires > Date.now()) return cachedVersion.value
  if (inflightVersion) return inflightVersion
  inflightVersion = (async () => {
    try {
      const r = await fetch('https://ddragon.leagueoflegends.com/api/versions.json')
      if (!r.ok) throw new Error(`Status ${r.status}`)
      const versions = (await r.json()) as string[]
      const v = versions?.[0] ?? FALLBACK_VERSION
      cachedVersion = { value: v, expires: Date.now() + CACHE_TTL_MS }
      return v
    } catch (err) {
      console.warn('[dataDragon] Failed to fetch latest version, using fallback:', err)
      return FALLBACK_VERSION
    } finally {
      inflightVersion = null
    }
  })()
  return inflightVersion
}

/**
 * Returns a map of Riot's numeric championId → Data Dragon string key.
 * Cached for 24h to avoid hammering Data Dragon and to keep auto-fill fast.
 *
 * Returns `{}` on network failure rather than throwing — callers should treat
 * missing keys as "skip this champion" rather than aborting the whole flow.
 */
export async function getChampionIdToKey(): Promise<Record<number, string>> {
  if (cachedIdToKey && cachedIdToKey.expires > Date.now()) return cachedIdToKey.value
  if (inflightIdToKey) return inflightIdToKey
  inflightIdToKey = (async () => {
    try {
      const version = await fetchLatestVersion()
      const r = await fetch(`https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/champion.json`)
      if (!r.ok) throw new Error(`Status ${r.status}`)
      const data = (await r.json()) as { data: Record<string, { id: string; key: string }> }
      const map: Record<number, string> = {}
      for (const c of Object.values(data.data ?? {})) {
        const numericId = parseInt(c.key, 10)
        if (!Number.isNaN(numericId)) map[numericId] = c.id
      }
      cachedIdToKey = { value: map, expires: Date.now() + CACHE_TTL_MS }
      return map
    } catch (err) {
      console.warn('[dataDragon] Failed to fetch champion list:', err)
      return {}
    } finally {
      inflightIdToKey = null
    }
  })()
  return inflightIdToKey
}
