import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertCircle, ChevronRight, Flag, Loader2, Lock, MessageSquare, Plus, Search, Trash2, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/useToast'
import { useLocalizedFundamentals } from '@/lib/constants/useFundamentals'
import { cn } from '@/lib/utils'
import { championLabel } from '@/lib/statsInsights'
import { CommentThread } from '@/components/Coaching/CommentThread'
import { DevPlanCard } from '@/components/Coaching/DevPlanCard'
import { PlayerMicroReviewsCard } from '@/components/MicroReview/CoachMicroReviews'
import { collabErrorKey, type AssignedObjective, type Group, type PlayerSessionView } from '@/lib/collab'
import type { DevPlan } from '@/lib/devPlan'
import type { StaffNote } from '@/lib/teamOps'
import type { NameOf } from '@/hooks/useCollab'
import {
  NOTE_TAGS, composeNote, groupByDay, mainRole, parseNote, playerStatus, reviewStats, topChampions,
  type NoteTag, type SessionDay,
} from '@/lib/playerDossier'

interface Props {
  staffGroups: Group[]
  myUserId: string
  nameOf: NameOf
}

interface PlayerRef { userId: string; groupId: string; name: string; group: string }

const panel = 'panel-surface rounded-xl border border-hextech-border-dim p-5'
const kicker = 'font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-hextech-gold'

/** Coach / analyst view of one player: dossier, plan, session journal,
 *  assigned goals and private staff notes (redesign 17/11/2026). */
