import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { useCollab } from '@/hooks/useCollab'
import { undismissedFor } from '@/lib/announcementsCore'
import type { Announcement, AnnouncementDismissal } from '@/lib/announcements'

const POLL_MS = 30_000
const MAX_VISIBLE = 5

async function fetchGroupAnnouncements(groupId: string): Promise<[string, Announcement[]]> {
  try { return [groupId, await window.api.announcementsList(groupId)] }
  catch { return [groupId, []] }
}

/**
 * Phase 2 (Planning rework, docs/PLAN_GESTION_EQUIPE.md §9): a persistent
 * bubble per undismissed announcement, mounted once at the app-shell level
 * (App.tsx / WebLayout.tsx) so it's visible from anywhere, not just the
 * Planning tab.
 *
 * Three failure modes this is deliberately built against:
 *   1. Never re-stack a duplicate on a poll tick — a bubble's only "hide"
 *      signal is dismissal (server-persisted `announcement_dismissals` +
 *      an optimistic local set to close the gap before the next poll
 *      round-trips), never a local "already shown this session" flag that
 *      a remount could forget.
 *   2. Dismissal survives app restarts — same write-through-to-server
 *      pattern as any other table write, read back on every load.
 *   3. Never blocks interactive UI — fixed corner stack, the container is
 *      `pointer-events-none` so only the cards themselves (which opt back
 *      into `pointer-events-auto`) can be clicked.
 */
export function AnnouncementBubbleStack() {
  const { t, i18n } = useTranslation()
  const { available, groups, myUserId } = useCollab()
  const [byGroup, setByGroup] = useState<Map<string, Announcement[]>>(new Map())
  const [dismissals, setDismissals] = useState<AnnouncementDismissal[]>([])
  const [dismissedLocally, setDismissedLocally] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    if (!available || groups.length === 0) return
    const [lists, myDismissals] = await Promise.all([
      Promise.all(groups.map((g) => fetchGroupAnnouncements(g.id))),
      window.api.announcementsListMyDismissals().catch(() => []),
    ])
    setByGroup(new Map(lists))
    setDismissals(myDismissals)
  }, [available, groups])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (!available) return
    const id = setInterval(load, POLL_MS)
    return () => clearInterval(id)
  }, [available, load])

  if (!available || !myUserId) return null

  const visible = groups.flatMap((g) => {
    const items = byGroup.get(g.id) ?? []
    return undismissedFor(items, dismissals, myUserId)
      .filter((a) => !dismissedLocally.has(a.id))
      .map((a) => ({ ...a, groupName: g.name }))
  }).slice(0, MAX_VISIBLE)

  if (visible.length === 0) return null

  const dismiss = (id: string) => {
    setDismissedLocally((prev) => new Set(prev).add(id))
    window.api.announcementsDismiss(id).catch(() => {})
  }

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-40 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
      {visible.map((a) => (
        <div key={a.id} className="pointer-events-auto rounded-lg border border-hextech-gold/50 bg-hextech-dark/95 p-3 shadow-lg backdrop-blur">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              {groups.length > 1 && <p className="truncate text-[10px] uppercase tracking-wide text-hextech-text-dim">{a.groupName}</p>}
              <p className="text-sm font-semibold text-hextech-gold-bright">{a.title}</p>
              <p className="mt-0.5 whitespace-pre-wrap text-xs text-hextech-text">{a.body}</p>
              <p className="mt-1 text-[10px] text-hextech-text-dim">{new Date(a.createdAt).toLocaleString(i18n.language, { dateStyle: 'short', timeStyle: 'short' })}</p>
            </div>
            <button onClick={() => dismiss(a.id)} title={t('announcements.close', { defaultValue: 'Close' })} className="shrink-0 text-hextech-text-dim hover:text-white">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
