import { useEffect, useRef } from 'react'
import { useCollab } from '@/hooks/useCollab'
import { groupKey, invalidateGroupCalendar } from '@/lib/groupQueries'
import { invalidateCached } from '@/lib/queryCache'
import type { RealtimeEvent } from '@/lib/realtimeCore'

/**
 * Realtime → page cache (Audit, beta.19 review): a change made by someone else marks the cached data it touches as
 * stale, so an open page refetches at once (still showing the old data meanwhile) and a page opened later does too.
 * Without it, a cached screen kept another member's change until its 30 s were up and it was opened again.
 *
 * Events of an `rls` table carry no group: every group of mine is refreshed for that topic. Bursts are debounced.
 * The `POLL` catch-ups (Realtime back after a drop) count like changes. Renders nothing.
 */
const DEBOUNCE_MS = 500

export function invalidateForRealtime(e: Pick<RealtimeEvent, 'topic' | 'groupId'>, myGroupIds: string[]) {
  const groups = e.groupId ? [e.groupId] : myGroupIds
  for (const gid of groups) {
    switch (e.topic) {
      case 'calendar':
        invalidateGroupCalendar(gid)
        break
      case 'team_sessions':
      case 'team_session_reviews':
        invalidateCached(groupKey(gid, 'sessions'))
        break
      case 'announcements':
        invalidateCached(groupKey(gid, 'announcements'))
        break
      default:
        break // notifications: not in the page cache
    }
  }
}

export function RealtimeCacheBridge() {
  const { groups } = useCollab()
  const groupIdsRef = useRef<string[]>([])
  groupIdsRef.current = groups.map((g) => g.id)

  useEffect(() => {
    const api = (window as unknown as { api?: { onCloudRealtime?: (cb: (e: RealtimeEvent) => void) => () => void } }).api
    if (!api?.onCloudRealtime) return
    const pending = new Map<string, Pick<RealtimeEvent, 'topic' | 'groupId'>>()
    let timer: ReturnType<typeof setTimeout> | null = null
    const off = api.onCloudRealtime((e) => {
      pending.set(`${e.topic}|${e.groupId ?? ''}`, { topic: e.topic, groupId: e.groupId })
      if (timer) return
      timer = setTimeout(() => {
        timer = null
        for (const ev of pending.values()) invalidateForRealtime(ev, groupIdsRef.current)
        pending.clear()
      }, DEBOUNCE_MS)
    })
    return () => {
      if (timer) clearTimeout(timer)
      off?.()
    }
  }, [])

  return null
}
