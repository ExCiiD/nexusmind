import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Loader2, CalendarClock, Target, Play, Square, Plus, X, ArrowLeft, ClipboardCheck, Mic } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/useToast'
import { useCollab } from '@/hooks/useCollab'
import { collabErrorKey } from '@/lib/collab'
import { canManageSession } from '@/lib/permissions'
import { FundamentalPickerDialog } from '@/components/Session/FundamentalPickerDialog'
import { mergedFundamentalCategories, getAllFundamentalsForGroup } from '@/lib/fundamentals'
import { useLocalizedFundamentals } from '@/lib/constants/useFundamentals'
import { countdownState } from '@/lib/teamSessionsCore'
import { gamesNeedingReviewPrompt } from '@/lib/teamSessionReviewsCore'
import { TeamSessionGameCard } from '@/components/TeamSession/TeamSessionGameCard'
import { PostGameReviewPrompt } from '@/components/TeamSession/PostGameReviewPrompt'
import { SessionReviewPanel } from '@/components/TeamSession/SessionReviewPanel'
import { MeetingReviewPanel } from '@/components/TeamSession/MeetingReviewPanel'
import { MeetingSetupCard } from '@/components/TeamSession/MeetingSetupCard'
import type { CalendarEvent } from '@/lib/calendar'
import type { GroupFundamental, SessionQueueFilter, TeamSession, TeamSessionGame, TeamSessionObjectives } from '@/lib/teamSessions'
import type { TeamSessionReview } from '@/lib/teamSessionReviews'
import { cn } from '@/lib/utils'
import type { NameOf } from '@/hooks/useCollab'

// 'ranked5' removed (L14, user decision 19/11/2026): never wired, it acted as 'flex'.
const QUEUE_FILTERS: SessionQueueFilter[] = ['flex', 'scrim', 'all']
/** While the session isn't ended, mirrors the fast-poll cadence used by
 *  electron/main/sync/syncService.ts so every concerned device reflects a
 *  start/end/objectives change without a manual refresh. */
const FAST_POLL_MS = 15_000 // was 7.5 s: four such loops overloaded the Supabase disk I/O budget (18/11/2026)

/** Team sessions (Phase 3, Planning rework — docs/PLAN_GESTION_EQUIPE.md
 *  §9): opened from a Planning calendar event (scrim/flex/tournament/
 *  meeting kind, which auto-creates a `team_sessions` row). Lets a
 *  responsible (coach/manager/captain) pick objectives and start/end the
 *  session; per-game stats and recording land in Phases 4-5. */
