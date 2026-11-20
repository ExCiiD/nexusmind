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
import { getMatchIds } from './riotClient'

const FRESH_MS = 60_000
/** Past this age a stale list is not served any more: it is refetched and awaited. */
const MAX_STALE_MS = 6 * 60 * 60_000

type Queue = 'soloq' | 'flex' | 'both'

interface Entry { ids: string[]; at: number; inflight?: Promise<string[]> }

const entries = new Map<string, Entry>()
/** Bumped by invalidateMatchIds: a fetch started before it does not store its (older) list. */
let generation = 0

function refresh(key: string, load: () => Promise<string[]>): Promise<string[]> {
  const current = entries.get(key)
  if (current?.inflight) return current.inflight
  const gen = generation
  const inflight = load().then(
    (ids) => {
      if (gen === generation) entries.set(key, { ids, at: Date.now() })
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
  const key = `${puuid}|${region}|${count}|${start}|${queue}`
  const load = () => getMatchIds(puuid, region, count, start, queue)
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
}
