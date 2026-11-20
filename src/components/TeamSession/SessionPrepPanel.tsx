import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Check, ChevronDown, Eye, Loader2, MessageSquare, Plus, Swords, Target, Trash2, Users, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/useToast'
import { useChampionIconUrl } from '@/hooks/useChampionIconUrl'
import { cn } from '@/lib/utils'
import { isServerNotReadyError } from '@/lib/matchEventView'
import { resolveAttendeeScope } from '@/lib/calendarCore'
import { playsInGroup } from '@/lib/permissions'
import type { CalendarEvent } from '@/lib/calendar'
import type { Group } from '@/lib/collab'
import type { TeamSession } from '@/lib/teamSessions'
import type { NameOf } from '@/hooks/useCollab'
import type { PlayerSessionObjectives, SessionDraft, SessionPrep } from '@/lib/sessionPrep'

const panel = 'space-y-3 rounded-lg border border-hextech-border-dim bg-hextech-dark/50 p-4'
const MAX_PLAYER_OBJECTIVES = 2
const NOTE_MAX = 140
const MESSAGE_MAX = 280

const prepErrorKey = (err: unknown) => {
  const msg = (err as Error)?.message ?? ''
  if (/NOT_AVAILABLE/.test(msg) || isServerNotReadyError(err)) return 'sessionPrep.notDeployed'
  if (/FORBIDDEN/.test(msg)) return 'sessionPrep.errors.forbidden'
  if (/INVALID/.test(msg)) return 'sessionPrep.errors.invalid'
  return 'sessionPrep.errors.generic'
}

/**
 * Preparing a team session ahead (docs/DESIGN_STATE.md § 17, contract docs/contracts/session-prep.md), under the
 * collective objectives of the session page: each player's objectives (their Mon plan axes first), the drafts linked
 * to the session, the message to the players — saved as they change — and « Prévisualiser comme un joueur ». A player
 * sees the read-only view: the coach's message, the team's objectives, their own, the drafts, their presence.
 */
export function SessionPrepPanel({ session, event, group, myUserId, nameOf, objectiveLabel, fundamentals }: {
  session: TeamSession
  event: CalendarEvent
  group: Group
  myUserId: string
  nameOf: NameOf
  objectiveLabel: (id: string) => string
  /** The group's fundamentals (id, label), offered for each player. */
  fundamentals: Array<{ id: string; label: string }>
}) {
  const { t } = useTranslation()
  const [prep, setPrep] = useState<SessionPrep | null | undefined>(undefined)
  const [failed, setFailed] = useState<string | null>(null)
  const [preview, setPreview] = useState(false)

  const load = useCallback(async () => {
    if (!window.api.sessionPrepGet) { setPrep(null); return }
    try { setPrep(await window.api.sessionPrepGet(session.id)); setFailed(null) } catch (err) { setFailed(prepErrorKey(err)); setPrep(null) }
  }, [session.id])
  useEffect(() => { void load() }, [load])

  if (prep === undefined) return <div className="h-32 animate-pulse rounded-lg bg-hextech-elevated/60" aria-busy />
  if (!prep || !prep.available) {
    // Before the migration (or an error): a line for the staff, nothing for the players.
    return failed || prep ? <p className="text-xs text-hextech-text-dim">{t(failed ?? 'sessionPrep.notDeployed')}</p> : null
  }

  const live = session.status === 'live'
  const staffView = prep.canPrepare && !preview
  return (
    <div className="space-y-4">
      {live && <p className="rounded-md border border-hextech-border-dim bg-hextech-black/30 px-3 py-2 text-sm text-hextech-text-dim">{t('sessionPrep.liveReadOnly')}</p>}
      {staffView ? (
        <StaffPrep prep={prep} session={session} event={event} group={group} nameOf={nameOf} objectiveLabel={objectiveLabel} fundamentals={fundamentals} onChange={setPrep} />
      ) : (
        <PlayerPrep prep={prep} event={event} myUserId={myUserId} nameOf={nameOf} objectiveLabel={objectiveLabel} previewing={preview} />
      )}
      {prep.canPrepare && (
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setPreview((v) => !v)}>
          <Eye className="h-3.5 w-3.5" />{preview ? t('sessionPrep.backToPrep') : t('sessionPrep.preview')}
        </Button>
      )}
    </div>
  )
}

