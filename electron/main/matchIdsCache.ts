/**
 * Riot match-id lists, cached in memory (20/11/2026, "every load is slow").
 *
 * The dashboard, the History and the Stats pages each asked Riot for every account's match list on every open:
 * one proxy round-trip per account, queued behind the shared rate limiter (scouting, catch-up), before anything
 * could show. A list only changes when a game ends, so:
 *  - younger than FRESH_MS: served as is;
 *  - older: served at once too, and refreshed in the background for the next read;
 *  - none yet (first read after start-up): fetched and awaited.
 * `invalidateMatchIds()` is called when a game is saved, so the next read waits for the new list.
 */
import { readFileSync, writeFile } from 'fs'
import { getMatchIds } from './riotClient'

const FRESH_MS = 60_000
/** Riot's maximum per call, for the same cost as 10: one list per account serves every count the screens ask for. */
const FETCH_COUNT = 100
/** Past this age a stale list is not served any more: it is refetched and awaited. */
const MAX_STALE_MS = 6 * 60 * 60_000

type Queue = 'soloq' | 'flex' | 'both'

interface Entry { ids: string[]; at: number; inflight?: Promise<string[]> }

const entries = new Map<string, Entry>()
/** Bumped by invalidateMatchIds: a fetch started before it does not store its (older) list. */
let generation = 0

// ── On disk (initMatchIdsPersistence): the first read after a restart is served from the last lists (then
// refreshed behind, like any stale list) instead of waiting for Riot. Keys hold the puuid: no mix between profiles.
let persistPath: string | null = null
let persistTimer: ReturnType<typeof setTimeout> | null = null

export function initMatchIdsPersistence(filePath: string) {
  persistPath = filePath
  try {
    const saved = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, { ids: string[]; at: number }>
    for (const [key, e] of Object.entries(saved)) {
      if (Array.isArray(e?.ids) && typeof e.at === 'number' && !entries.has(key)) entries.set(key, { ids: e.ids, at: e.at })
    }
  } catch { /* first run or unreadable: starts empty */ }
}

function schedulePersist() {
  if (!persistPath || persistTimer) return
  persistTimer = setTimeout(() => {
    persistTimer = null
    const out: Record<string, { ids: string[]; at: number }> = {}
    for (const [key, e] of entries) if (e.at > 0) out[key] = { ids: e.ids, at: e.at }
    writeFile(persistPath!, JSON.stringify(out), () => {})
  }, 2_000)
}

function refresh(key: string, load: () => Promise<string[]>): Promise<string[]> {
  const current = entries.get(key)
  if (current?.inflight) return current.inflight
  const gen = generation
  const inflight = load().then(
    (ids) => {
      if (gen === generation) { entries.set(key, { ids, at: Date.now() }); schedulePersist() }
      else if (entries.get(key)?.inflight === inflight) entries.delete(key)
      return ids
    },
    (err) => {
      const prev = entries.get(key)
      if (prev && gen === generation && prev.at > 0) entries.set(key, { ids: prev.ids, at: prev.at })
      else if (entries.get(key)?.inflight === inflight) entries.delete(key)
      throw err
    },
  )
  entries.set(key, { ids: current?.ids ?? [], at: current?.at ?? 0, inflight })
  return inflight
}

export async function getMatchIdsCached(puuid: string, region: string, count: number, start: number, queue: Queue): Promise<string[]> {
  // From the start: one cached list of FETCH_COUNT, sliced. A page further down (start > 0) is its own key.
  const fetchCount = start === 0 ? Math.max(count, FETCH_COUNT) : count
  const key = `${puuid}|${region}|${fetchCount}|${start}|${queue}`
  const load = () => getMatchIds(puuid, region, fetchCount, start, queue)
  const ids = await readThrough(key, load)
  return ids.slice(0, count)
}

async function readThrough(key: string, load: () => Promise<string[]>): Promise<string[]> {
  const entry = entries.get(key)
  const age = entry && entry.at > 0 ? Date.now() - entry.at : Infinity
  if (age < FRESH_MS) return entry!.ids
  if (age < MAX_STALE_MS) {
    refresh(key, load).catch(() => {})
    return entry!.ids
  }
  return refresh(key, load)
}

/** A game was saved (detector, catch-up, import): every cached list is out of date. */
export function invalidateMatchIds() {
  generation++
  entries.clear()
  schedulePersist()
}
