import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'

/**
 * A piece of page state kept in the URL query (`?obj=dragon`), so that leaving the page (« Rewatch » → Record) and coming back
 * restores it. The default is left out of the URL; an unknown value reads as the default; updates replace the history entry
 * (a filter click never piles up behind the back button). Other params of the page are kept.
 */
export function useUrlParam<T extends string>(key: string, def: T, valid?: readonly T[]): [T, (v: T) => void] {
  const [params, setParams] = useSearchParams()
  const raw = params.get(key)
  const value = (raw != null && (!valid || (valid as readonly string[]).includes(raw)) ? raw : def) as T
  const set = useCallback((v: T) => setParams((cur) => {
    const next = new URLSearchParams(cur)
    if (v === def) next.delete(key); else next.set(key, v)
    return next
  }, { replace: true }), [setParams, key, def])
  return [value, set]
}
