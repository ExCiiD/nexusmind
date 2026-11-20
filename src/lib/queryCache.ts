/**
 * Page data cache, stale-while-revalidate (20/11/2026: "a page already loaded reloads when I come back").
 *
 * A page that comes back shows the data it had at once, and refreshes it in the background when it is older
 * than `staleMs`. One fetch per key at a time: two cards asking for the same key share it. Memory only: an app
 * restart starts empty. Pure module (no React), so it is unit-tested; the hook is in hooks/useCachedQuery.ts.
 */

export interface CacheEntry<T> {
  data?: T
  error?: unknown
  /** When `data` was fetched (ms). 0: never. */
  at: number
  /** When the last fetch failed (ms): no automatic retry before staleMs. */
  errorAt?: number
  inflight?: Promise<T>
}

type Listener = () => void

const entries = new Map<string, CacheEntry<unknown>>()
const listeners = new Map<string, Set<Listener>>()

export function getEntry<T>(key: string): CacheEntry<T> | undefined {
  return entries.get(key) as CacheEntry<T> | undefined
}

export function subscribe(key: string, fn: Listener): () => void {
  let set = listeners.get(key)
  if (!set) { set = new Set(); listeners.set(key, set) }
  set.add(fn)
  return () => { set!.delete(fn) }
}

function notify(key: string) {
  for (const fn of listeners.get(key) ?? []) fn()
}

/** Fetches `key` unless a fetch of it is already running; the entry keeps its old data until the new one lands. */
export function fetchInto<T>(key: string, fetcher: () => Promise<T>, now: () => number = Date.now): Promise<T> {
  const current = entries.get(key) as CacheEntry<T> | undefined
  if (current?.inflight) return current.inflight
  const inflight = fetcher().then(
    (data) => {
      entries.set(key, { data, at: now() })
      notify(key)
      return data
    },
    (error) => {
      const prev = entries.get(key) as CacheEntry<T> | undefined
      entries.set(key, { data: prev?.data, at: prev?.at ?? 0, error, errorAt: now() })
      notify(key)
      throw error
    },
  )
  entries.set(key, { ...(current ?? { at: 0 }), inflight })
  notify(key)
  return inflight
}

/** True when the entry has no data yet or its data is older than `staleMs`. */
export function isStale(entry: CacheEntry<unknown> | undefined, staleMs: number, now = Date.now()): boolean {
  if (entry?.errorAt && now - entry.errorAt < staleMs) return false
  return !entry || entry.at === 0 || now - entry.at >= staleMs
}

/** Seeds or replaces a key's data (an optimistic update after the page changed it). */
export function setCached<T>(key: string, data: T, now = Date.now()) {
  entries.set(key, { data, at: now })
  notify(key)
}

/**
 * Marks every key that starts with `prefix` as stale: the next page that shows it refetches (still showing the
 * old data meanwhile), and a page showing it now refetches at once.
 */
export function invalidateCached(prefix: string) {
  for (const [key, entry] of entries) {
    if (!key.startsWith(prefix)) continue
    entries.set(key, { ...entry, at: 0, errorAt: undefined })
    notify(key)
  }
}

/** Tests only. */
export function clearQueryCache() {
  entries.clear()
  listeners.clear()
}