export function PlayersSection({ staffGroups, myUserId, nameOf }: Props) {
  const { t } = useTranslation()
  const players = useMemo<PlayerRef[]>(() => {
    const seen = new Map<string, PlayerRef>()
    for (const g of staffGroups) {
      for (const m of g.members) {
        if (m.role === 'player' && m.userId !== myUserId && !seen.has(m.userId)) {
          seen.set(m.userId, { userId: m.userId, groupId: g.id, name: m.displayName || m.riotId || '—', group: g.name })
        }
      }
    }
    return [...seen.values()]
  }, [staffGroups, myUserId])
  const [selected, setSelected] = useState<string>('')

  useEffect(() => {
    if (!selected && players[0]) setSelected(players[0].userId)
  }, [players, selected])

  const player = players.find((p) => p.userId === selected)

  if (players.length === 0) {
    return <div className={cn(panel, 'text-sm text-hextech-text-dim')}>{t('coaching.players.none')}</div>
  }

  const picker = (
    <div className="w-full sm:w-80">
      <span className={cn(kicker, 'mb-1 block text-hextech-text')}>{t('coaching.dossier.pickPlayer')}</span>
      <Select value={selected} onValueChange={setSelected}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          {players.map((p) => <SelectItem key={p.userId} value={p.userId}>{p.name} · {p.group}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  )

  return player ? <PlayerView key={player.userId} player={player} picker={picker} myUserId={myUserId} nameOf={nameOf} /> : null
}

function PlayerView({ player, picker, myUserId, nameOf }: { player: PlayerRef; picker: React.ReactNode; myUserId: string; nameOf: NameOf }) {
  const { t, i18n } = useTranslation()
  const { toast } = useToast()
  const fundamentals = useLocalizedFundamentals()
  const allObjectives = useMemo(() => fundamentals.flatMap((c) => c.fundamentals.map((f) => ({ id: f.id, label: f.label }))), [fundamentals])
  const label = useCallback((id: string) => allObjectives.find((o) => o.id === id)?.label ?? id, [allObjectives])

  const [sessions, setSessions] = useState<PlayerSessionView[] | null>(null)
  const [assignments, setAssignments] = useState<AssignedObjective[]>([])
  const [plan, setPlan] = useState<DevPlan | null>(null)

  const load = useCallback(async () => {
    try {
      const [s, a, p] = await Promise.all([
        window.api.collabPlayerSessions(player.userId),
        window.api.collabListAssignments(player.userId, true),
        window.api.devPlanGetForPlayer(player.groupId, player.userId).catch(() => null),
      ])
      setSessions(s)
      setAssignments(a)
      setPlan(p)
    } catch (err) {
      setSessions([])
      toast({ title: t(collabErrorKey(err)), variant: 'destructive' })
    }
  }, [player.userId, player.groupId, t, toast])

  useEffect(() => { load() }, [load])

  const list = useMemo(() => sessions ?? [], [sessions])
  const stats = reviewStats(list)
  const days = useMemo(() => groupByDay(list), [list])
  const status = playerStatus(days, stats)
  const role = mainRole(list)
  const champs = topChampions(list)
  const open = assignments.filter((a) => a.status === 'open')
  const done = assignments.filter((a) => a.status === 'done')
  const nextDue = open.map((a) => a.dueDate).filter(Boolean).sort()[0]
  const fmt = (v: string | number | null | undefined) => (v ? new Date(typeof v === 'number' ? v : Date.parse(v)).toLocaleDateString(i18n.language) : '—')

  return (
    <div className="space-y-5">
      {/* Dossier header + summary */}
      <section className={panel}>
        <div className="flex flex-col gap-4 border-b border-hextech-border-dim pb-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3.5">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md border border-hextech-gold bg-hextech-gold/15 font-condensed text-xl font-extrabold text-hextech-gold-bright">
              {(role ?? '?').slice(0, 3)}
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className={kicker}>{t('coaching.dossier.kicker', { role: role ?? '—' })}</span>
                <span className={cn('rounded border px-2 py-0.5 font-mono text-[10px] font-bold',
                  status.tone === 'warn' ? 'border-hextech-red/50 bg-hextech-red/15 text-hextech-red'
                    : status.tone === 'good' ? 'border-hextech-green/50 bg-hextech-green/15 text-hextech-green'
                      : 'border-hextech-border-dim text-hextech-text')}>
                  {t(`coaching.dossier.status.${status.key}`, { date: fmt(status.date), games: status.games, pct: status.pct })}
                </span>
              </div>
              <h2 className="mt-1 font-condensed text-3xl font-extrabold uppercase leading-none text-hextech-text-bright">
                {player.name} <span className="font-mono text-sm font-normal normal-case text-hextech-text-dim">· {player.group}</span>
              </h2>
              <p className="mt-1 text-xs text-hextech-text">{t('coaching.players.desc')}</p>
            </div>
          </div>
          {picker}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tile title={t('coaching.dossier.tile.discipline')}>
            <div className="flex items-baseline justify-between">
              <span className="font-condensed text-3xl font-extrabold text-hextech-text-bright">{stats.pct}%</span>
              <span className="font-mono text-[11px] text-hextech-green">{t('coaching.dossier.reviewedOf', { reviewed: stats.reviewed, games: stats.games })}</span>
            </div>
            <div className="mt-1.5 h-1.5 bg-hextech-elevated"><div className="h-full bg-hextech-green" style={{ width: `${stats.pct}%` }} /></div>
          </Tile>
          <Tile title={t('coaching.dossier.tile.axes')}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-condensed text-3xl font-extrabold text-hextech-gold">{t('coaching.dossier.axesCount', { count: plan?.axes.length ?? 0 })}</span>
              {plan?.periodStart && <span className="font-mono text-[10px] text-hextech-text-dim">{fmt(plan.periodStart)} → {fmt(plan.periodEnd)}</span>}
            </div>
            <p className="mt-1 truncate text-[11px] text-hextech-text">{plan?.title ?? t('coaching.dossier.noPlan')}</p>
          </Tile>
          <Tile title={t('coaching.dossier.tile.goals')}>
            <div className="flex items-baseline justify-between">
              <span className="font-condensed text-3xl font-extrabold text-hextech-text-bright">{t('coaching.dossier.openGoals', { count: open.length })}</span>
              <span className="font-mono text-[10px] text-hextech-green">{t('coaching.dossier.doneGoals', { count: done.length })}</span>
            </div>
            <p className="mt-1 truncate text-[11px] text-hextech-text-dim">{nextDue ? t('coaching.dossier.nextDue', { date: fmt(nextDue) }) : t('coaching.dossier.noDue')}</p>
          </Tile>
          <Tile title={t('coaching.dossier.tile.pool')}>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {champs.length ? champs.map((c) => (
                <span key={c} className="rounded border border-hextech-border-dim bg-hextech-elevated px-2 py-0.5 font-mono text-[11px] font-bold text-hextech-text-bright">{championLabel(c)}</span>
              )) : <span className="text-[11px] text-hextech-text-dim">—</span>}
            </div>
            <p className="mt-1.5 font-mono text-[10px] text-hextech-text-dim">{t('coaching.dossier.fromShared')}</p>
          </Tile>
        </div>
      </section>

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-12">
        <div className="space-y-5 xl:col-span-7">
          <DevPlanCard groupId={player.groupId} playerId={player.userId} mode="staff" />
          <PlayerMicroReviewsCard playerId={player.userId} groupId={player.groupId} />
          {sessions === null ? (
            <div className={panel}><Loader2 className="h-5 w-5 animate-spin text-hextech-text-dim" /></div>
          ) : (
            <SessionJournal days={days} label={label} player={player} myUserId={myUserId} nameOf={nameOf} />
          )}
        </div>
        <aside className="space-y-5 xl:col-span-5">
          <AssignCard player={player} assignments={assignments} objectives={allObjectives} label={label} onChanged={load} />
          <StaffNotesCard groupId={player.groupId} playerId={player.userId} playerName={player.name} nameOf={nameOf} />
        </aside>
      </div>
    </div>
  )
}

function Tile({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-hextech-border-dim bg-hextech-black/40 p-3">
      <span className="font-mono text-[10px] uppercase tracking-wide text-hextech-text">{title}</span>
      <div className="mt-1">{children}</div>
    </div>
  )
}

/* ─── Session journal ─── */

type DayFilter = 'all' | 'incomplete' | 'complete'

function SessionJournal({ days, label, player, myUserId, nameOf }: {
  days: SessionDay[]
  label: (id: string) => string
  player: PlayerRef
  myUserId: string
  nameOf: NameOf
}) {
  const { t, i18n } = useTranslation()
  const [filter, setFilter] = useState<DayFilter>('all')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<string | null>(days[0]?.key ?? null)

  const shown = days.filter((d) => {
    if (filter === 'incomplete' && d.status === 'complete') return false
    if (filter === 'complete' && d.status !== 'complete') return false
    const q = query.trim().toLowerCase()
    if (!q) return true
    const date = new Date(d.date).toLocaleDateString(i18n.language).toLowerCase()
    return date.includes(q) || d.objectiveIds.some((id) => label(id).toLowerCase().includes(q))
  })

  return (
    <section className={cn(panel, 'space-y-4')}>
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-hextech-border-dim pb-3">
        <div>
          <span className={kicker}>{t('coaching.journal.kicker')}</span>
          <h3 className="mt-0.5 font-condensed text-2xl font-extrabold uppercase text-hextech-text-bright">{t('coaching.journal.title', { count: shown.length })}</h3>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-md border border-hextech-border-dim p-0.5" role="group">
            {(['all', 'incomplete', 'complete'] as DayFilter[]).map((f) => (
              <button key={f} onClick={() => setFilter(f)} aria-pressed={filter === f}
                className={cn('rounded px-2.5 py-1 font-mono text-[10px] font-bold uppercase', filter === f ? 'bg-hextech-gold text-hextech-black' : 'text-hextech-text-bright hover:bg-hextech-elevated')}>
                {t(`coaching.journal.filter.${f}`)}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-hextech-text-dim" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('coaching.journal.search')} className="h-8 w-40 pl-7 text-xs" />
          </div>
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="py-6 text-center text-sm text-hextech-text-dim">{days.length ? t('coaching.journal.noMatch') : t('coaching.players.noData')}</p>
      ) : (
        <ul className="space-y-2">
          {shown.map((day) => {
            const isOpen = open === day.key
            const ratio = day.games ? Math.min(100, Math.round((day.reviews / day.games) * 100)) : 100
            const color = day.status === 'alert' ? 'var(--hextech-red)' : day.status === 'complete' ? 'var(--hextech-green)' : '#F59E0B'
            return (
              <li key={day.key} className={cn('overflow-hidden rounded-lg border transition-colors',
                day.status === 'alert' ? 'border-hextech-red/50 bg-hextech-red/[0.06]' : isOpen ? 'border-hextech-gold bg-hextech-elevated/40' : 'border-hextech-border-dim hover:border-hextech-border')}>
                <button className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left" onClick={() => setOpen(isOpen ? null : day.key)} aria-expanded={isOpen}>
                  <ChevronRight className={cn('h-4 w-4 shrink-0 text-hextech-gold transition-transform', isOpen && 'rotate-90')} />
                  <span className="shrink-0 font-mono text-xs font-bold text-hextech-text-bright">{new Date(day.date).toLocaleDateString(i18n.language)}</span>
                  <span className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                    {day.objectiveIds.length ? day.objectiveIds.map((id) => (
                      <span key={id} className="rounded border border-hextech-border-dim bg-hextech-elevated px-2 py-0.5 text-[11px] text-hextech-text-bright">{label(id)}</span>
                    )) : (
                      <span className="inline-flex items-center gap-1 rounded border border-hextech-red/40 bg-hextech-red/15 px-2 py-0.5 font-mono text-[10px] font-bold text-hextech-red">
                        <AlertCircle className="h-3 w-3" />{t('coaching.journal.autopilot')}
                      </span>
                    )}
                  </span>
                  <span className="hidden h-1.5 w-24 bg-hextech-black sm:block"><span className="block h-full" style={{ width: `${ratio}%`, backgroundColor: color }} /></span>
                  <span className="min-w-[140px] rounded border px-2 py-0.5 text-right font-mono text-[11px] font-bold" style={{ color, borderColor: `color-mix(in srgb, ${color} 45%, transparent)` }}>
                    {t('coaching.journal.counts', { games: day.games, reviews: day.reviews })}
                  </span>
                </button>
                {isOpen && (
                  <div className="space-y-3 border-t border-hextech-border-dim bg-hextech-black/40 p-4">
                    {day.sessions.map((s) => s.sessionConclusion && <p key={s.id} className="text-sm italic text-hextech-text">« {s.sessionConclusion} »</p>)}
                    {day.sessions.flatMap((s) => s.games).map((g) => (
                      <div key={g.id} className="space-y-2 rounded-md border border-hextech-border-dim/70 bg-hextech-dark p-3">
                        <div className="flex flex-wrap items-center gap-2.5 text-xs">
                          <span className={cn('rounded px-1.5 py-0.5 font-mono text-[10px] font-bold', g.win ? 'bg-hextech-green/20 text-hextech-green' : 'bg-hextech-red/20 text-hextech-red')}>
                            {g.win ? t('coaching.journal.w') : t('coaching.journal.l')}
                          </span>
                          <span className="font-bold text-hextech-text-bright">{championLabel(g.champion)}</span>
                          <span className="font-mono text-hextech-gold">{g.kills}/{g.deaths}/{g.assists}</span>
                          {g.role && <span className="font-mono text-[10px] text-hextech-text-dim">{g.role}</span>}
                          {!g.review && <span className="ml-auto font-mono text-[10px] text-amber-300">{t('coaching.players.noReview')}</span>}
                        </div>
                        {g.review && (
                          <>
                            {g.review.freeText && <p className="whitespace-pre-wrap text-sm text-hextech-text">{g.review.freeText}</p>}
                            {g.review.timelineNotes.length > 0 && (
                              <ul className="space-y-0.5 text-xs text-hextech-text">
                                {g.review.timelineNotes.map((n, i) => <li key={i}><span className="font-mono text-hextech-gold">{n.time}</span> {n.note}</li>)}
                              </ul>
                            )}
                            {Object.keys(g.review.kpiScores).length > 0 && (
                              <div className="flex flex-wrap gap-1 text-xs">
                                {Object.entries(g.review.kpiScores).map(([k, v]) => <span key={k} className="rounded bg-hextech-elevated px-1.5 py-0.5 text-hextech-text">{k}: {v}/10</span>)}
                              </div>
                            )}
                            <CommentThread reviewId={g.review.id} playerId={player.userId} groupId={player.groupId} gameId={g.id} myUserId={myUserId} authorName={nameOf} />
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

/* ─── Assign a goal ─── */

function AssignCard({ player, assignments, objectives, label, onChanged }: {
  player: PlayerRef
  assignments: AssignedObjective[]
  objectives: Array<{ id: string; label: string }>
  label: (id: string) => string
  onChanged: () => void
}) {
  const { t, i18n } = useTranslation()
  const { toast } = useToast()
  const [objective, setObjective] = useState('')
  const [note, setNote] = useState('')
  const [due, setDue] = useState('')
  const [busy, setBusy] = useState(false)
  const presets = t('coaching.assign.presets', { returnObjects: true }) as string[]

  const assign = async () => {
    if (!objective) return
    setBusy(true)
    try {
      await window.api.collabAssignObjective({ groupId: player.groupId, playerId: player.userId, objectiveIds: [objective], note: note.trim() || null, dueDate: due || null })
      setObjective(''); setNote(''); setDue('')
      toast({ title: t('coaching.assign.sent'), variant: 'gold' })
      onChanged()
    } catch (err) {
      toast({ title: t(collabErrorKey(err)), variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  const toggle = async (a: AssignedObjective) => {
    try {
      await window.api.collabSetAssignmentStatus(a.id, a.status === 'done' ? 'open' : 'done')
      onChanged()
    } catch (err) {
      toast({ title: t(collabErrorKey(err)), variant: 'destructive' })
    }
  }

  const visible = assignments.filter((a) => a.status !== 'dismissed')

  return (
    <section className={cn(panel, 'space-y-4')}>
      <div className="border-b border-hextech-border-dim pb-3">
        <span className={kicker}>{t('coaching.assign.kicker')}</span>
        <h3 className="mt-0.5 flex items-center gap-2 font-condensed text-2xl font-extrabold uppercase text-hextech-text-bright">
          <Flag className="h-4 w-4 text-hextech-gold" />{t('coaching.assign.titleFor', { name: player.name })}
        </h3>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <span className="mb-1 block font-mono text-[10px] uppercase text-hextech-text">{t('coaching.assign.pick')}</span>
          <Select value={objective} onValueChange={setObjective}>
            <SelectTrigger><SelectValue placeholder={t('coaching.assign.pick')} /></SelectTrigger>
            <SelectContent>{objectives.map((o) => <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <span className="mb-1 block font-mono text-[10px] uppercase text-hextech-text">{t('coaching.assign.due')}</span>
          <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label={t('coaching.assign.due')} />
        </div>
      </div>
      <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={1000} placeholder={t('coaching.assign.notePlaceholder')} />
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-[9px] uppercase text-hextech-text-dim">{t('coaching.assign.presetsLabel')}</span>
        {Array.isArray(presets) && presets.map((p) => (
          <button key={p} type="button" onClick={() => setNote(p)} className="rounded border border-hextech-border-dim px-2 py-0.5 text-[10px] text-hextech-text hover:border-hextech-gold hover:text-hextech-text-bright">+ {p}</button>
        ))}
      </div>
      <Button className="w-full gap-2 font-condensed text-base font-extrabold uppercase tracking-wide" onClick={assign} disabled={!objective || busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Flag className="h-4 w-4" />}{t('coaching.assign.send')}
      </Button>

      {visible.length > 0 && (
        <div className="space-y-2 border-t border-hextech-border-dim pt-3">
          <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-hextech-text-dim">{t('coaching.assign.listTitle', { count: visible.length })}</div>
          {visible.map((a) => {
            const isDone = a.status === 'done'
            return (
              <button key={a.id} onClick={() => toggle(a)} title={t('coaching.assign.toggleHint')}
                className={cn('flex w-full items-start justify-between gap-3 rounded-md border p-3 text-left transition-colors',
                  isDone ? 'border-hextech-green/35 bg-hextech-green/10 opacity-80' : 'border-hextech-border-dim hover:border-hextech-gold')}>
                <span className="min-w-0 space-y-1">
                  <span className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
                    <span className="font-bold text-hextech-gold">{a.objectiveIds.map(label).join(', ')}</span>
                    {a.dueDate && <span className="text-hextech-text-dim">• {t('coaching.assign.dueOn', { date: new Date(a.dueDate).toLocaleDateString(i18n.language) })}</span>}
                  </span>
                  {a.note && <span className={cn('block text-xs text-hextech-text-bright', isDone && 'text-hextech-text-dim line-through')}>{a.note}</span>}
                </span>
                <span className={cn('shrink-0 rounded border px-2 py-0.5 font-mono text-[9px] font-bold uppercase',
                  isDone ? 'border-hextech-green bg-hextech-green/20 text-hextech-green' : 'border-hextech-border-dim text-hextech-text')}>
                  {isDone ? <span className="flex items-center gap-1">{t('coaching.assign.status.done')}<Check className="h-3 w-3" /></span> : t('coaching.assign.status.open')}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </section>
  )
}

/* ─── Private staff notes ─── */

/** Staff-private notes (RLS-enforced: the player this is about can never read these). */
function StaffNotesCard({ groupId, playerId, playerName, nameOf }: { groupId: string; playerId: string; playerName: string; nameOf: NameOf }) {
  const { t, i18n } = useTranslation()
  const { toast } = useToast()
  const [notes, setNotes] = useState<StaffNote[] | null>(null)
  const [body, setBody] = useState('')
  const [tag, setTag] = useState<NoteTag>('followup')
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    try { setNotes(await window.api.staffNotesList(groupId, playerId)) }
    catch (err) { setNotes([]); toast({ title: t(collabErrorKey(err)), variant: 'destructive' }) }
  }, [groupId, playerId, t, toast])

  useEffect(() => { load() }, [load])

  const add = async () => {
    if (!body.trim()) return
    setAdding(true)
    try { await window.api.staffNotesAdd(groupId, playerId, composeNote(tag, body.trim())); setBody(''); await load() }
    catch (err) { toast({ title: t(collabErrorKey(err)), variant: 'destructive' }) }
    finally { setAdding(false) }
  }
  const remove = async (id: string) => {
    try { await window.api.staffNotesDelete(id); await load() }
    catch (err) { toast({ title: t(collabErrorKey(err)), variant: 'destructive' }) }
  }

  return (
    <section className={cn(panel, 'space-y-4')}>
      <div className="border-b border-hextech-border-dim pb-3">
        <span className={cn(kicker, 'text-hextech-red')}>{t('coaching.staffNotes.kicker')}</span>
        <h3 className="mt-0.5 flex items-center gap-2 font-condensed text-2xl font-extrabold uppercase text-hextech-text-bright">
          <Lock className="h-4 w-4 text-hextech-red" />{t('coaching.staffNotes.title', { defaultValue: 'Private staff notes' })}
        </h3>
        <p className="text-[11px] text-hextech-text-dim">{t('coaching.staffNotes.hint', { defaultValue: 'Only visible to this group\'s staff — the player never sees these.' })}</p>
      </div>

      {notes === null ? (
        <Loader2 className="h-4 w-4 animate-spin text-hextech-text-dim" />
      ) : notes.length === 0 ? (
        <p className="text-xs text-hextech-text-dim">{t('coaching.staffNotes.empty', { name: playerName })}</p>
      ) : (
        <ul className="space-y-2.5">
          {notes.map((n) => {
            const { tag: nTag, text } = parseNote(n.body)
            return (
              <li key={n.id} className="group space-y-1.5 rounded-md border border-hextech-border-dim bg-hextech-black/40 p-3">
                <div className="flex items-center justify-between gap-2 font-mono text-[10px]">
                  <span className="font-bold text-hextech-gold-bright">{nameOf(n.createdBy)}</span>
                  <span className="flex items-center gap-2">
                    {nTag && <span className="rounded border border-hextech-red/40 bg-hextech-red/15 px-1.5 text-[9px] font-bold uppercase text-hextech-red">{t(`coaching.staffNotes.tag.${nTag}`)}</span>}
                    <span className="text-hextech-text-dim">{new Date(n.createdAt).toLocaleString(i18n.language, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                    <button onClick={() => remove(n.id)} aria-label={t('common.delete', { defaultValue: 'Delete' })} className="text-hextech-text-dim opacity-0 transition-opacity hover:text-hextech-red group-hover:opacity-100 focus:opacity-100">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </span>
                </div>
                <p className="whitespace-pre-wrap text-xs leading-relaxed text-hextech-text-bright">{text}</p>
              </li>
            )
          })}
        </ul>
      )}

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-mono text-[10px] uppercase text-hextech-text">{t('coaching.staffNotes.tagLabel')}</span>
          <div className="flex flex-wrap gap-1">
            {NOTE_TAGS.map((x) => (
              <button key={x} type="button" onClick={() => setTag(x)} aria-pressed={tag === x}
                className={cn('rounded border px-2 py-0.5 font-mono text-[9px] font-bold uppercase', tag === x ? 'border-hextech-gold bg-hextech-gold text-hextech-black' : 'border-hextech-border-dim text-hextech-text')}>
                {t(`coaching.staffNotes.tag.${x}`)}
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-2">
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2} maxLength={4000} className="flex-1" placeholder={t('coaching.staffNotes.placeholder', { defaultValue: 'Private note…' })} />
          <Button size="sm" onClick={add} disabled={!body.trim() || adding} className="self-end gap-1">
            {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}{t('coaching.staffNotes.add')}
          </Button>
        </div>
        <p className="flex items-center gap-1 text-[10px] text-hextech-text-dim"><MessageSquare className="h-3 w-3" />{t('coaching.staffNotes.commentHint')}</p>
      </div>
    </section>
  )
}
