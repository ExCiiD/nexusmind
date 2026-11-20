import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import { fetchInto, getEntry, isStale, subscribe } from '@/lib/queryCache'

/** Data younger than this is shown without a refetch (quick back-and-forth between pages costs nothing). */
const DEFAULT_STALE_MS = 30_000

/**
 * A page's data through the shared cache (lib/queryCache.ts): the last data at once when the page comes back,
 * a background refresh when it is older than `staleMs`. `key` null: nothing is fetched.
 *
 * `loading` is true only while there is nothing to show yet; `refreshing` while a newer copy is on its way.
 */
export function useCachedQuery<T>(
  key: string | null,
  fetcher: () => Promise<T>,
  opts: { staleMs?: number } = {},
): { data: T | undefined; error: unknown; loading: boolean; refreshing: boolean; reload: () => Promise<T | undefined> } {
  const staleMs = opts.staleMs ?? DEFAULT_STALE_MS
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  const entry = useSyncExternalStore(
    useCallback((fn: () => void) => (key ? subscribe(key, fn) : () => {}), [key]),
    () => (key ? getEntry<T>(key) : undefined),
  )

  // On mount, on a new key, and when the entry is invalidated (at reset to 0) while the page shows it.
  const at = entry?.at ?? 0
  const inflight = !!entry?.inflight
  useEffect(() => {
    if (!key || inflight) return
    if (isStale(getEntry(key), staleMs)) fetchInto(key, () => fetcherRef.current()).catch(() => {})
  }, [key, at, inflight, staleMs])

  const reload = useCallback(async () => {
    if (!key) return undefined
    return fetchInto(key, () => fetcherRef.current())
  }, [key])

  const hasData = entry?.data !== undefined
  return {
    data: entry?.data,
    error: hasData ? undefined : entry?.error,
    loading: !!key && !hasData && !entry?.error,
    refreshing: inflight && hasData,
    reload,
  }
}
