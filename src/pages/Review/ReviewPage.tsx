import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom'
import { ChampionMatchup } from '@/components/ChampionMatchup'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { useSessionStore } from '@/store/useSessionStore'
import { useUserStore } from '@/store/useUserStore'
import { TimelineNoteInput, type TimelineNote } from '@/components/ReviewForm/TimelineNoteInput'
import { DynamicKPIForm } from '@/components/ReviewForm/DynamicKPIForm'
import { ReviewInsightPanel } from '@/components/Coaching/ReviewInsightPanel'
import { MatchHistoryPicker } from '@/components/Session/MatchHistoryPicker'
import { AccountBadge } from '@/components/ui/AccountBadge'
import { useLocalizedFundamental, useLocalizedFundamentals } from '@/lib/constants/useFundamentals'
import { getKPIsForObjective } from '@/lib/constants/fundamentals'
import type { ReviewBiasSignal } from '@/lib/ipc'
import { useTranslation } from 'react-i18next'
import {
  Loader2,
  Check,
  X,
  Play,
  Square,
  Swords,
  Clock,
  Eye,
  Target as TargetIcon,
  AlertTriangle,
  ExternalLink,
  ShieldAlert,
} from 'lucide-react'
import { ExternalReviewWizard } from './ExternalReviewWizard'
import { ExternalReviewsList } from './ExternalReviewsList'
import { ShareButton } from '@/components/Share/ShareButton'
import { useToast } from '@/hooks/useToast'
import { formatGameTime, formatKDA, formatCSPerMin, cn } from '@/lib/utils'
import { GameRecordingPanel } from '@/components/Recording/GameRecordingPanel'

