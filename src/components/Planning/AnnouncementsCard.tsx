import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, Loader2, Megaphone, Pin, Plus, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/useToast'
import { collabErrorKey } from '@/lib/collab'
import { cn } from '@/lib/utils'
import type { Announcement } from '@/lib/announcements'

/** Phase 2 (Planning rework §9): announcements, now part of Planning and
 *  gated by canEditCalendar instead of the old is_group_staff — see
 *  AnnouncementBubbleStack.tsx for how these also surface as a persistent
 *  notification everywhere else in the app.
 *  Redesign 17/11/2026: a compact strip showing the pinned (or latest)
 *  announcement; the composer and the full list open on demand. */
export function AnnouncementsCard({ groupId, canEdit, nameOf }: { groupId: string; canEdit: boolean; nameOf: (id: string) => string }) {
  const { t, i18n } = useTranslation()
  const { toast } = useToast()
  const [items, setItems] = useState<Announcement[] | null>(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [creating, setCreating] = useState(false)
  const [composing, setComposing] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const load = useCallback(async () => {
    try { setItems(await window.api.announcementsList(groupId)) }
    catch (err) { setItems([]); toast({ title: t(collabErrorKey(err)), variant: 'destructive' }) }
  }, [groupId, t, toast])

  useEffect(() => { setItems(null); load() }, [load])

  const create = async () => {
    if (!title.trim() || !body.trim()) return
    setCreating(true)
    try {
      await window.api.announcementsCreate(groupId, { title: title.trim(), body: body.trim() })
      setTitle(''); setBody(''); setComposing(false)
      await load()
    } catch (err) { toast({ title: t(collabErrorKey(err)), variant: 'destructive' }) }
    finally { setCreating(false) }
  }

  const togglePin = async (a: Announcement) => {
    try { await window.api.announcementsSetPinned(a.id, !a.pinned); await load() }
    catch (err) { toast({ title: t(collabErrorKey(err)), variant: 'destructive' }) }
  }
  const remove = async (id: string) => {
    try { await window.api.announcementsDelete(id); await load() }
    catch (err) { toast({ title: t(collabErrorKey(err)), variant: 'destructive' }) }
  }

  const sorted = [...(items ?? [])].sort((a, b) => Number(b.pinned) - Number(a.pinned) || Date.parse(b.createdAt) - Date.parse(a.createdAt))
  const head = sorted[0]
  const rest = sorted.slice(1)

  return (
    <div className="rounded-lg border border-hextech-gold/30 bg-hextech-gold/[0.05]">
      <div className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-hextech-gold/40 bg-hextech-gold/15">
            {head?.pinned ? <Pin className="h-4 w-4 text-hextech-gold" /> : <Megaphone className="h-4 w-4 text-hextech-gold" />}
          </div>
          {items === null ? (
            <Loader2 className="mt-2 h-4 w-4 animate-spin text-hextech-text-dim" />
          ) : head ? (
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
                <span className="font-bold uppercase tracking-wider text-hextech-gold">{head.pinned ? t('announcements.pinned') : t('announcements.latest')}</span>
                <span className="text-hextech-text-dim">{nameOf(head.createdBy)} · {new Date(head.createdAt).toLocaleDateString(i18n.language)}</span>
              </div>
              <p className="truncate text-sm text-hextech-text-bright"><span className="font-semibold">{head.title}</span> — <span className="text-hextech-text">{head.body}</span></p>
            </div>
          ) : (
            <p className="mt-1.5 text-xs text-hextech-text-dim">{t('announcements.none', { defaultValue: 'No announcements yet.' })}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {head && (
            <button onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}
              className="flex items-center gap-1 rounded-md border border-hextech-border-dim px-2.5 py-1.5 font-mono text-[10px] font-bold uppercase text-hextech-text-bright hover:border-hextech-gold">
              {t('announcements.seeAll', { count: sorted.length })}<ChevronDown className={cn('h-3 w-3 transition-transform', expanded && 'rotate-180')} />
            </button>
          )}
          {canEdit && (
            <button onClick={() => setComposing((v) => !v)} aria-expanded={composing}
              className="flex items-center gap-1 rounded-md border border-hextech-gold/50 bg-hextech-gold/10 px-2.5 py-1.5 font-mono text-[10px] font-bold uppercase text-hextech-gold hover:bg-hextech-gold/20">
              {composing ? <X className="h-3 w-3" /> : <Plus className="h-3 w-3" />}{composing ? t('common.cancel', { defaultValue: 'Cancel' }) : t('announcements.publish')}
            </button>
          )}
        </div>
      </div>

      {canEdit && composing && (
        <div className="flex flex-wrap gap-2 border-t border-hextech-gold/20 p-3">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} className="min-w-[10rem] flex-1" placeholder={t('announcements.titlePlaceholder', { defaultValue: 'Title…' })} autoFocus />
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={1} maxLength={4000} className="min-w-[12rem] flex-[2]" placeholder={t('announcements.bodyPlaceholder', { defaultValue: 'Message…' })} />
          <Button size="sm" onClick={create} disabled={!title.trim() || !body.trim() || creating}>
            {creating && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}{t('announcements.post', { defaultValue: 'Post' })}
          </Button>
        </div>
      )}

      {expanded && head && (
        <ul className="space-y-1.5 border-t border-hextech-gold/20 p-3">
          {[head, ...rest].map((a) => (
            <li key={a.id} className="group flex items-start justify-between gap-2 rounded-md border border-hextech-border-dim bg-hextech-black/30 p-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  {a.pinned && <Pin className="h-3.5 w-3.5 text-hextech-gold" />}
                  <span className="text-sm font-medium text-hextech-text-bright">{a.title}</span>
                </div>
                <p className="whitespace-pre-wrap text-sm text-hextech-text">{a.body}</p>
                <p className="text-[11px] text-hextech-text-dim">{nameOf(a.createdBy)} · {new Date(a.createdAt).toLocaleDateString(i18n.language)}</p>
              </div>
              {canEdit && (
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="ghost" onClick={() => togglePin(a)} aria-label={t('announcements.togglePin')}><Pin className={a.pinned ? 'h-3.5 w-3.5 text-hextech-gold' : 'h-3.5 w-3.5 text-hextech-text-dim'} /></Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(a.id)} aria-label={t('common.delete', { defaultValue: 'Delete' })}><Trash2 className="h-3.5 w-3.5 text-hextech-text-dim" /></Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