export function TeamSessionPage() {
  const { calendarEventId } = useParams<{ calendarEventId: string }>()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { toast } = useToast()
  const { myUserId, groups, nameOf, loading: collabLoading } = useCollab()

  const [event, setEvent] = useState<CalendarEvent | null | undefined>(undefined)
  const [session, setSession] = useState<TeamSession | null | undefined>(undefined)
  const [objectives, setObjectives] = useState<TeamSessionObjectives | null>(null)
  const [fundamentals, setFundamentals] = useState<GroupFundamental[]>([])
  const [games, setGames] = useState<TeamSessionGame[]>([])
  const [reviews, setReviews] = useState<TeamSessionReview[]>([])
  const [now, setNow] = useState(() => new Date())
  // End-of-game flow (EndOfGamePrompt / final-review reminder): ?review=<gameId>
  // opens that game's review, ?final=1 the final-review view, ?start=1 starts
  // recording on its own (the coach already confirmed in the dialog).
  const [params] = useSearchParams()
  const focusGameId = params.get('review')
  const finalMode = params.get('final') === '1'
  const autoStart = params.get('start') === '1'
  const [focusGameDone, setFocusGameDone] = useState(false)
  const [recordGameId, setRecordGameId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!calendarEventId) return
    try {
      const [ev, sess] = await Promise.all([
        window.api.calendarGetEvent(calendarEventId),
        window.api.teamSessionGetByEvent(calendarEventId),
      ])
      setEvent(ev)
      setSession(sess)
      if (sess) {
        const [obj, funds, gms, revs] = await Promise.all([
          window.api.teamSessionGetObjectives(sess.id),
          window.api.groupFundamentalsList(sess.groupId),
          window.api.teamSessionListGames(sess.id),
          window.api.teamSessionReviewsListForSession(sess.id),
        ])
        setObjectives(obj)
        setFundamentals(funds)
        setGames(gms)
        setReviews(revs)
      }
    } catch (err) {
      toast({ title: t(collabErrorKey(err)), variant: 'destructive' })
    }
  }, [calendarEventId, t, toast])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!session || session.status === 'ended') return
    const id = setInterval(load, FAST_POLL_MS)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only restart the interval on a status change, not on every poll's new session object
  }, [session?.status, load])

  // The 1 s clock only drives the countdown of a scheduled session: no need to
  // re-render this page every second once it is live or ended.
  const isScheduled = session?.status === 'scheduled'
  useEffect(() => {
    if (!isScheduled) return
    const id = setInterval(() => setNow(new Date()), 1_000)
    return () => clearInterval(id)
  }, [isScheduled])

  const group = useMemo(() => groups.find((g) => g.id === session?.groupId), [groups, session])
  const myMember = group?.members.find((m) => m.userId === myUserId)
  const canManage = !!group && canManageSession(group.myRole, myMember?.isCaptain ?? false)

  const baseCategories = useLocalizedFundamentals()
  const categories = useMemo(() => mergedFundamentalCategories(fundamentals, baseCategories), [fundamentals, baseCategories])
  const allFundamentals = useMemo(() => getAllFundamentalsForGroup(fundamentals, baseCategories), [fundamentals, baseCategories])

  const [selectedObjectives, setSelectedObjectives] = useState<string[]>([])
  const [selectedKpiIds, setSelectedKpiIds] = useState<string[]>([])
  const [queueFilter, setQueueFilter] = useState<SessionQueueFilter>('all')
  const [responsibleIds, setResponsibleIds] = useState<string[]>([])
  const [starting, setStarting] = useState(false)
  const [ending, setEnding] = useState(false)
  const [savingObjectives, setSavingObjectives] = useState(false)
  const [addFundamentalOpen, setAddFundamentalOpen] = useState(false)
  const [newFundamentalLabel, setNewFundamentalLabel] = useState('')
  const [newFundamentalDesc, setNewFundamentalDesc] = useState('')
  const [addingFundamental, setAddingFundamental] = useState(false)

  useEffect(() => {
    if (objectives) {
      setSelectedObjectives(objectives.objectiveIds)
      setSelectedKpiIds(objectives.kpiIds)
    }
  }, [objectives])

  useEffect(() => {
    if (session?.queueFilter) setQueueFilter(session.queueFilter)
  }, [session?.queueFilter])

  // Eligible responsibles: coach/manager/owner or a flagged captain — same
  // rule the RLS `can_manage_session` helper enforces server-side.
  const eligibleResponsibles = useMemo(
    () => group?.members.filter((m) => canManageSession(m.role, m.isCaptain)) ?? [],
    [group],
  )
  useEffect(() => {
    if (myUserId && responsibleIds.length === 0 && eligibleResponsibles.some((m) => m.userId === myUserId)) {
      setResponsibleIds([myUserId])
    }
  }, [myUserId, eligibleResponsibles, responsibleIds.length])

  const gamesNeedingPrompt = useMemo(
    () => gamesNeedingReviewPrompt(games, reviews).filter((g) => g.id !== focusGameId),
    [games, reviews, focusGameId],
  )
  const focusGame = focusGameId ? games.find((g) => g.id === focusGameId) ?? null : null

  const kpiGroups = useMemo(
    () => selectedObjectives
      .map((id) => allFundamentals.find((f) => f.id === id))
      .filter((f): f is NonNullable<typeof f> => !!f && f.kpis.length > 0),
    [selectedObjectives, allFundamentals],
  )

  const addObjective = (id: string) => {
    if (!id || selectedObjectives.includes(id) || selectedObjectives.length >= 3) return
    setSelectedObjectives((prev) => [...prev, id])
    const kpis = allFundamentals.find((f) => f.id === id)?.kpis ?? []
    setSelectedKpiIds((prev) => [...prev, ...kpis.map((k) => k.id)])
  }
  const removeObjective = (id: string) => {
    setSelectedObjectives((prev) => prev.filter((o) => o !== id))
    const kpis = allFundamentals.find((f) => f.id === id)?.kpis.map((k) => k.id) ?? []
    setSelectedKpiIds((prev) => prev.filter((k) => !kpis.includes(k)))
  }
  const toggleKpi = (id: string) => {
    setSelectedKpiIds((prev) => (prev.includes(id) ? prev.filter((k) => k !== id) : [...prev, id]))
  }
  const toggleResponsible = (userId: string) => {
    setResponsibleIds((prev) => (prev.includes(userId) ? prev.filter((u) => u !== userId) : [...prev, userId]))
  }

  const addFundamental = async () => {
    if (!group || !newFundamentalLabel.trim()) return
    setAddingFundamental(true)
    try {
      await window.api.groupFundamentalsAdd(group.id, { label: newFundamentalLabel.trim(), description: newFundamentalDesc.trim() || null })
      setFundamentals(await window.api.groupFundamentalsList(group.id))
      setNewFundamentalLabel('')
      setNewFundamentalDesc('')
      setAddFundamentalOpen(false)
    } catch (err) {
      toast({ title: t(collabErrorKey(err)), variant: 'destructive' })
    } finally {
      setAddingFundamental(false)
    }
  }

  const startSession = async () => {
    if (!session || selectedObjectives.length === 0 || responsibleIds.length === 0) return
    setStarting(true)
    try {
      await window.api.teamSessionSetObjectives(session.id, selectedObjectives, selectedKpiIds)
      await window.api.teamSessionStart(session.id, responsibleIds, queueFilter)
      await load()
      toast({ title: t('teamSession.started', { defaultValue: 'Session started' }), variant: 'gold' })
    } catch (err) {
      toast({ title: t(collabErrorKey(err)), variant: 'destructive' })
    } finally {
      setStarting(false)
    }
  }

  const saveObjectives = async () => {
    if (!session || selectedObjectives.length === 0) return
    setSavingObjectives(true)
    try {
      await window.api.teamSessionSetObjectives(session.id, selectedObjectives, selectedKpiIds)
      await load()
      toast({ title: t('teamSession.objectivesSaved', { defaultValue: 'Objectives saved' }), variant: 'gold' })
    } catch (err) {
      toast({ title: t(collabErrorKey(err)), variant: 'destructive' })
    } finally {
      setSavingObjectives(false)
    }
  }

  const endSession = async () => {
    if (!session) return
    setEnding(true)
    try {
      await window.api.teamSessionEnd(session.id)
      await load()
      toast({ title: t('teamSession.ended', { defaultValue: 'Session ended' }), variant: 'success' })
    } catch (err) {
      toast({ title: t(collabErrorKey(err)), variant: 'destructive' })
    } finally {
      setEnding(false)
    }
  }

  if (collabLoading || event === undefined || session === undefined) {
    return <Loader2 className="h-6 w-6 animate-spin text-hextech-gold" />
  }

  if (!event || !session || !group) {
    return (
      <div className="space-y-4 animate-fade-in">
        <p className="text-sm text-hextech-text-dim">
          {t('teamSession.notFound', { defaultValue: 'No team session found for this event — open it from Planning.' })}
        </p>
        <Button variant="outline" onClick={() => navigate('/management?tab=planning')}>
          <ArrowLeft className="mr-2 h-4 w-4" />{t('teamSession.backToPlanning', { defaultValue: 'Back to Planning' })}
        </Button>
      </div>
    )
  }

  const countdown = session.status === 'scheduled' ? countdownState(event.startsAt, now) : null
  const objectiveLabels = selectedObjectives.map((id) => allFundamentals.find((f) => f.id === id)?.label ?? id)
  // A meeting has no queue or objectives: its own card asks the reason, the
  // people concerned and, once started, who is there (MeetingSetupCard).
  const isMeeting = event.kind === 'meeting'

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="font-display text-2xl font-bold text-hextech-gold-bright">{event.title}</h1>
          <p className="mt-1 text-sm text-hextech-text-dim">{group.name} · {t(`planning.kind.${event.kind}`)}</p>
        </div>
        <Badge variant={session.status === 'live' ? 'success' : session.status === 'ended' ? 'outline' : 'gold'}>
          {t(`teamSession.status.${session.status}`)}
        </Badge>
      </div>

      {focusGame && canManage && event.kind !== 'meeting' && (
        <div className="space-y-2">
          <h2 className="flex items-center gap-2 text-sm font-bold text-hextech-text-bright"><Mic className="h-4 w-4 text-hextech-gold" />{t('teamSession.endOfGame.focusTitle', { n: games.indexOf(focusGame) + 1 })}</h2>
          <PostGameReviewPrompt
            sessionId={session.id}
            gameId={focusGame.id}
            gameLabel={t('teamSession.gameLabel', { defaultValue: 'Game {{n}}', n: games.indexOf(focusGame) + 1 })}
            autoStart={autoStart}
            onDecided={() => { setFocusGameDone(true); load() }}
          />
        </div>
      )}

      {finalMode && session.status === 'ended' && event.kind !== 'meeting' && (
        <FinalReviewView
          sessionId={session.id}
          games={games}
          reviews={reviews}
          group={group}
          canManage={canManage}
          myUserId={myUserId ?? ''}
          nameOf={nameOf}
          autoStart={autoStart && (!focusGame || focusGameDone)}
          recordGameId={recordGameId}
          onRecordGame={setRecordGameId}
          onChanged={load}
        />
      )}

      {session.status === 'scheduled' && countdown && (
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <CalendarClock className="h-5 w-5 text-hextech-gold" />
            <span className="text-sm text-hextech-text">
              {countdown.isPast
                ? t('teamSession.countdownPast', { defaultValue: 'Starting now' })
                : t('teamSession.countdownStartsIn', { defaultValue: 'Starts in {{label}}', label: countdown.label })}
            </span>
          </CardContent>
        </Card>
      )}

      {session.status === 'ended' && (
        <Card>
          <CardContent className="p-4 text-sm text-hextech-text-dim">
            {t('teamSession.endedNote', { defaultValue: 'This session has ended.' })}
          </CardContent>
        </Card>
      )}

      {!canManage && session.status === 'scheduled' && (
        <p className="text-sm text-hextech-text-dim">
          {t('teamSession.waitingForResponsible', { defaultValue: 'Waiting for a responsible (coach/manager/captain) to start the session.' })}
        </p>
      )}

      {isMeeting && (
        <MeetingSetupCard event={event} session={session} group={group} canManage={canManage} myUserId={myUserId ?? ''} onChanged={load} />
      )}

      {!isMeeting && ((canManage && session.status !== 'ended') || (session.status !== 'scheduled')) ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Target className="h-5 w-5" />{t('teamSession.objectives', { defaultValue: 'Objectives' })}
            </CardTitle>
            {session.status === 'scheduled' && <CardDescription>{t('teamSession.objectivesDesc', { defaultValue: 'Pick up to 3 objectives for this session.' })}</CardDescription>}
          </CardHeader>
          <CardContent className="space-y-4">
            {objectiveLabels.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {selectedObjectives.map((id) => (
                  <Badge key={id} variant="gold" className="flex items-center gap-1 pr-1 text-sm">
                    {allFundamentals.find((f) => f.id === id)?.label ?? id}
                    {canManage && session.status !== 'ended' && (
                      <button onClick={() => removeObjective(id)} className="ml-1 rounded-full p-0.5 hover:bg-hextech-gold/20">
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-sm text-hextech-text-dim">{t('teamSession.noObjectivesYet', { defaultValue: 'No objectives set yet.' })}</p>
            )}

            {canManage && session.status !== 'ended' && (
              <>
                <FundamentalPickerDialog
                  FUNDAMENTALS={categories}
                  allFundamentals={allFundamentals}
                  selectedObjectives={selectedObjectives}
                  assessmentScores={{}}
                  onSelect={addObjective}
                  disabled={selectedObjectives.length >= 3}
                />
                <Button type="button" variant="ghost" size="sm" onClick={() => setAddFundamentalOpen(true)} className="text-hextech-text-dim">
                  <Plus className="mr-1 h-3.5 w-3.5" />{t('teamSession.addFundamental', { defaultValue: '+ Add a fundamental' })}
                </Button>
              </>
            )}

            {kpiGroups.length > 0 && (
              <div className="space-y-3">
                {kpiGroups.map((f) => (
                  <div key={f.id} className="space-y-1.5">
                    <p className="text-xs font-semibold text-hextech-gold">{f.label}</p>
                    <div className="flex flex-wrap gap-2">
                      {f.kpis.map((kpi) => {
                        const isSelected = selectedKpiIds.includes(kpi.id)
                        return (
                          <button
                            key={kpi.id}
                            disabled={!canManage || session.status === 'ended'}
                            onClick={() => toggleKpi(kpi.id)}
                            className={cn(
                              'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                              isSelected
                                ? 'border-hextech-gold bg-hextech-gold/10 text-hextech-gold-bright'
                                : 'border-hextech-border-dim text-hextech-text-dim hover:border-hextech-border',
                            )}
                          >
                            {kpi.label}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {canManage && session.status === 'live' && (
              <Button size="sm" variant="outline" onClick={saveObjectives} disabled={savingObjectives || selectedObjectives.length === 0}>
                {savingObjectives ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {t('teamSession.setObjectives', { defaultValue: 'Save objectives' })}
              </Button>
            )}
          </CardContent>
        </Card>
      ) : null}

      {!isMeeting && canManage && session.status === 'scheduled' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('teamSession.beforeStart', { defaultValue: 'Before starting' })}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-hextech-text-dim">{t('teamSession.queueFilter.title', { defaultValue: 'Queue' })}</p>
              <Select value={queueFilter} onValueChange={(v) => setQueueFilter(v as SessionQueueFilter)}>
                <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {QUEUE_FILTERS.map((f) => <SelectItem key={f} value={f}>{t(`teamSession.queueFilter.${f}`)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <p className="text-xs font-medium text-hextech-text-dim">{t('teamSession.responsibles', { defaultValue: 'Responsibles' })}</p>
              <div className="flex flex-wrap gap-1.5">
                {eligibleResponsibles.map((m) => (
                  <button
                    key={m.userId}
                    onClick={() => toggleResponsible(m.userId)}
                    className={cn(
                      'rounded px-2 py-1 text-xs',
                      responsibleIds.includes(m.userId) ? 'bg-hextech-gold/30 text-hextech-gold-bright' : 'bg-hextech-elevated text-hextech-text-dim',
                    )}
                  >
                    {m.displayName || m.riotId || '—'}
                  </button>
                ))}
              </div>
            </div>

            <Button onClick={startSession} disabled={starting || selectedObjectives.length === 0 || responsibleIds.length === 0} className="w-full">
              {starting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
              {t('teamSession.startSession', { defaultValue: 'Start session' })}
            </Button>
          </CardContent>
        </Card>
      )}

      {canManage && session.status === 'live' && (
        <Button variant="outline" onClick={endSession} disabled={ending} className="border-[#E24C3A]/40 text-[#E24C3A] hover:bg-[#E24C3A]/10">
          {ending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Square className="mr-2 h-4 w-4" />}
          {t('teamSession.endSession', { defaultValue: 'End session' })}
        </Button>
      )}

      {event.kind === 'meeting' && session.status !== 'scheduled' && (
        <MeetingReviewPanel sessionId={session.id} canManage={canManage} />
      )}

      {event.kind !== 'meeting' && session.status !== 'scheduled' && canManage && gamesNeedingPrompt.length > 0 && (
        <div className="space-y-3">
          {gamesNeedingPrompt.map((g, i) => (
            <PostGameReviewPrompt
              key={g.id}
              sessionId={session.id}
              gameId={g.id}
              gameLabel={t('teamSession.gameLabel', { defaultValue: 'Game {{n}}', n: games.indexOf(g) + 1 || i + 1 })}
              onDecided={load}
            />
          ))}
        </div>
      )}

      {!finalMode && event.kind !== 'meeting' && session.status !== 'scheduled' && games.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-sm font-bold text-hextech-text-bright">
            {t('teamSession.games', { defaultValue: 'Games', count: games.length })}
          </h2>
          {games.map((g) => (
            <TeamSessionGameCard
              key={g.id}
              game={g}
              group={group}
              canManage={canManage}
              onOurTeamIdResolved={load}
            />
          ))}
        </div>
      )}

      {session.status === 'ended' && !finalMode && (
        <SessionReviewPanel sessionId={session.id} games={games} canManage={canManage} myUserId={myUserId ?? ''} nameOf={nameOf} />
      )}

      <Dialog open={addFundamentalOpen} onOpenChange={setAddFundamentalOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('teamSession.addFundamentalTitle', { defaultValue: 'Add a team fundamental' })}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              value={newFundamentalLabel}
              onChange={(e) => setNewFundamentalLabel(e.target.value)}
              maxLength={80}
              placeholder={t('teamSession.addFundamentalLabel', { defaultValue: 'Label' })}
            />
            <Textarea
              value={newFundamentalDesc}
              onChange={(e) => setNewFundamentalDesc(e.target.value)}
              maxLength={500}
              rows={2}
              placeholder={t('teamSession.addFundamentalDesc', { defaultValue: 'Description (optional)' })}
            />
          </div>
          <DialogFooter>
            <Button onClick={addFundamental} disabled={addingFundamental || !newFundamentalLabel.trim()}>
              {addingFundamental ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {t('teamSession.addFundamentalSave', { defaultValue: 'Add' })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** Final review (17/11/2026): the whole session in one place — session
 *  performance + final recording, then EVERY game of the session with its
 *  own review state (done / skipped / none), transcript excerpt, a way to
 *  record a skipped one, and its full stats. */
function FinalReviewView({ sessionId, games, reviews, group, canManage, myUserId, nameOf, autoStart, recordGameId, onRecordGame, onChanged }: {
  sessionId: string
  games: TeamSessionGame[]
  reviews: TeamSessionReview[]
  group: NonNullable<ReturnType<typeof useCollab>['groups'][number]>
  canManage: boolean
  myUserId: string
  nameOf: NameOf
  autoStart: boolean
  recordGameId: string | null
  onRecordGame: (id: string | null) => void
  onChanged: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 border-b border-hextech-border-dim pb-2">
        <ClipboardCheck className="h-5 w-5 text-hextech-gold" />
        <h2 className="font-display text-xl font-bold text-hextech-gold-bright">{t('teamSession.finalView.title')}</h2>
        <span className="text-xs text-hextech-text-dim">{t('teamSession.finalView.gamesCount', { count: games.length })}</span>
      </div>

      <SessionReviewPanel sessionId={sessionId} games={games} canManage={canManage} myUserId={myUserId} nameOf={nameOf} autoStart={autoStart} />

      {games.length === 0 ? (
        <p className="text-sm text-hextech-text-dim">{t('teamSession.finalView.noGames')}</p>
      ) : (
        <div className="space-y-4">
          <h3 className="text-sm font-bold text-hextech-text-bright">{t('teamSession.finalView.gamesTitle')}</h3>
          {games.map((g, i) => {
            const review = reviews.find((r) => r.gameId === g.id) ?? null
            const state = review?.status === 'done' ? 'done' : review?.status === 'deferred' ? 'deferred' : review ? 'inProgress' : 'none'
            return (
              <div key={g.id} className="space-y-2 rounded-xl border border-hextech-border-dim p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-hextech-text-bright">{t('teamSession.gameLabel', { defaultValue: 'Game {{n}}', n: i + 1 })}</span>
                  <div className="flex items-center gap-2">
                    <Badge variant={state === 'done' ? 'success' : state === 'none' ? 'outline' : 'gold'}>{t(`teamSession.finalView.reviewState.${state}`)}</Badge>
                    {canManage && state !== 'done' && recordGameId !== g.id && (
                      <Button size="sm" variant="outline" onClick={() => onRecordGame(g.id)}><Mic className="mr-1 h-3.5 w-3.5" />{t('teamSession.finalView.recordGame')}</Button>
                    )}
                  </div>
                </div>
                {review?.transcript && (
                  <p className="line-clamp-3 whitespace-pre-wrap rounded-md bg-hextech-elevated p-2 text-xs text-hextech-text">{review.transcript}</p>
                )}
                {review?.summary && <p className="text-xs text-hextech-text-bright">{review.summary}</p>}
                {recordGameId === g.id && (
                  <PostGameReviewPrompt sessionId={sessionId} gameId={g.id} gameLabel={t('teamSession.gameLabel', { defaultValue: 'Game {{n}}', n: i + 1 })}
                    autoStart onDecided={() => { onRecordGame(null); onChanged() }} />
                )}
                <TeamSessionGameCard game={g} group={group} canManage={canManage} onOurTeamIdResolved={onChanged} />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
