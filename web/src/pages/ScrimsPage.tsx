import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { CalendarDays, Check, Loader2, Plus, Trash2, X } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/useToast'
import { useCollab } from '@/hooks/useCollab'
import { cn } from '@/lib/utils'
import type { Group } from '@/lib/collab'
import {
  createScrim, deleteScrim, listAvailability, listScrims, listTeamDrafts, setAvailability, updateScrim,
  type Availability, type AvailabilityRow, type Scrim, type TeamDraft,
} from '../scrims'

const isStaff = (g?: Group) => !!g && g.myRole !== 'player'
const DEFAULT_CHECKLIST = ['web.scrims.defaults.draft', 'web.scrims.defaults.comms', 'web.scrims.defaults.goals']

export function ScrimsPage() {
  const { t, i18n } = useTranslation()
  const { toast } = useToast()
  const { groups, myUserId, nameOf, loading } = useCollab()
  const [scrims, setScrims] = useState<Scrim[] | null>(null)
  const [avail, setAvail] = useState<AvailabilityRow[]>([])
  const [params] = useSearchParams()
  const [selected, setSelected] = useState<string | null>(params.get('scrim'))
  const [showPast, setShowPast] = useState(false)

  const load = useCallback(async () => {
    try {
      const list = await listScrims(groups.map((g) => g.id))
      setScrims(list)
      setAvail(await listAvailability(list.map((s) => s.id)))
    } catch {
      setScrims([])
    }
  }, [groups])

  useEffect(() => { if (!loading) load() }, [loading, load])

  const now = Date.now()
  const visible = (scrims ?? []).filter((s) => showPast ? true : (s.status === 'planned' && Date.parse(s.scheduledAt) > now - 6 * 3600_000))
  const staffGroups = groups.filter(isStaff)
  const current = scrims?.find((s) => s.id === selected) ?? null

  return (
    <div className="space-y-4 animate-fade-in">
      <div>
        <h1 className="font-display text-2xl font-bold text-hextech-gold-bright">{t('web.scrims.title')}</h1>
        <p className="mt-1 text-sm">{t('web.scrims.subtitle')}</p>
      </div>

      {groups.length === 0 && !loading && <p className="text-sm text-hextech-text-dim">{t('web.scrims.noGroup')}</p>}

      {staffGroups.length > 0 && <NewScrimForm groups={staffGroups} onCreated={async (s) => { await load(); setSelected(s.id) }} />}

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="flex items-center gap-2 text-base"><CalendarDays className="h-4 w-4 text-hextech-gold" />{t('web.scrims.list')}</CardTitle>
          <button className="text-xs text-hextech-text-dim hover:text-hextech-text" onClick={() => setShowPast(!showPast)}>
            {showPast ? t('web.scrims.hidePast') : t('web.scrims.showPast')}
          </button>
        </CardHeader>
        <CardContent>
          {scrims === null ? <Loader2 className="h-5 w-5 animate-spin" /> : visible.length === 0 ? (
            <p className="text-sm text-hextech-text-dim">{t('web.scrims.none')}</p>
          ) : (
            <ul className="space-y-2">
              {visible.map((s) => {
                const mine = avail.find((a) => a.scrimId === s.id && a.userId === myUserId)?.status
                const yes = avail.filter((a) => a.scrimId === s.id && a.status === 'yes').length
                return (
                  <li key={s.id}>
                    <button
                      onClick={() => setSelected(selected === s.id ? null : s.id)}
                      className={cn('flex w-full items-center justify-between rounded-lg border p-3 text-left text-sm',
                        selected === s.id ? 'border-hextech-gold/60' : 'border-hextech-border-dim hover:border-hextech-gold/30')}
                    >
                      <span>
                        <span className="text-hextech-text-bright">{s.title}</span>
                        {s.opponent && <span className="text-hextech-text-dim"> · {s.opponent}</span>}
                        <span className="block text-xs text-hextech-text-dim">
                          {groups.find((g) => g.id === s.groupId)?.name} · {t(`web.scrims.status.${s.status}`)} · {t('web.scrims.confirmed', { count: yes })}
                        </span>
                      </span>
                      <span className="text-right text-xs">
                        <span className="block text-hextech-gold">
                          {new Date(s.scheduledAt).toLocaleString(i18n.language, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </span>
                        {mine && <span className="text-hextech-text-dim">{t(`web.scrims.avail.${mine}`)}</span>}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {current && myUserId && (
        <ScrimDetail
          key={current.id}
          scrim={current}
          group={groups.find((g) => g.id === current.groupId)!}
          myUserId={myUserId}
          availability={avail.filter((a) => a.scrimId === current.id)}
          nameOf={nameOf}
          onChanged={load}
          onDeleted={async () => { setSelected(null); await load() }}
          onError={(e) => toast({ title: (e as Error).message === 'FORBIDDEN' ? t('coaching.errors.FORBIDDEN') : t('coaching.errors.generic'), variant: 'destructive' })}
        />
      )}
    </div>
  )
}

function NewScrimForm({ groups, onCreated }: { groups: Group[]; onCreated: (s: Scrim) => void }) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [groupId, setGroupId] = useState(groups[0]?.id ?? '')
  const [title, setTitle] = useState('')
  const [opponent, setOpponent] = useState('')
  const [when, setWhen] = useState('')
  const [duration, setDuration] = useState('120')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!groupId || !title.trim() || !when) return
    setBusy(true)
    try {
      const s = await createScrim({
        groupId, title, opponent, scheduledAt: new Date(when).toISOString(),
        durationMin: Math.min(600, Math.max(15, Number(duration) || 120)),
        checklist: DEFAULT_CHECKLIST.map((k) => ({ label: t(k), done: false })),
      })
      setTitle(''); setOpponent(''); setWhen(''); setOpen(false)
      onCreated(s)
    } catch {
      toast({ title: t('coaching.errors.generic'), variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return <Button className="gap-2" onClick={() => setOpen(true)}><Plus className="h-4 w-4" />{t('web.scrims.new')}</Button>
  }
  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <div className="grid gap-2 sm:grid-cols-2">
          <Select value={groupId} onValueChange={setGroupId}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{groups.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}</SelectContent>
          </Select>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder={t('web.scrims.titlePlaceholder')} />
          <Input value={opponent} onChange={(e) => setOpponent(e.target.value)} maxLength={120} placeholder={t('web.scrims.opponentPlaceholder')} />
          <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} aria-label={t('web.scrims.when')} />
          <Input type="number" min={15} max={600} step={15} value={duration} onChange={(e) => setDuration(e.target.value)} aria-label={t('web.scrims.duration')} />
        </div>
        <div className="flex gap-2">
          <Button onClick={submit} disabled={busy || !title.trim() || !when}>
            {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}{t('common.create')}
          </Button>
          <Button variant="ghost" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
        </div>
      </CardContent>
    </Card>
  )
}

function ScrimDetail({ scrim, group, myUserId, availability, nameOf, onChanged, onDeleted, onError }: {
  scrim: Scrim; group: Group; myUserId: string; availability: AvailabilityRow[]
  nameOf: (id: string) => string; onChanged: () => Promise<void>; onDeleted: () => Promise<void>; onError: (e: unknown) => void
}) {
  const { t } = useTranslation()
  const staff = isStaff(group)
  const [prep, setPrep] = useState(scrim.prepNotes ?? '')
  const [review, setReview] = useState(scrim.reviewNotes ?? '')
  const [newItem, setNewItem] = useState('')
  const [comment, setComment] = useState(availability.find((a) => a.userId === myUserId)?.comment ?? '')
  const [drafts, setDrafts] = useState<TeamDraft[]>([])

  useEffect(() => {
    listTeamDrafts(group.members.map((m) => m.userId)).then(setDrafts).catch(() => setDrafts([]))
  }, [group])

  const linked = useMemo(() => drafts.filter((d) => scrim.draftIds.includes(d.id)), [drafts, scrim.draftIds])

  const run = async (fn: () => Promise<void>) => {
    try { await fn(); await onChanged() } catch (e) { onError(e) }
  }

  const statusOf = (userId: string) => availability.find((a) => a.userId === userId)

  return (
    <Card className="border-hextech-gold/40">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{scrim.title}{scrim.opponent && <span className="text-hextech-text-dim"> · {scrim.opponent}</span>}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5 text-sm">
        {/* Availability — every member */}
        <section className="space-y-2">
          <h3 className="font-medium text-hextech-text-bright">{t('web.scrims.availability')}</h3>
          <div className="flex flex-wrap gap-2">
            {(['yes', 'maybe', 'no'] as Availability[]).map((v) => (
              <Button key={v} size="sm" variant={statusOf(myUserId)?.status === v ? 'default' : 'outline'}
                onClick={() => run(() => setAvailability(scrim.id, myUserId, v, comment.trim() || null))}>
                {t(`web.scrims.avail.${v}`)}
              </Button>
            ))}
          </div>
          <Input value={comment} onChange={(e) => setComment(e.target.value)} maxLength={300} placeholder={t('web.scrims.availComment')}
            onBlur={() => { const s = statusOf(myUserId)?.status; if (s) run(() => setAvailability(scrim.id, myUserId, s, comment.trim() || null)) }} />
          <ul className="grid gap-1 sm:grid-cols-2">
            {group.members.map((m) => {
              const a = statusOf(m.userId)
              return (
                <li key={m.userId} className="flex items-center justify-between rounded bg-hextech-elevated/30 px-2 py-1 text-xs">
                  <span className="truncate">{m.userId === myUserId ? t('coaching.comments.you') : nameOf(m.userId)}</span>
                  <span className={cn(a?.status === 'yes' ? 'text-hextech-green' : a?.status === 'no' ? 'text-[#E24C3A]' : 'text-hextech-text-dim')}>
                    {a ? t(`web.scrims.avail.${a.status}`) : '—'}{a?.comment ? ` · ${a.comment}` : ''}
                  </span>
                </li>
              )
            })}
          </ul>
        </section>

        {/* Prep */}
        <section className="space-y-2">
          <h3 className="font-medium text-hextech-text-bright">{t('web.scrims.prep')}</h3>
          <ul className="space-y-1">
            {scrim.checklist.map((item, i) => (
              <li key={i} className="flex items-center gap-2">
                <button disabled={!staff} onClick={() => run(() => updateScrim(scrim.id, { checklist: scrim.checklist.map((c, j) => j === i ? { ...c, done: !c.done } : c) }))}
                  className={cn('flex h-4 w-4 items-center justify-center rounded border', item.done ? 'border-hextech-green bg-hextech-green/20' : 'border-hextech-border')}>
                  {item.done && <Check className="h-3 w-3 text-hextech-green" />}
                </button>
                <span className={cn(item.done && 'line-through opacity-60')}>{item.label}</span>
                {staff && (
                  <button className="ml-auto text-hextech-text-dim hover:text-[#E24C3A]" onClick={() => run(() => updateScrim(scrim.id, { checklist: scrim.checklist.filter((_, j) => j !== i) }))}>
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
          {staff && (
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (newItem.trim()) run(async () => { await updateScrim(scrim.id, { checklist: [...scrim.checklist, { label: newItem.trim().slice(0, 120), done: false }] }); setNewItem('') }) }}>
              <Input value={newItem} onChange={(e) => setNewItem(e.target.value)} placeholder={t('web.scrims.addItem')} />
              <Button type="submit" size="sm" variant="outline"><Plus className="h-4 w-4" /></Button>
            </form>
          )}
          {staff ? (
            <Textarea value={prep} onChange={(e) => setPrep(e.target.value)} rows={4} maxLength={8000} placeholder={t('web.scrims.prepPlaceholder')}
              onBlur={() => prep !== (scrim.prepNotes ?? '') && run(() => updateScrim(scrim.id, { prepNotes: prep || null }))} />
          ) : scrim.prepNotes ? <p className="whitespace-pre-wrap">{scrim.prepNotes}</p> : null}
        </section>

        {/* Drafts */}
        <section className="space-y-2">
          <h3 className="font-medium text-hextech-text-bright">{t('web.scrims.drafts')}</h3>
          {linked.length === 0 && <p className="text-xs text-hextech-text-dim">{t('web.scrims.noDraft')}</p>}
          {linked.map((d) => (
            <div key={d.id} className="rounded-lg bg-hextech-elevated/30 p-2 text-xs">
              <div className="mb-1 font-medium text-hextech-text-bright">{d.name}</div>
              <div><span className="text-blue-400">{t('web.scrims.blue')}</span> {d.bluePicks.filter(Boolean).join(', ') || '—'} <span className="text-hextech-text-dim">({t('web.scrims.bans')}: {d.blueBans.filter(Boolean).join(', ') || '—'})</span></div>
              <div><span className="text-red-400">{t('web.scrims.red')}</span> {d.redPicks.filter(Boolean).join(', ') || '—'} <span className="text-hextech-text-dim">({t('web.scrims.bans')}: {d.redBans.filter(Boolean).join(', ') || '—'})</span></div>
              {d.notes && <p className="mt-1 whitespace-pre-wrap">{d.notes}</p>}
              {staff && (
                <button className="mt-1 text-hextech-text-dim hover:text-[#E24C3A]" onClick={() => run(() => updateScrim(scrim.id, { draftIds: scrim.draftIds.filter((x) => x !== d.id) }))}>
                  {t('web.scrims.unlink')}
                </button>
              )}
            </div>
          ))}
          {staff && drafts.length > linked.length && (
            <Select value="" onValueChange={(id) => run(() => updateScrim(scrim.id, { draftIds: [...scrim.draftIds, id].slice(0, 10) }))}>
              <SelectTrigger className="w-72"><SelectValue placeholder={t('web.scrims.linkDraft')} /></SelectTrigger>
              <SelectContent>
                {drafts.filter((d) => !scrim.draftIds.includes(d.id)).map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
        </section>

        {/* Post-scrim */}
        <section className="space-y-2">
          <h3 className="font-medium text-hextech-text-bright">{t('web.scrims.review')}</h3>
          {staff ? (
            <Textarea value={review} onChange={(e) => setReview(e.target.value)} rows={4} maxLength={8000} placeholder={t('web.scrims.reviewPlaceholder')}
              onBlur={() => review !== (scrim.reviewNotes ?? '') && run(() => updateScrim(scrim.id, { reviewNotes: review || null }))} />
          ) : scrim.reviewNotes ? <p className="whitespace-pre-wrap">{scrim.reviewNotes}</p> : <p className="text-xs text-hextech-text-dim">{t('web.scrims.noReview')}</p>}
        </section>

        {staff && (
          <div className="flex flex-wrap gap-2 border-t border-hextech-border-dim pt-3">
            {scrim.status !== 'done' && <Button size="sm" variant="outline" onClick={() => run(() => updateScrim(scrim.id, { status: 'done' }))}>{t('web.scrims.markDone')}</Button>}
            {scrim.status === 'planned' && <Button size="sm" variant="ghost" onClick={() => run(() => updateScrim(scrim.id, { status: 'cancelled' }))}>{t('web.scrims.cancel')}</Button>}
            <Button size="sm" variant="ghost" className="ml-auto gap-1 text-[#E24C3A]"
              onClick={() => { if (window.confirm(t('web.scrims.deleteConfirm'))) deleteScrim(scrim.id).then(onDeleted).catch(onError) }}>
              <Trash2 className="h-3.5 w-3.5" />{t('common.delete')}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
