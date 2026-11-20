import { useEffect, useRef, useState } from 'react'
import { useVisiblePolling } from './useVisiblePolling'
import type { RealtimeStatus, RealtimeTopic } from '@/lib/realtimeCore'

/** While Realtime is live, the screen's own poll only backs it up. */
export const REALTIME_BACKUP_POLL_MS = 15 * 60_000
const DEBOUNCE_MS = 1_000

/**
 * Drop-in for `useVisiblePolling` on screens that show Realtime tables (docs/contracts/realtime.md):
 * - runs `fn` about 1 s after a change of one of `topics` (several changes in a burst: one run) ;
 * - with `groupId`, only for that group's changes (POLL catch-ups of the user channel always count) ;
 * - keeps polling every `intervalMs` while Realtime is down or unavailable (older app, no window.api support),
 *   every 15 min while it is live.
 */
export function useRealtimeRefresh(topics: RealtimeTopic[], fn: () => unknown, intervalMs: number, opts: { enabled?: boolean; groupId?: string | null; /** false when the screen already loads on mount (no double load). */ immediate?: boolean } = {}): RealtimeStatus {
  const enabled = opts.enabled ?? true
  const [status, setStatus] = useState<RealtimeStatus>('stopped')
  const fnRef = useRef(fn)
  fnRef.current = fn
  const key = topics.join(',')

  useEffect(() => {
    const api = (window as unknown as { api?: Record<string, any> }).api
    if (!enabled || !api?.onCloudRealtime) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const wanted = new Set(key.split(','))
    const offEvent = api.onCloudRealtime((e: { topic: string; groupId: string | null }) => {
      if (!wanted.has(e.topic)) return
      if (opts.groupId && e.groupId && e.groupId !== opts.groupId) return
      if (timer) return
      timer = setTimeout(() => { timer = null; void fnRef.current() }, DEBOUNCE_MS)
    })
    const offStatus = api.onCloudRealtimeStatus?.((s: RealtimeStatus) => setStatus(s))
    void api.cloudRealtimeStatus?.().then((s: RealtimeStatus) => setStatus(s)).catch(() => {})
    return () => {
      if (timer) clearTimeout(timer)
      offEvent?.()
      offStatus?.()
    }
  }, [enabled, key, opts.groupId])

  useVisiblePolling(fn, status === 'live' ? Math.max(intervalMs, REALTIME_BACKUP_POLL_MS) : intervalMs, enabled, opts.immediate ?? true)
  return status
}