/* ─── Staff ─── */

function useSaved() {
  const { t } = useTranslation()
  const [at, setAt] = useState<number | null>(null)
  const [, tick] = useState(0)
  useEffect(() => { const id = setInterval(() => tick((x) => x + 1), 5_000); return () => clearInterval(id) }, [])
  const label = at == null ? null : t('sessionPrep.savedAgo', { seconds: Math.max(1, Math.round((Date.now() - at) / 1000)) })
  return [label, () => setAt(Date.now())] as const
}

function StaffPrep({ prep, session, event, group, nameOf, objectiveLabel, fundamentals, onChange }: {
  prep: SessionPrep
  session: TeamSession
  event: CalendarEvent
  group: Group
  nameOf: NameOf
  objectiveLabel: (id: string) => string
  fundamentals: Array<{ id: string; label: string }>
  onChange: (p: SessionPrep) => void
}) {
  const { t, i18n } = useTranslation()
  const { toast } = useToast()
  const [saved, markSaved] = useSaved()
  const players = useMemo(() => {
    const ids = resolveAttendeeScope(event.attendeeScope, group.members, event.attendeeUserIds)
    return group.members.filter((m) => ids.includes(m.userId) && playsInGroup({ role: m.role, alsoPlays: m.alsoPlays }))
  }, [event, group.members])
  const start = new Date(event.startsAt)
  // The latest prep, so several writes in a row (« Copier sur toute l'équipe ») each build on the previous one.
  const latest = useRef(prep)
  latest.current = prep

  const setPlayer = async (playerId: string, value: Pick<PlayerSessionObjectives, 'objectiveIds' | 'note'> | null) => {
    const cur = latest.current
    const others = cur.playerObjectives.filter((p) => p.playerId !== playerId)
    const next = value && (value.objectiveIds.length || value.note)
      ? [...others, { playerId, objectiveIds: value.objectiveIds, kpiIds: [], note: value.note, setBy: null, setAt: new Date().toISOString() }]
      : others
    latest.current = { ...cur, playerObjectives: next }
    onChange(latest.current)
    try {
      await window.api.sessionPrepSetPlayerObjectives(session.id, playerId, value && (value.objectiveIds.length || value.note) ? { objectiveIds: value.objectiveIds, kpiIds: [], note: value.note } : null)
      markSaved()
    } catch (err) { toast({ title: t(prepErrorKey(err)), variant: 'destructive' }) }
  }
  const copyToTeam = (objectiveIds: string[]) => {
    for (const p of players) {
      const cur = prep.playerObjectives.find((x) => x.playerId === p.userId)
      void setPlayer(p.userId, { objectiveIds, note: cur?.note ?? null })
    }
  }

  return (
    <div className="space-y-4">
      <p className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-hextech-gold/40 bg-hextech-gold/5 px-3 py-2 text-xs text-hextech-text">
        <span>{t('sessionPrep.banner', { date: start.toLocaleString(i18n.language, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) })}</span>
        {saved && <span className="font-mono text-hextech-text-dim" aria-live="polite">{saved}</span>}
      </p>

      {/* 2. Individual objectives */}
      <section className={panel} aria-label={t('sessionPrep.individual')}>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-hextech-text-bright"><Target className="h-4 w-4 text-hextech-gold" />{t('sessionPrep.individual')}</h2>
        {players.length === 0 ? <p className="text-sm text-hextech-text-dim">{t('sessionPrep.noPlayers')}</p> : (
          <ul className="space-y-2">
            {players.map((m) => (
              <PlayerRow key={m.userId} groupId={group.id} playerId={m.userId} name={nameOf(m.userId)}
                value={prep.playerObjectives.find((p) => p.playerId === m.userId) ?? null}
                fundamentals={fundamentals} objectiveLabel={objectiveLabel}
                onSave={(v) => { void setPlayer(m.userId, v) }} onCopyToTeam={copyToTeam} />
            ))}
          </ul>
        )}
      </section>

      {/* 3. Linked drafts */}
      <DraftsBlock prep={prep} session={session} event={event} group={group} onChange={onChange} onSaved={markSaved} />

      {/* 4. Message to the players */}
      <MessageBlock sessionId={session.id} value={prep.message?.text ?? ''} onSaved={(text) => { onChange({ ...prep, message: text ? { text, setBy: null, setAt: new Date().toISOString() } : null }); markSaved() }} />
    </div>
  )
}

