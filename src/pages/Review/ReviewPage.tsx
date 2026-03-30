import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ChampionMatchup } from '@/components/ChampionMatchup'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { useSessionStore } from '@/store/useSessionStore'
import { useUserStore } from '@/store/useUserStore'
import { TimelineNoteInput, type TimelineNote } from '@/components/ReviewForm/TimelineNoteInput'
import { DynamicKPIForm } from '@/components/ReviewForm/DynamicKPIForm'
import { AISummaryPanel } from '@/components/AIPanel/AISummaryPanel'
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
} from 'lucide-react'
import { useToast } from '@/hooks/useToast'
import { formatGameTime, formatKDA, formatCSPerMin } from '@/lib/utils'
import { GameRecordingPanel } from '@/components/Recording/GameRecordingPanel'
import { CoachComments } from '@/components/Coach/CoachComments'

export function ReviewPage() {
  const { t } = useTranslation()
  const activeSession = useSessionStore((s) => s.activeSession)
  const refreshSession = useSessionStore((s) => s.refreshSession)
  const loadActiveSession = useSessionStore((s) => s.loadActiveSession)
  const clearGameEndData = useUserStore((s) => s.clearGameEndData)
  const user = useUserStore((s) => s.user)
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const requestedGameId = searchParams.get('gameId')
  const { toast } = useToast()
  const allFundamentals = useLocalizedFundamentals().flatMap((c) => c.fundamentals)
  const objectiveFundamental = useLocalizedFundamental(activeSession?.objectiveId ?? '')

  const objectiveIds: string[] = useMemo(() => {
    if (!activeSession) return []
    try { return JSON.parse(activeSession.objectiveIds) } catch { return [activeSession.objectiveId] }
  }, [activeSession])

  const selectedKpiIds: string[] = useMemo(() => {
    if (!activeSession) return []
    try {
      const ids = JSON.parse(activeSession.selectedKpiIds ?? '[]')
      return Array.isArray(ids) ? ids : []
    } catch { return [] }
  }, [activeSession])

  const objectiveLabelsStr = objectiveIds
    .map((id) => allFundamentals.find((f) => f.id === id)?.label ?? id)
    .join(', ')
  const activeSubObjective = activeSession?.subObjective

  const [timelineNotes, setTimelineNotes] = useState<TimelineNote[]>([])
  const [kpiScores, setKpiScores] = useState<Record<string, number>>({})
  const [freeText, setFreeText] = useState('')
  const [objectiveRespected, setObjectiveRespected] = useState<boolean | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [biasSignals, setBiasSignals] = useState<ReviewBiasSignal[]>([])
  const [draftAutoSaved, setDraftAutoSaved] = useState(false)
  const warnedBiasKeysRef = useRef<Set<string>>(new Set())

  // If a specific gameId is requested, use it directly; otherwise pick first unreviewed game
  const latestGame = useMemo(() => {
    if (!activeSession) return null
    if (requestedGameId) {
      return activeSession.games.find((g) => g.id === requestedGameId) ?? null
    }
    return (
      activeSession.games.find((g) => !g.review && g.reviewStatus !== 'to_be_reviewed') ??
      activeSession.games.find((g) => !g.review && g.reviewStatus === 'to_be_reviewed') ??
      null
    )
  }, [activeSession, requestedGameId])

  // Draft persistence — must come after latestGame
  const draftKey = latestGame ? `review-draft-${latestGame.id}` : null

  const saveDraft = useCallback(() => {
    if (!draftKey || saved) return
    sessionStorage.setItem(draftKey, JSON.stringify({ timelineNotes, kpiScores, freeText, objectiveRespected }))
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

  if (!activeSession) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4">
        <Swords className="h-12 w-12 text-hextech-text-dim" />
        <h2 className="text-xl font-display font-bold text-hextech-text-bright">{t('review.noSession.title')}</h2>
        <p className="text-sm text-hextech-text">{t('review.noSession.desc')}</p>
        <Button onClick={() => navigate('/session')}>
          <TargetIcon className="h-4 w-4 mr-2" /> {t('review.noSession.button')}
        </Button>
      </div>
    )
  }

  if (saved) {
    return (
      <div className="space-y-6 animate-fade-in">
        <div>
          <h1 className="font-display text-2xl font-bold text-hextech-gold-bright">{t('review.savedTitle')}</h1>
        </div>

        <AISummaryPanel
          type="review"
          data={{ timelineNotes, kpiScores, objective: objectiveLabel }}
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
      <div className="space-y-6 animate-fade-in">
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
              {t('review.gamePlayed', { count: activeSession.games.length })} |{' '}
              {t('review.gameReviewed', { count: activeSession.games.filter((g) => g.review).length })}
            </div>
          </CardContent>
        </Card>

        <div className="rounded-xl border border-hextech-border-dim bg-hextech-elevated/30 p-4 space-y-3">
          <p className="text-sm text-hextech-text-dim text-center">{t('review.waiting.orImport')}</p>
          <MatchHistoryPicker onImported={() => refreshSession()} />
        </div>
      </div>
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
        freeText: freeText || undefined,
        objectiveRespected,
      })

      setSaved(true)
      clearDraft()
      clearGameEndData()
      await refreshSession()

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

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-hextech-gold-bright">{t('review.title')}</h1>
          <p className="text-sm text-hextech-text mt-1">
            {t('review.objective')} <span className="text-hextech-gold">{objectiveLabel}</span>
          </p>
        </div>
        <Badge variant={latestGame.win ? 'success' : 'destructive'} className="text-base px-4 py-1">
          {latestGame.win ? t('review.victory') : t('review.defeat')}
        </Badge>
      </div>

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

      {/* Recording panel */}
      <GameRecordingPanel gameId={latestGame.id} />

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

      <TimelineNoteInput notes={timelineNotes} onChange={setTimelineNotes} objectiveLabel={activeSession.objectiveId} />

      <DynamicKPIForm
        objectiveIds={objectiveIds}
        subObjectiveId={activeSubObjective ?? undefined}
        scores={kpiScores}
        onChange={(kpiId, score) => setKpiScores((prev) => ({ ...prev, [kpiId]: score }))}
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

      {/* Coach comments on this game's review */}
      {latestGame.review && user?.supabaseUid && (
        <CoachComments
          targetType="review"
          targetId={latestGame.review.id}
          studentSupabaseId={user.supabaseUid}
        />
      )}
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
