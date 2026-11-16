import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Megaphone, Pin, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/useToast'
import { collabErrorKey } from '@/lib/collab'
import type { Announcement } from '@/lib/announcements'

/** Phase 2 (Planning rework §9): announcements, now part of Planning and
 *  gated by canEditCalendar instead of the old is_group_staff — see
 *  AnnouncementBubbleStack.tsx for how these also surface as a persistent
 *  notification everywhere else in the app. */
export function AnnouncementsCard({ groupId, canEdit, nameOf }: { groupId: string; canEdit: boolean; nameOf: (id: string) => string }) {
  const { t, i18n } = useTranslation()
  const { toast } = useToast()
  const [items, setItems] = useState<Announcement[] | null>(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [creating, setCreating] = useState(false)

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
      setTitle(''); setBody('')
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

  return (
    <div className="space-y-2 rounded-lg border border-hextech-border-dim p-3">
      <h4 className="flex items-center gap-1.5 text-sm font-medium text-hextech-text-bright">
        <Megaphone className="h-4 w-4 text-hextech-gold" />{t('announcements.title', { defaultValue: 'Announcements' })}
      </h4>
      {canEdit && (
        <div className="flex flex-wrap gap-2 rounded-lg border border-hextech-border-dim p-3">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} className="flex-1 min-w-[10rem]" placeholder={t('announcements.titlePlaceholder', { defaultValue: 'Title…' })} />
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={1} maxLength={4000} className="flex-1 min-w-[12rem]" placeholder={t('announcements.bodyPlaceholder', { defaultValue: 'Message…' })} />
          <Button size="sm" onClick={create} disabled={!title.trim() || !body.trim() || creating}>
            {creating && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}{t('announcements.post', { defaultValue: 'Post' })}
          </Button>
        </div>
      )}
      {items === null ? (
        <Loader2 className="h-4 w-4 animate-spin text-hextech-text-dim" />
      ) : items.length === 0 ? (
        <p className="text-xs text-hextech-text-dim">{t('announcements.none', { defaultValue: 'No announcements yet.' })}</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((a) => (
            <li key={a.id} className="rounded-lg border border-hextech-border-dim p-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-1.5">
                    {a.pinned && <Pin className="h-3.5 w-3.5 text-hextech-gold" />}
                    <span className="text-sm font-medium text-hextech-text-bright">{a.title}</span>
                  </div>
                  <p className="text-sm text-hextech-text">{a.body}</p>
                  <p className="text-[11px] text-hextech-text-dim">{nameOf(a.createdBy)} · {new Date(a.createdAt).toLocaleDateString(i18n.language)}</p>
                </div>
                {canEdit && (
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="ghost" onClick={() => togglePin(a)}><Pin className={a.pinned ? 'h-3.5 w-3.5 text-hextech-gold' : 'h-3.5 w-3.5 text-hextech-text-dim'} /></Button>
                    <Button size="sm" variant="ghost" onClick={() => remove(a.id)}><Trash2 className="h-3.5 w-3.5 text-hextech-text-dim" /></Button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
