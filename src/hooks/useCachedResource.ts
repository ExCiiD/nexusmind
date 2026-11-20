import { useCallback } from 'react'
import { useCachedQuery } from '@/hooks/useCachedQuery'
import { getEntry, setCached } from '@/lib/queryCache'

/**
 * Perf gain 3: a section's list through the shared cache, with the shape its old useState code had — `data`, `failed`
 * (nothing to show and the read failed, `error` then says why), `load()` (refetch; never throws) and `set()` (an
 * optimistic change, written to the cache so the next visit shows it too). `key` null: nothing is fetched.
 */
export function useCachedResource<T>(key: string | null, fetcher: () => Promise<T>, opts: { staleMs?: number } = {}) {
  const q = useCachedQuery<T>(key, fetcher, opts)
  const reload = q.reload
  const load = useCallback(() => reload().catch(() => undefined), [reload])
  const set = useCallback((next: T | ((cur: T | undefined) => T)) => {
    if (!key) return
    const cur = getEntry<T>(key)?.data
    setCached(key, typeof next === 'function' ? (next as (c: T | undefined) => T)(cur) : next)
  }, [key])
  const failed = q.data === undefined && !!q.error
  return { data: q.data, failed, error: failed ? q.error : undefined, loading: q.loading, refreshing: q.refreshing, load, set }
}