export function ReviewPage() {
  const { t } = useTranslation()
  const [showExternalWizard, setShowExternalWizard] = useState(false)
  const [activeTab, setActiveTab] = useState<'review' | 'external'>('review')
  const activeSession = useSessionStore((s) => s.activeSession)
  const refreshSession = useSessionStore((s) => s.refreshSession)
  const loadActiveSession = useSessionStore((s) => s.loadActiveSession)
  const clearGameEndData = useUserStore((s) => s.clearGameEndData)
  const user = useUserStore((s) => s.user)
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const requestedGameId = searchParams.get('gameId')
  const { toast } = useToast()
  const allFundamentals = useLocalizedFundamentals().flatMap((c) => c.fundamentals)

  // When a gameId is provided but there's no active session, load the game's session from DB
  const [historicContext, setHistoricContext] = useState<{ game: any; session: any } | null>(null)
  const [loadingHistoric, setLoadingHistoric] = useState(false)

  useEffect(() => {
    if (requestedGameId) {
      setLoadingHistoric(true)
      window.api.getGameContext(requestedGameId)
        .then((ctx) => {
          setHistoricContext(ctx)
        })
        .catch(() => {
          setHistoricContext(null)
        })
        .finally(() => setLoadingHistoric(false))
    } else {
      setHistoricContext(null)
    }
  }, [requestedGameId])

  const isGameInActiveSession = useMemo(() => {
    if (!activeSession || !requestedGameId) return false
    return activeSession.games?.some((g: any) => g.id === requestedGameId) ?? false
  }, [activeSession, requestedGameId])

  const session = useMemo(() => {
    if (!requestedGameId) return activeSession ?? null
    if (isGameInActiveSession) return activeSession
    return historicContext?.session ?? activeSession ?? null
  }, [requestedGameId, activeSession, isGameInActiveSession, historicContext])

  const objectiveFundamental = useLocalizedFundamental(session?.objectiveId ?? '')

  const objectiveIds: string[] = useMemo(() => {
    if (!session) return []
    try { return JSON.parse(session.objectiveIds) } catch { return [session.objectiveId] }
  }, [session])

  const selectedKpiIds: string[] = useMemo(() => {
    if (!session) return []
    try {
      const ids = JSON.parse(session.selectedKpiIds ?? '[]')
      return Array.isArray(ids) ? ids : []
    } catch { return [] }
  }, [session])

  const objectiveLabelsStr = objectiveIds
    .map((id) => allFundamentals.find((f) => f.id === id)?.label ?? id)
    .join(', ')
  const activeSubObjective = session?.subObjective

  const [timelineNotes, setTimelineNotes] = useState<TimelineNote[]>([])
  const [kpiScores, setKpiScores] = useState<Record<string, number>>({})
  const [kpiNotes, setKpiNotes] = useState<Record<string, string>>({})
  const [freeText, setFreeText] = useState('')
  const [objectiveRespected, setObjectiveRespected] = useState<boolean | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [biasSignals, setBiasSignals] = useState<ReviewBiasSignal[]>([])
  const [draftAutoSaved, setDraftAutoSaved] = useState(false)
  const warnedBiasKeysRef = useRef<Set<string>>(new Set())
  const [offRoleDismissed, setOffRoleDismissed] = useState(false)
  const [removingGame, setRemovingGame] = useState(false)

  const latestGame = useMemo(() => {
    if (requestedGameId) {
      if (historicContext?.game && requestedGameId === historicContext.game.id) {
        return historicContext.game
      }
      const fromSession = session?.games?.find((g: any) => g.id === requestedGameId)
      if (fromSession) return fromSession
      return null
    }
    if (!session) return null
    return (
      session.games?.find((g: any) => !g.review && g.reviewStatus !== 'to_be_reviewed') ??
      session.games?.find((g: any) => !g.review && g.reviewStatus === 'to_be_reviewed') ??
      null
    )
  }, [session, historicContext, requestedGameId])

  // Draft persistence — must come after latestGame
  const draftKey = latestGame ? `review-draft-${latestGame.id}` : null

  const saveDraft = useCallback(() => {
    if (!draftKey || saved) return
    sessionStorage.setItem(draftKey, JSON.stringify({ timelineNotes, kpiScores, kpiNotes, freeText, objectiveRespected }))
  }, [draftKey, timelineNotes, kpiScores, freeText, objectiveRespected, saved])

  const clearDraft = useCallback(() => {
    if (draftKey) sessionStorage.removeItem(draftKey)
  }, [draftKey])

  const hasDraft = draftAutoSaved

  const isDirty = useMemo(() => {
    return timelineNotes.length > 0 || Object.keys(kpiScores).length > 0 || freeText.trim().length > 0 || objectiveRespected !== null
  }, [timelineNotes, kpiScores, freeText, objectiveRespected])

  useEffect(() => {
    loadActiveSession()
  }, [loadActiveSession])

  const postGameSetupHandledRef = useRef(false)

  useEffect(() => {
    const st = (location.state as { postGameSetup?: { title?: string } } | undefined)?.postGameSetup
    if (!st) {
      postGameSetupHandledRef.current = false
      return
    }
    if (postGameSetupHandledRef.current) return
    postGameSetupHandledRef.current = true
    if (st.title) {
      toast({
        title: 'Après partie',
        description: `« ${st.title} » — la VOD est liée ci-dessous.`,
        variant: 'default',
      })
    }
    navigate({ pathname: location.pathname, search: location.search }, { replace: true, state: {} })
  }, [location.state, location.pathname, location.search, navigate, toast])

  useEffect(() => {
    if (!latestGame?.id || objectiveIds.length === 0) {
      setBiasSignals([])
      return
    }

    window.api
      .analyzeReviewBias(latestGame.id, objectiveIds)
      .then(setBiasSignals)
      .catch(() => setBiasSignals([]))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestGame?.id, activeSession?.id, objectiveIds.join(',')])

  useEffect(() => {
    warnedBiasKeysRef.current = new Set()
  }, [latestGame?.id])

  useEffect(() => {
    const review = latestGame?.review
    const key = latestGame ? `review-draft-${latestGame.id}` : null

    setSaved(false)
    setDraftAutoSaved(false)
    setBiasSignals([])

    if (review) {
      try {
        const parsedTimelineNotes = JSON.parse(review.timelineNotes ?? '[]')
        setTimelineNotes(Array.isArray(parsedTimelineNotes) ? parsedTimelineNotes : [])
      } catch {
        setTimelineNotes([])
      }
      try {
        const parsedKpiScores = JSON.parse(review.kpiScores ?? '{}')
        setKpiScores(parsedKpiScores && typeof parsedKpiScores === 'object' ? parsedKpiScores : {})
      } catch {
        setKpiScores({})
      }
      setFreeText(review.freeText ?? '')
      setObjectiveRespected(review.objectiveRespected ?? null)
      return
    }

    // No saved review — try to restore draft from sessionStorage
    if (key) {
      const raw = sessionStorage.getItem(key)
      if (raw) {
        try {
          const draft = JSON.parse(raw)
          setTimelineNotes(Array.isArray(draft.timelineNotes) ? draft.timelineNotes : [])
          setKpiScores(draft.kpiScores && typeof draft.kpiScores === 'object' ? draft.kpiScores : {})
          setKpiNotes(draft.kpiNotes && typeof draft.kpiNotes === 'object' ? draft.kpiNotes : {})
          setFreeText(draft.freeText ?? '')
          setObjectiveRespected(draft.objectiveRespected ?? null)
          return
        } catch { /* ignore bad draft */ }
      }
    }

    setTimelineNotes([])
    setKpiScores({})
    setFreeText('')
    setObjectiveRespected(null)
  }, [activeSession?.id, latestGame?.id])

  // Auto-save draft on every change (debounced)
  useEffect(() => {
    if (!draftKey || saved) return
    const timer = setTimeout(() => {
      saveDraft()
      setDraftAutoSaved(true)
    }, 500)
    return () => clearTimeout(timer)
  }, [draftKey, saveDraft, saved])

  // Warn on window close when dirty
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty && !saved) e.preventDefault()
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [isDirty, saved])

  const objectiveLabel = objectiveLabelsStr || objectiveFundamental?.label || activeSession?.objectiveId || ''

  const biasWarningsByObjective = useMemo(() => {
    const warnings: Record<string, string[]> = {}

    for (const signal of biasSignals) {
      const kpis = getKPIsForObjective(
        signal.objectiveId,
        activeSubObjective ?? undefined,
      )
      const objectiveScores = kpis
        .map((kpi) => kpiScores[kpi.id])
        .filter((score): score is number => typeof score === 'number' && score > 0)

      if (objectiveScores.length !== kpis.length || objectiveScores.length === 0) continue
      const avgScore = objectiveScores.reduce((sum, score) => sum + score, 0) / objectiveScores.length
      const minScore = Math.min(...objectiveScores)

      if (avgScore < 7 || minScore < 7) continue

      const message = getBiasMessage(t, signal)
      warnings[signal.objectiveId] = [...(warnings[signal.objectiveId] ?? []), message]
    }

    return warnings
  }, [activeSubObjective, biasSignals, kpiScores, t])

  useEffect(() => {
    const entries = Object.entries(biasWarningsByObjective)
    if (entries.length === 0) return

    const freshWarnings = entries.flatMap(([objectiveId, messages]) =>
      messages
        .map((message) => ({ objectiveId, message, key: `${objectiveId}:${message}` }))
        .filter((item) => !warnedBiasKeysRef.current.has(item.key)),
    )

    if (freshWarnings.length === 0) return

    for (const warning of freshWarnings) {
      warnedBiasKeysRef.current.add(warning.key)
    }

    toast({
      title: t('review.bias.toastTitle'),
      description: freshWarnings[0].message,
      variant: 'destructive',
    })
  }, [biasWarningsByObjective, t, toast])

  // Loading historic context
  if (loadingHistoric) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-hextech-gold" />
      </div>
    )
  }

  // No session at all and no historic context being loaded
  if (!session) {
    return (
      <>
        {/* Tab bar */}
        <div className="flex items-center gap-1 border-b border-hextech-border-dim mb-6">
          <button
            onClick={() => setActiveTab('review')}
            className={cn(
              'px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px',
              activeTab === 'review'
                ? 'border-hextech-gold text-hextech-gold-bright'
                : 'border-transparent text-hextech-text-dim hover:text-hextech-text',
            )}
          >
            My Review
          </button>
          <button
            onClick={() => setActiveTab('external')}
            className={cn(
              'px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px',
              activeTab === 'external'
                ? 'border-hextech-gold text-hextech-gold-bright'
                : 'border-transparent text-hextech-text-dim hover:text-hextech-text',
            )}
          >
            External Reviews
          </button>
        </div>

        {activeTab === 'review' ? (
          <div className="flex flex-col items-center justify-center py-12 gap-4">
            <Swords className="h-12 w-12 text-hextech-text-dim" />
            <h2 className="text-xl font-display font-bold text-hextech-text-bright">{t('review.noSession.title')}</h2>
            <p className="text-sm text-hextech-text">{t('review.noSession.desc')}</p>
            <div className="flex gap-3">
              <Button onClick={() => navigate('/session')}>
                <TargetIcon className="h-4 w-4 mr-2" /> {t('review.noSession.button')}
              </Button>
              <Button variant="outline" onClick={() => setShowExternalWizard(true)}>
                <ExternalLink className="h-4 w-4 mr-2" /> External review
              </Button>
            </div>
          </div>
        ) : (
          <ExternalReviewsList
            onCreateNew={() => setShowExternalWizard(true)}
          />
        )}

        <ExternalReviewWizard
          open={showExternalWizard}
          onClose={() => setShowExternalWizard(false)}
        />
      </>
    )
  }

  if (saved) {
    return (
      <div className="space-y-4 animate-fade-in">
        <div>
          <h1 className="font-display text-2xl font-bold text-hextech-gold-bright">{t('review.savedTitle')}</h1>
        </div>

        <ReviewInsightPanel
          objectiveRespected={objectiveRespected}
          kpiScores={kpiScores}
          timelineNotes={timelineNotes}
          freeText={freeText}
          objectiveLabel={objectiveLabelsStr}
          selectedKpiIds={selectedKpiIds}
        />

        <div className="flex gap-3">
          <Button onClick={() => { setSaved(false); setTimelineNotes([]); setKpiScores({}); setFreeText(''); setObjectiveRespected(null) }}>
            <Play className="h-4 w-4 mr-2" />
            {t('review.playAnother')}
          </Button>
          <Button variant="outline" onClick={() => navigate('/session')}>
            <Square className="h-4 w-4 mr-2" />
            {t('review.endSession')}
          </Button>
        </div>
      </div>
    )
  }

  if (!latestGame) {
    return (
      <>
      <div className="space-y-4 animate-fade-in">
        <div>
          <h1 className="font-display text-2xl font-bold text-hextech-gold-bright">{t('nav.review')}</h1>
          <p className="text-sm text-hextech-text mt-1">{t('review.waiting.title')}</p>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-10 gap-4">
            <div className="h-16 w-16 rounded-full bg-hextech-elevated flex items-center justify-center animate-pulse">
              <Swords className="h-8 w-8 text-hextech-gold" />
            </div>
            <p className="text-hextech-text text-center max-w-md">
              {t('review.waiting.desc')}
              <br />
              <span className="text-hextech-text-dim text-xs">
                {t('review.sessionObjective')} {objectiveLabel}
              </span>
            </p>
            <div className="text-sm text-hextech-text">
              {t('review.gamePlayed', { count: session?.games?.length ?? 0 })} |{' '}
              {t('review.gameReviewed', { count: session?.games?.filter((g: any) => g.review).length ?? 0 })}
            </div>
          </CardContent>
        </Card>

        <div className="rounded-xl border border-hextech-border-dim bg-hextech-elevated/30 p-4 space-y-3">
          <p className="text-sm text-hextech-text-dim text-center">{t('review.waiting.orImport')}</p>
          <MatchHistoryPicker onImported={() => refreshSession()} />
        </div>

        <div className="flex justify-center">
          <Button variant="outline" onClick={() => setShowExternalWizard(true)}>
            <ExternalLink className="h-4 w-4 mr-2" /> External review
          </Button>
        </div>
      </div>
      <ExternalReviewWizard open={showExternalWizard} onClose={() => setShowExternalWizard(false)} />
      </>
    )
  }

  const handleSave = async () => {
    if (objectiveRespected === null) {
      toast({ title: t('review.toast.validationError'), variant: 'destructive' })
      return
    }

    const isEditingExistingReview = !!latestGame?.review
    setSaving(true)
    try {
      await window.api.saveReview({
        gameId: latestGame.id,
        timelineNotes,
        kpiScores,
        kpiNotes: Object.keys(kpiNotes).length > 0 ? kpiNotes : undefined,
        freeText: freeText || undefined,
        objectiveRespected,
      })

      setSaved(true)
      clearDraft()
      clearGameEndData()
      // Refresh active session if it exists; otherwise reload the historic context
      if (activeSession) {
        await refreshSession()
      } else if (requestedGameId) {
        const ctx = await window.api.getGameContext(requestedGameId).catch(() => null)
        setHistoricContext(ctx)
      }

      toast({
        title: t('review.toast.successTitle'),
        description: isEditingExistingReview ? undefined : t('review.toast.successXp'),
        variant: 'gold',
      })
    } catch (err: any) {
      toast({ title: t('review.toast.errorTitle'), description: err.message, variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const handleReviewLater = async () => {
    if (!latestGame?.id || latestGame.review || latestGame.reviewStatus === 'to_be_reviewed') return

    setSaving(true)
    try {
      await window.api.setGameReviewStatus(latestGame.id, 'to_be_reviewed')
      await refreshSession()
      toast({ title: t('review.toast.reviewLaterTitle'), variant: 'gold' })
      navigate('/session')
    } catch (err: any) {
      toast({ title: t('review.toast.errorTitle'), description: err.message, variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  /** Remove the current off-role game from the session and return to the session page. */
  const handleRemoveOffRoleGame = async () => {
    if (!latestGame?.id) return
    setRemovingGame(true)
    try {
      await window.api.deleteGame(latestGame.id)
      clearGameEndData()
      await refreshSession()
      toast({ title: 'Game removed from session', variant: 'gold' })
      navigate('/session')
    } catch (err: any) {
      toast({ title: 'Failed to remove game', description: err.message, variant: 'destructive' })
    } finally {
      setRemovingGame(false)
    }
  }

  /** Whether to show the off-role banner: active session, known main role, role mismatch, not dismissed. */
  const showOffRoleBanner =
    !offRoleDismissed &&
    activeSession !== null &&
    !historicContext &&
    !!user?.mainRole &&
    !!latestGame?.role &&
    latestGame.role !== user.mainRole

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-hextech-gold-bright">{t('review.title')}</h1>
          <p className="text-sm text-hextech-text mt-1">
            {t('review.objective')} <span className="text-hextech-gold">{objectiveLabel}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ShareButton
            data={{
              title: latestGame.champion
                ? `${latestGame.champion}${latestGame.opponentChampion ? ` vs ${latestGame.opponentChampion}` : ''}`
                : t('review.title'),
              gameEndAt: latestGame.gameEndAt,
              win: latestGame.win,
              champion: latestGame.champion,
              opponentChampion: latestGame.opponentChampion ?? undefined,
              kills: latestGame.kills,
              deaths: latestGame.deaths,
              assists: latestGame.assists,
              cs: latestGame.cs,
              visionScore: latestGame.visionScore,
              duration: latestGame.duration,
              objectiveIds,
              selectedKpiIds,
              kpiScores,
              timelineNotes,
              freeText,
              aiSummary: latestGame.review?.aiSummary ?? undefined,
            }}
          />
          <Badge variant={latestGame.win ? 'success' : 'destructive'} className="text-base px-4 py-1">
            {latestGame.win ? t('review.victory') : t('review.defeat')}
          </Badge>
        </div>
      </div>

      {/* Off-role banner — shown when game role doesn't match main role in a live session */}
      {showOffRoleBanner && (
        <div className="flex items-start gap-3 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-3">
          <ShieldAlert className="h-5 w-5 text-yellow-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-yellow-300">
              Off-role game detected ({latestGame.role})
            </p>
            <p className="text-xs text-yellow-400/70 mt-0.5">
              Your main role is {user?.mainRole}. Do you want to keep this game in the session or remove it?
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={() => setOffRoleDismissed(true)}
              className="rounded border border-yellow-500/40 px-3 py-1 text-xs text-yellow-300 hover:bg-yellow-500/10 transition-colors"
            >
              Keep
            </button>
            <button
              onClick={handleRemoveOffRoleGame}
              disabled={removingGame}
              className="rounded border border-[#FF4655]/50 bg-[#FF4655]/10 px-3 py-1 text-xs text-[#FF4655] hover:bg-[#FF4655]/20 transition-colors disabled:opacity-50"
            >
              {removingGame ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Remove from session'}
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <ChampionMatchup
          playerChampion={latestGame.champion}
          opponentChampion={latestGame.opponentChampion}
          size="lg"
        />
        <div className="flex flex-col gap-1">
          {latestGame.opponentChampion && (
            <span className="text-xs text-hextech-text-dim">
              {latestGame.champion} <span className="text-hextech-text-dim">vs</span> {latestGame.opponentChampion}
            </span>
          )}
          {latestGame.accountName && (
            <AccountBadge name={latestGame.accountName} profileIconId={latestGame.accountProfileIconId} />
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatPill icon={Swords} label={t('review.stats.kda')} value={formatKDA(latestGame.kills, latestGame.deaths, latestGame.assists)} />
        <StatPill icon={TargetIcon} label={t('review.stats.cs')} value={`${latestGame.cs} (${formatCSPerMin(latestGame.cs, latestGame.duration)}/m)`} />
        <StatPill icon={Eye} label={t('review.stats.vision')} value={latestGame.visionScore.toString()} />
        <StatPill icon={Clock} label={t('review.stats.duration')} value={formatGameTime(latestGame.duration)} />
      </div>

      {/* Recording panel — passes notes for video markers + receives new video-timestamped notes */}
      <GameRecordingPanel
        gameId={latestGame.id}
        timelineNotes={timelineNotes}
        onAddNote={(note) => setTimelineNotes((prev) => [...prev, note])}
      />

      {Object.keys(biasWarningsByObjective).length > 0 && (
        <Card className="border-orange-500/40 bg-orange-500/5">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-orange-300" />
            <div className="space-y-1">
              <div className="text-sm font-medium text-orange-200">{t('review.bias.bannerTitle')}</div>
              <div className="text-xs text-orange-100/90">{t('review.bias.bannerDesc')}</div>
            </div>
          </CardContent>
        </Card>
      )}

      <TimelineNoteInput notes={timelineNotes} onChange={setTimelineNotes} objectiveLabel={session?.objectiveId ?? ''} />

      <DynamicKPIForm
        objectiveIds={objectiveIds}
        subObjectiveId={activeSubObjective ?? undefined}
        scores={kpiScores}
        onChange={(kpiId, score) => setKpiScores((prev) => ({ ...prev, [kpiId]: score }))}
        kpiNotes={kpiNotes}
        onNoteChange={(kpiId, note) => setKpiNotes((prev) => ({ ...prev, [kpiId]: note }))}
        biasWarningsByObjective={biasWarningsByObjective}
        selectedKpiIds={selectedKpiIds.length > 0 ? selectedKpiIds : undefined}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('review.freeText.label')}</CardTitle>
          <CardDescription>{t('review.freeText.hint')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            placeholder={t('review.freeText.placeholder')}
            value={freeText}
            onChange={(e) => setFreeText(e.target.value)}
            rows={3}
          />
        </CardContent>
      </Card>

      <Card className="border-hextech-gold/30">
        <CardContent className="p-4">
          <div className="text-sm font-medium text-hextech-gold-bright mb-3">
            {t('review.objectiveQuestion')}
          </div>
          <div className="flex gap-3">
            <Button variant={objectiveRespected === true ? 'default' : 'outline'} onClick={() => setObjectiveRespected(true)} className="flex-1">
              <Check className="h-4 w-4 mr-2" /> {t('review.yes')}
            </Button>
            <Button variant={objectiveRespected === false ? 'destructive' : 'outline'} onClick={() => setObjectiveRespected(false)} className="flex-1">
              <X className="h-4 w-4 mr-2" /> {t('review.no')}
            </Button>
          </div>
        </CardContent>
      </Card>

      {hasDraft && !saved && (
        <p className="text-[10px] text-hextech-text-dim text-right -mb-2">
          Draft auto-saved
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {!latestGame.review && latestGame.reviewStatus !== 'to_be_reviewed' && (
          <Button variant="outline" onClick={handleReviewLater} disabled={saving} size="lg">
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Clock className="h-4 w-4 mr-2" />}
            {t('review.reviewLater')}
          </Button>
        )}
        <Button onClick={handleSave} disabled={saving} className={latestGame.review || latestGame.reviewStatus === 'to_be_reviewed' ? 'w-full' : ''} size="lg">
          {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Check className="h-4 w-4 mr-2" />}
          {t('review.saveButton')}
        </Button>
      </div>

    </div>
  )
}

function StatPill({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="rounded-lg bg-hextech-elevated border border-hextech-border-dim p-3 text-center">
      <Icon className="h-4 w-4 mx-auto text-hextech-gold mb-1" />
      <div className="text-sm font-semibold text-hextech-text-bright">{value}</div>
      <div className="text-xs text-hextech-text-dim">{label}</div>
    </div>
  )
}

function getBiasMessage(t: (key: string, options?: Record<string, unknown>) => string, signal: ReviewBiasSignal) {
  switch (signal.ruleId) {
    case 'early_jungle_gank_deaths':
      return t('review.bias.rules.earlyJungleGankDeaths', { count: signal.evidence.count })
    case 'low_vision_activity':
      return t('review.bias.rules.lowVisionActivity', {
        wards: signal.evidence.wardsPlaced,
        control: signal.evidence.controlWards,
      })
    case 'low_cs_per_min':
      return t('review.bias.rules.lowCsPerMin', {
        actual: signal.evidence.actual,
        expected: signal.evidence.expected,
      })
    case 'losing_laning_state':
      return t('review.bias.rules.losingLaningState', {
        goldDiff: signal.evidence.goldDiff15,
        csDiff: signal.evidence.csDiff15,
      })
    case 'low_vision_control':
      return t('review.bias.rules.lowVisionControl', {
        vsPerMin: signal.evidence.visionScorePerMin,
        wardsDestroyed: signal.evidence.wardsDestroyed,
      })
    case 'low_support_vision':
      return t('review.bias.rules.lowSupportVision', {
        vsPerMin: signal.evidence.visionScorePerMin,
        control: signal.evidence.controlWards,
      })
    case 'low_skillshot_dodging':
      return t('review.bias.rules.lowSkillshotDodging', {
        deaths: signal.evidence.deaths,
        dodged: signal.evidence.skillshotsDodged,
      })
    case 'high_deaths_low_value':
      return t('review.bias.rules.highDeathsLowValue', {
        deaths: signal.evidence.deaths,
        soloKills: signal.evidence.soloKills,
      })
    case 'low_roam_presence':
      return t('review.bias.rules.lowRoamPresence', {
        kp: signal.evidence.killParticipation,
      })
    case 'low_jungle_influence':
      return t('review.bias.rules.lowJungleInfluence', {
        kp: signal.evidence.killParticipation,
        epic: signal.evidence.objectiveDamageParticipation,
      })
    case 'low_objective_impact':
      return t('review.bias.rules.lowObjectiveImpact', {
        objectives: signal.evidence.objectiveDamage,
        buildings: signal.evidence.buildingDamage,
      })
    case 'low_structure_pressure':
      return t('review.bias.rules.lowStructurePressure', {
        buildings: signal.evidence.buildingDamage,
      })
    case 'low_carry_output':
      return t('review.bias.rules.lowCarryOutput', {
        dmg: signal.evidence.teamDamagePercent,
        deaths: signal.evidence.deaths,
      })
    case 'low_teamfight_presence':
      return t('review.bias.rules.lowTeamfightPresence', {
        kp: signal.evidence.killParticipation,
      })
    case 'low_tempo_efficiency':
      return t('review.bias.rules.lowTempoEfficiency', {
        cs: signal.evidence.actualCsPerMin,
        objective: signal.evidence.objectiveDamage,
        building: signal.evidence.buildingDamage,
      })
    case 'high_danger_zone_time':
      return t('review.bias.rules.highDangerZoneTime', {
        pct: signal.evidence.dangerPct,
        deaths: signal.evidence.totalEarlyDeaths,
      })
    case 'deaths_in_danger_zone':
      return t('review.bias.rules.deathsInDangerZone', {
        danger: signal.evidence.deathsInDanger,
        total: signal.evidence.deathsTotal,
      })
    case 'high_danger_zone_trading':
      return t('review.bias.rules.highDangerZoneTrading', {
        pct: signal.evidence.dangerDmgPct,
        deaths: signal.evidence.deathsInDanger,
      })
    case 'jungle_danger_quadrant_deaths':
      return t('review.bias.rules.jungleDangerQuadrantDeaths', {
        deaths: signal.evidence.deathsInDanger,
      })
    default:
      return t('review.bias.generic')
  }
}