function PlayerRow({ groupId, playerId, name, value, fundamentals, objectiveLabel, onSave, onCopyToTeam }: {
  groupId: string
  playerId: string
  name: string
  value: PlayerSessionObjectives | null
  fundamentals: Array<{ id: string; label: string }>
  objectiveLabel: (id: string) => string
  onSave: (v: { objectiveIds: string[]; note: string | null }) => void
  onCopyToTeam: (objectiveIds: string[]) => void
}) {
  const { t } = useTranslation()
  const [fromPlan, setFromPlan] = useState<string[]>([])
  const [note, setNote] = useState(value?.note ?? '')
  const ids = value?.objectiveIds ?? []
  const timer = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => () => clearTimeout(timer.current), [])

  // Their Mon plan axes, offered first (« de son plan »).
  useEffect(() => {
    let alive = true
    window.api.devPlanGetForPlayer?.(groupId, playerId)
      .then((p) => { if (alive) setFromPlan((p?.axes ?? []).filter((a) => a.status === 'active').map((a) => a.fundamentalId)) })
      .catch(() => {})
    return () => { alive = false }
  }, [groupId, playerId])

  const options = [
    ...fromPlan.map((id) => ({ id, label: objectiveLabel(id), plan: true })),
    ...fundamentals.filter((f) => !fromPlan.includes(f.id)).map((f) => ({ ...f, plan: false })),
  ].filter((o) => !ids.includes(o.id))
  const noteChanged = (text: string) => {
    setNote(text)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => onSave({ objectiveIds: ids, note: text.trim() || null }), 800)
  }

  return (
    <li className="space-y-1.5 rounded-md border border-hextech-border-dim bg-hextech-black/30 p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-32 truncate text-sm font-semibold text-hextech-text-bright">{name}</span>
        {ids.map((id) => (
          <span key={id} className="inline-flex items-center gap-1 rounded bg-hextech-gold/10 px-2 py-0.5 text-xs text-hextech-gold">
            {objectiveLabel(id)}{fromPlan.includes(id) && <span className="text-[10px] text-hextech-text-dim">· {t('sessionPrep.fromPlan')}</span>}
            <button type="button" onClick={() => onSave({ objectiveIds: ids.filter((x) => x !== id), note: note.trim() || null })} aria-label={t('sessionPrep.removeObjective', { name: objectiveLabel(id) })} className="hover:text-hextech-red"><X className="h-3 w-3" /></button>
          </span>
        ))}
        {ids.length < MAX_PLAYER_OBJECTIVES && (
          <Select value="" onValueChange={(id) => onSave({ objectiveIds: [...ids, id], note: note.trim() || null })}>
            <SelectTrigger className="h-7 w-48 text-xs" aria-label={t('sessionPrep.addObjectiveFor', { name })}><SelectValue placeholder={t('sessionPrep.addObjective')} /></SelectTrigger>
            <SelectContent>
              {options.map((o) => <SelectItem key={o.id} value={o.id}>{o.label}{o.plan ? ` · ${t('sessionPrep.fromPlan')}` : ''}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        {ids.length > 0 && <button type="button" onClick={() => onCopyToTeam(ids)} className="ml-auto text-xs text-hextech-gold hover:underline">{t('sessionPrep.copyToTeam')}</button>}
      </div>
      <Input value={note} maxLength={NOTE_MAX} onChange={(e) => noteChanged(e.target.value)} placeholder={t('sessionPrep.notePlaceholder')} aria-label={t('sessionPrep.noteFor', { name })} className="h-8 text-xs" />
    </li>
  )
}

/** The Draft Sim: Coaching on the desktop, the Team page on the web. */
const draftSimPath = () => (window.api.cloudOpenWeb ? '/coaching?tab=draft' : '/team?tab=draft')

function DraftsBlock({ prep, session, event, group, onChange, onSaved }: {
  prep: SessionPrep
  session: TeamSession
  event: CalendarEvent
  group: Group
  onChange: (p: SessionPrep) => void
  onSaved: () => void
}) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [choices, setChoices] = useState<Array<{ id: string; name: string; local: boolean }>>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    void (async () => {
      const shared = await window.api.teamGetShared(group.id).then((s) => s.drafts.map((d) => ({ id: d.id, name: d.name, local: false }))).catch(() => [])
      const local = window.api.sessionPrepAttachLocalDraft
        ? await window.api.listDrafts().then((l) => l.map((d) => ({ id: d.id, name: d.name || '—', local: true }))).catch(() => [])
        : []
      if (alive) setChoices([...local, ...shared])
    })()
    return () => { alive = false }
  }, [group.id])

  const reload = async () => onChange(await window.api.sessionPrepGet(session.id))
  const attach = async (key: string) => {
    const c = choices.find((x) => `${x.local ? 'l' : 's'}:${x.id}` === key)
    if (!c) return
    setBusy(true)
    try {
      if (c.local) await window.api.sessionPrepAttachLocalDraft!(session.id, c.id)
      else await window.api.sessionPrepAttachSharedDraft(session.id, c.id)
      await reload(); onSaved()
    } catch (err) { toast({ title: t(prepErrorKey(err)), variant: 'destructive' }) } finally { setBusy(false) }
  }
  const remove = async (d: SessionDraft) => {
    onChange({ ...prep, drafts: prep.drafts.filter((x) => x.id !== d.id) })
    try { await window.api.sessionPrepRemoveDraft(d.id); onSaved() } catch (err) { toast({ title: t(prepErrorKey(err)), variant: 'destructive' }); void reload() }
  }

  return (
    <section className={panel} aria-label={t('sessionPrep.drafts')}>
      <h2 className="flex items-center gap-2 text-sm font-semibold text-hextech-text-bright"><Swords className="h-4 w-4 text-hextech-gold" />{t('sessionPrep.drafts')}</h2>
      {prep.drafts.length === 0 ? <p className="text-sm text-hextech-text-dim">{t('sessionPrep.noDraft')}</p> : (
        <ul className="space-y-2">{prep.drafts.map((d) => <DraftLine key={d.id} draft={d} onRemove={() => { void remove(d) }} />)}</ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild size="sm" variant="outline" className="gap-1.5">
          <Link to={`${draftSimPath()}&forSession=${encodeURIComponent(session.id)}&forName=${encodeURIComponent(event.title)}&back=${encodeURIComponent(event.id)}`}><Plus className="h-3.5 w-3.5" />{t('sessionPrep.createDraft')}</Link>
        </Button>
        {choices.length > 0 && (
          <Select value="" onValueChange={(v) => { void attach(v) }} disabled={busy}>
            <SelectTrigger className="h-8 w-60 text-xs" aria-label={t('sessionPrep.linkDraft')}><SelectValue placeholder={t('sessionPrep.linkDraft')} /></SelectTrigger>
            <SelectContent>
              {choices.map((c) => <SelectItem key={`${c.local ? 'l' : 's'}:${c.id}`} value={`${c.local ? 'l' : 's'}:${c.id}`}>{c.name}{c.local ? ` · ${t('sessionPrep.localDraft')}` : ''}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        {busy && <Loader2 className="h-4 w-4 animate-spin text-hextech-text-dim" />}
      </div>
    </section>
  )
}

function ChampIcon({ id }: { id: string }) {
  const url = useChampionIconUrl(id)
  return url ? <img src={url} alt={id} title={id} className="h-6 w-6 rounded" draggable={false} /> : <span className="h-6 w-6 rounded bg-hextech-elevated" />
}

function DraftLine({ draft, onRemove }: { draft: SessionDraft; onRemove?: () => void }) {
  const { t } = useTranslation()
  const first = (slots: string[][]) => slots.map((s) => s[0]).filter(Boolean)
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-md border border-hextech-border-dim bg-hextech-black/30 p-2">
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-hextech-text-bright">{draft.name}</span>
      <span className={cn('rounded px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase', draft.myTeamSide === 'blue' ? 'bg-sky-500/15 text-sky-300' : 'bg-red-500/15 text-red-300')}>
        {t(`sessionPrep.side.${draft.myTeamSide}`)}
      </span>
      <span className="flex gap-0.5">{first(draft.bluePicks).map((c, i) => <ChampIcon key={`b${i}`} id={c} />)}</span>
      <span className="text-hextech-text-dim">vs</span>
      <span className="flex gap-0.5">{first(draft.redPicks).map((c, i) => <ChampIcon key={`r${i}`} id={c} />)}</span>
      <Link to={draftSimPath()} className="text-xs text-hextech-gold hover:underline">{t('sessionPrep.openInDraftSim')}</Link>
      {onRemove && <button type="button" onClick={onRemove} aria-label={t('sessionPrep.removeDraft', { name: draft.name })} className="text-hextech-text-dim hover:text-hextech-red"><Trash2 className="h-3.5 w-3.5" /></button>}
    </li>
  )
}

function MessageBlock({ sessionId, value, onSaved }: { sessionId: string; value: string; onSaved: (text: string | null) => void }) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [text, setText] = useState(value)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => () => clearTimeout(timer.current), [])
  const change = (next: string) => {
    setText(next)
    clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      try { await window.api.sessionPrepSetMessage(sessionId, next.trim() || null); onSaved(next.trim() || null) } catch (err) { toast({ title: t(prepErrorKey(err)), variant: 'destructive' }) }
    }, 800)
  }
  return (
    <section className={panel} aria-label={t('sessionPrep.message')}>
      <h2 className="flex items-center gap-2 text-sm font-semibold text-hextech-text-bright"><MessageSquare className="h-4 w-4 text-hextech-gold" />{t('sessionPrep.message')}</h2>
      <Textarea value={text} maxLength={MESSAGE_MAX} rows={2} onChange={(e) => change(e.target.value)} placeholder={t('sessionPrep.messagePlaceholder')} aria-label={t('sessionPrep.message')} />
      <p className="text-right font-mono text-[10px] text-hextech-text-dim">{text.length} / {MESSAGE_MAX}</p>
    </section>
  )
}

/* ─── Player (and the staff's preview) ─── */

function PlayerPrep({ prep, event, myUserId, nameOf, objectiveLabel, previewing }: {
  prep: SessionPrep
  event: CalendarEvent
  myUserId: string
  nameOf: NameOf
  objectiveLabel: (id: string) => string
  previewing: boolean
}) {
  const { t, i18n } = useTranslation()
  const { toast } = useToast()
  const [answer, setAnswer] = useState(event.responses?.find((r) => r.userId === myUserId)?.status ?? null)
  const [othersOpen, setOthersOpen] = useState(false)
  // In the staff's preview, « Ton objectif » is the first player's.
  const mineId = previewing ? prep.playerObjectives[0]?.playerId ?? null : myUserId
  const mine = prep.playerObjectives.find((p) => p.playerId === mineId) ?? null
  const others = prep.playerObjectives.filter((p) => p.playerId !== mineId)
  const team = prep.objectives?.objectiveIds ?? []
  const mins = Math.round((new Date(event.startsAt).getTime() - Date.now()) / 60_000)
  const rtf = new Intl.RelativeTimeFormat(i18n.language, { numeric: 'auto' })
  const inLabel = mins <= 0 ? null : mins < 60 ? rtf.format(mins, 'minute') : mins < 48 * 60 ? rtf.format(Math.round(mins / 60), 'hour') : rtf.format(Math.round(mins / 1440), 'day')

  const respond = async (status: 'confirmed' | 'declined') => {
    if (previewing) return
    setAnswer(status)
    try { await window.api.calendarRespond(event.id, status) } catch { toast({ title: t('sessionPrep.errors.generic'), variant: 'destructive' }) }
  }

  return (
    <div className="space-y-3" aria-label={t('sessionPrep.playerView')}>
      {previewing && <p className="text-xs text-hextech-gold">{t('sessionPrep.previewNote')}</p>}
      <div className={panel}>
        <p className="text-xs text-hextech-text-dim">
          {new Date(event.startsAt).toLocaleString(i18n.language, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}
          {inLabel && ` · ${inLabel}`}
        </p>
        {prep.message && (
          <blockquote className="border-l-2 border-hextech-gold pl-3 text-sm text-hextech-text-bright">
            {prep.message.text}
            {prep.message.setBy && <span className="mt-0.5 block text-xs text-hextech-text-dim">— {nameOf(prep.message.setBy)}</span>}
          </blockquote>
        )}
        {mine && (
          <div className="rounded-md border border-hextech-gold/50 bg-hextech-gold/10 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-hextech-gold">{t('sessionPrep.yourObjective')}</p>
            <p className="mt-0.5 text-sm font-semibold text-hextech-text-bright">{mine.objectiveIds.map(objectiveLabel).join(' · ')}</p>
            {mine.note && <p className="mt-0.5 text-sm text-hextech-text">{mine.note}</p>}
          </div>
        )}
        {team.length > 0 && (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-hextech-text-dim">{t('sessionPrep.team')}</p>
            <ul className="mt-1 flex flex-wrap gap-1.5">{team.map((id) => <li key={id} className="rounded bg-hextech-elevated px-2 py-0.5 text-xs text-hextech-text-bright">{objectiveLabel(id)}</li>)}</ul>
          </div>
        )}
        {others.length > 0 && (
          <div>
            <button type="button" onClick={() => setOthersOpen((v) => !v)} aria-expanded={othersOpen} className="inline-flex items-center gap-1 text-xs text-hextech-text-dim hover:text-hextech-text-bright">
              <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', othersOpen && 'rotate-180')} /><Users className="h-3.5 w-3.5" />{t('sessionPrep.others', { count: others.length })}
            </button>
            {othersOpen && (
              <ul className="mt-1 space-y-0.5 text-xs text-hextech-text">
                {others.map((p) => <li key={p.playerId}><span className="font-semibold">{nameOf(p.playerId)}</span> : {p.objectiveIds.map(objectiveLabel).join(' · ')}{p.note ? ` — ${p.note}` : ''}</li>)}
              </ul>
            )}
          </div>
        )}
        {prep.drafts.length > 0 && <ul className="space-y-2">{prep.drafts.map((d) => <DraftLine key={d.id} draft={d} />)}</ul>}
        {!mine && team.length === 0 && !prep.message && prep.drafts.length === 0 && <p className="text-sm text-hextech-text-dim">{t('sessionPrep.nothingYet')}</p>}
        <div className="flex gap-2">
          <Button size="sm" variant={answer === 'confirmed' ? 'default' : 'outline'} className="h-7 gap-1 text-xs" onClick={() => { void respond('confirmed') }}><Check className="h-3 w-3" />{t('planning.match.iWillBeThere')}</Button>
          <Button size="sm" variant={answer === 'declined' ? 'default' : 'outline'} className="h-7 gap-1 text-xs" onClick={() => { void respond('declined') }}><X className="h-3 w-3" />{t('planning.match.iCannot')}</Button>
        </div>
      </div>
    </div>
  )
}
