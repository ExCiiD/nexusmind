import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChampionMatchup } from '@/components/ChampionMatchup'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { useSessionStore } from '@/store/useSessionStore'
import { useUserStore } from '@/store/useUserStore'
import { ObjectiveSuggestionPanel } from '@/components/Coaching/ObjectiveSuggestionPanel'
import { SessionInsightPanel } from '@/components/Coaching/SessionInsightPanel'
import type { Fundamental, FundamentalCategory, KPI } from '@/lib/constants/fundamentals'
import { FundamentalPickerDialog } from '@/components/Session/FundamentalPickerDialog'
import { useLocalizedFundamentals } from '@/lib/constants/useFundamentals'
import {
  Target, Lock, Play, Square, Loader2, X, ChevronRight, ChevronLeft,
  Swords, Eye, Clock, CheckCircle, FileSearch, Trash2, Filter, Zap, History, RotateCcw,
  Ban, Pencil, BookOpen, Sparkles, Share2,
} from 'lucide-react'
import { ShareSessionButton } from '@/components/Share/ShareSessionButton'
import { ShareSessionDialog } from '@/components/Share/ShareSessionDialog'
import type { ShareSessionData } from '@/hooks/useShareSession'
import { useToast } from '@/hooks/useToast'
import { useTranslation } from 'react-i18next'
import { MatchHistoryPicker } from '@/components/Session/MatchHistoryPicker'
import { cn, formatKDA, formatGameTime } from '@/lib/utils'
import { SESSION_TEMPLATES, type SessionTemplate } from '@/lib/constants/sessionTemplates'

type CreationStep = 'objectives' | 'kpis'
type SessionType = 'live' | 'retroactive'

export function SessionPage() {
  const { t } = useTranslation()
  const FUNDAMENTALS = useLocalizedFundamentals()
  const activeSession = useSessionStore((s) => s.activeSession)
  const loadActiveSession = useSessionStore((s) => s.loadActiveSession)
  const createSession = useSessionStore((s) => s.createSession)
  const endSession = useSessionStore((s) => s.endSession)
  const cancelSession = useSessionStore((s) => s.cancelSession)
  const updateSessionStore = useSessionStore((s) => s.updateSession)
  const user = useUserStore((s) => s.user)
  const navigate = useNavigate()
  const { toast } = useToast()

  const [step, setStep] = useState<CreationStep>('objectives')
  const [sessionType, setSessionType] = useState<SessionType>('live')
  const [retroactiveDate, setRetroactiveDate] = useState<string>('')
  const [selectedObjectives, setSelectedObjectives] = useState<string[]>([])
  const [selectedKpiIds, setSelectedKpiIds] = useState<string[]>([])
  const [customNote, setCustomNote] = useState('')
  const [creating, setCreating] = useState(false)
  const [ending, setEnding] = useState(false)
  const [endDialogOpen, setEndDialogOpen] = useState(false)
  const [sessionAnalysis, setSessionAnalysis] = useState('')
  const [pendingShareData, setPendingShareData] = useState<ShareSessionData | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false)
  const [modifyDialogOpen, setModifyDialogOpen] = useState(false)
  const [modifyObjectives, setModifyObjectives] = useState<string[]>([])
  const [modifyNote, setModifyNote] = useState('')
  const [modifyKpiIds, setModifyKpiIds] = useState<string[]>([])
  const [savingModify, setSavingModify] = useState(false)
  const [assessmentScores, setAssessmentScores] = useState<Record<string, number>>({})
  const [queueFilter, setQueueFilter] = useState<'soloq' | 'flex' | 'both'>('both')
  const [updatingQueue, setUpdatingQueue] = useState(false)
  const [lastConfig, setLastConfig] = useState<{
    objectiveIds: string[]
    selectedKpiIds: string[]
    customNote: string
    date: string
  } | null>(null)
  /**
   * Per-objective KPI memory: maps each objective ID to the KPI IDs that were
   * checked the last time that objective was part of a session.
   * Built from the full session history so it works even when an objective
   * wasn't in the most recent session.
   */
  const [kpiMemory, setKpiMemory] = useState<Record<string, string[]>>({})

  useEffect(() => {
    loadActiveSession()
    window.api.getLatestAssessment().then((assessment: any) => {
      if (assessment?.scores) {
        const map: Record<string, number> = {}
        for (const s of assessment.scores) {
          map[s.fundamentalId] = s.score
        }
        setAssessmentScores(map)
      }
    })
    window.api.getUser().then((u: any) => {
      if (u?.queueFilter) setQueueFilter(u.queueFilter as 'soloq' | 'flex' | 'both')
    })
    window.api.getLastSessionConfig().then((cfg) => setLastConfig(cfg)).catch(() => {})
    window.api.getKpiHistory().then((history) => {
      // Build memory map: for each objective, store the KPIs from its most recent session.
      // We iterate sessions newest-first, so the first entry wins per objective.
      const memory: Record<string, string[]> = {}
      for (const session of history) {
        for (const objId of session.objectiveIds) {
          if (memory[objId]) continue // already captured a more recent entry
          memory[objId] = session.selectedKpiIds
        }
      }
      setKpiMemory(memory)
    }).catch(() => {})
  }, [loadActiveSession])

  const allFundamentals = FUNDAMENTALS.flatMap((c) => c.fundamentals)

  // All KPIs for the selected objectives (used in step 2)
  const allKpisForObjectives = useMemo(() => {
    const result: Array<{ objectiveId: string; objectiveLabel: string; kpis: KPI[] }> = []
    for (const objId of selectedObjectives) {
      const f = allFundamentals.find((ff) => ff.id === objId)
      if (!f) continue
      result.push({ objectiveId: f.id, objectiveLabel: f.label, kpis: f.kpis })
    }
    return result
  }, [selectedObjectives, allFundamentals])

  const allKpiIdPool = useMemo(() => allKpisForObjectives.flatMap((o) => o.kpis.map((k) => k.id)), [allKpisForObjectives])

  const addObjective = (id: string) => {
    if (!id || selectedObjectives.includes(id) || selectedObjectives.length >= 3) return
    setSelectedObjectives((prev) => [...prev, id])
  }

  const removeObjective = (id: string) => {
    setSelectedObjectives((prev) => prev.filter((o) => o !== id))
  }

  const selectedLabels = selectedObjectives.map(
    (id) => allFundamentals.find((f) => f.id === id)?.label ?? id,
  )

  const handleGoToKpis = () => {
    /**
     * Determine which KPIs to check when entering step 2:
     * 1. Already explicitly selected → keep (user already made a choice this round).
     * 2. Objective has prior history in kpiMemory → restore the last-used KPI selection.
     * 3. Objective has never been used before → check all (original default).
     * Removed objectives are excluded because we iterate over allKpiIdPool (current pool only).
     */
    const newSelection = allKpiIdPool.filter((kpiId) => {
      if (selectedKpiIds.includes(kpiId)) return true
      const parentObj = allKpisForObjectives.find((o) => o.kpis.some((k) => k.id === kpiId))
      if (!parentObj) return false
      const remembered = kpiMemory[parentObj.objectiveId]
      if (remembered) {
        return remembered.includes(kpiId)
      }
      return true // never used before: check all by default
    })
    setSelectedKpiIds(newSelection)
    setStep('kpis')
  }

  const toggleKpi = (kpiId: string) => {
    setSelectedKpiIds((prev) =>
      prev.includes(kpiId) ? prev.filter((id) => id !== kpiId) : [...prev, kpiId],
    )
  }

  /**
   * Pre-fill objectives, KPIs and comment from the last completed session,
   * then jump straight to the KPI review step so the user can modify before starting.
   */
  const handlePrefill = () => {
    if (!lastConfig) return
    const validObjectives = lastConfig.objectiveIds.filter((id) =>
      allFundamentals.some((f) => f.id === id),
    ).slice(0, 3)
    setSelectedObjectives(validObjectives)

    // Compute the KPI pool for those objectives and keep only IDs that still exist
    const kpiPool = allFundamentals
      .filter((f) => validObjectives.includes(f.id))
      .flatMap((f) => f.kpis.map((k) => k.id))
    const validKpis = lastConfig.selectedKpiIds.filter((id) => kpiPool.includes(id))
    setSelectedKpiIds(validKpis.length > 0 ? validKpis : kpiPool)

    setCustomNote(lastConfig.customNote)
    setStep('kpis')
  }

  const handleApplyTemplate = (tpl: SessionTemplate) => {
    const validObjectives = tpl.objectiveIds
      .filter((id) => allFundamentals.some((f) => f.id === id))
      .slice(0, 3)
    setSelectedObjectives(validObjectives)

    const kpiPool = allFundamentals
      .filter((f) => validObjectives.includes(f.id))
      .flatMap((f) => f.kpis.map((k) => k.id))
    const validKpis = tpl.selectedKpiIds.filter((id) => kpiPool.includes(id))
    setSelectedKpiIds(validKpis.length > 0 ? validKpis : kpiPool)

    setCustomNote(tpl.customNote)
    setStep('kpis')
  }

  const handleApplyTemplateToModify = (tpl: SessionTemplate) => {
    const validObjectives = tpl.objectiveIds
      .filter((id) => allFundamentals.some((f) => f.id === id))
      .slice(0, 3)
    setModifyObjectives(validObjectives)

    const kpiPool = allFundamentals
      .filter((f) => validObjectives.includes(f.id))
      .flatMap((f) => f.kpis.map((k) => k.id))
    const validKpis = tpl.selectedKpiIds.filter((id) => kpiPool.includes(id))
    setModifyKpiIds(validKpis.length > 0 ? validKpis : kpiPool)

    setModifyNote(tpl.customNote)
  }

  const handleCreate = async () => {
    if (selectedObjectives.length === 0) return
    setCreating(true)
    try {
      const isRetroactive = sessionType === 'retroactive'
      await createSession({
        objectiveId: selectedObjectives[0],
        objectiveIds: selectedObjectives,
        selectedKpiIds,
        customNote: customNote || undefined,
        isRetroactive,
        date: isRetroactive && retroactiveDate ? retroactiveDate : undefined,
      })
      toast({
        title: t('session.toast.startedTitle'),
        description: t('session.toast.startedDesc', { label: selectedLabels.join(', ') }),
        variant: 'gold',
      })
    } catch (err: any) {
      toast({ title: t('session.toast.startError'), description: err.message, variant: 'destructive' })
    } finally {
      setCreating(false)
    }
  }

  const handleEnd = () => {
    setSessionAnalysis('')
    setEndDialogOpen(true)
  }

  const doEndSession = async (conclusion?: string) => {
    setEnding(true)
    setEndDialogOpen(false)
    try {
      await endSession(conclusion || undefined)
      toast({ title: t('session.toast.endedTitle'), description: t('session.toast.endedDesc'), variant: 'success' })
      navigate('/analytics')
    } catch (err: any) {
      toast({ title: t('session.toast.endError'), description: err.message, variant: 'destructive' })
    } finally {
      setEnding(false)
    }
  }

  const doEndAndShare = async (conclusion?: string) => {
    if (!activeSession) return
    setEnding(true)
    setEndDialogOpen(false)
    try {
      await endSession(conclusion || undefined)
      // Build share data snapshot before navigating away
      const wins = activeSession.games.filter((g) => g.win).length
      const losses = activeSession.games.length - wins
      let objectiveIds: string[] = []
      try { objectiveIds = JSON.parse(activeSession.objectiveIds) } catch { objectiveIds = [activeSession.objectiveId] }
      let selectedKpiIds: string[] = []
      try { selectedKpiIds = JSON.parse(activeSession.selectedKpiIds) } catch { /* ignore */ }
      const gamesWithStats = activeSession.games.filter((g) => g.kills !== undefined)
      const avgKDA = gamesWithStats.length > 0
        ? gamesWithStats.reduce((s, g) => s + (g.deaths > 0 ? (g.kills + g.assists) / g.deaths : g.kills + g.assists), 0) / gamesWithStats.length
        : undefined
      const avgCSPerMin = gamesWithStats.length > 0
        ? gamesWithStats.reduce((s, g) => s + (g.duration > 0 ? g.cs / (g.duration / 60) : 0), 0) / gamesWithStats.length
        : undefined
      setPendingShareData({
        objectiveId: activeSession.objectiveId,
        objectiveIds,
        selectedKpiIds,
        subObjective: activeSession.subObjective,
        customNote: activeSession.customNote,
        date: activeSession.date,
        wins,
        losses,
        gamesPlayed: activeSession.games.length,
        avgKDA,
        avgCSPerMin,
        aiSummary: activeSession.aiSummary,
        sessionConclusion: conclusion || activeSession.sessionConclusion,
        games: activeSession.games.map((g) => ({
          champion: g.champion,
          opponentChampion: g.opponentChampion,
          win: g.win,
          kills: g.kills,
          deaths: g.deaths,
          assists: g.assists,
          cs: g.cs,
          visionScore: g.visionScore,
          duration: g.duration,
          gameEndAt: g.gameEndAt,
          review: g.review
            ? { kpiScores: g.review.kpiScores, freeText: g.review.freeText, aiSummary: g.review.aiSummary, timelineNotes: g.review.timelineNotes }
            : null,
        })),
      })
    } catch (err: any) {
      toast({ title: t('session.toast.endError'), description: err.message, variant: 'destructive' })
    } finally {
      setEnding(false)
    }
  }

  const handleQueueFilterChange = async (value: 'soloq' | 'flex' | 'both') => {
    setQueueFilter(value)
    setUpdatingQueue(true)
    try {
      await window.api.updateUser({ queueFilter: value })
    } catch {
      // non-critical
    } finally {
      setUpdatingQueue(false)
    }
  }

  const handleCancelSession = async () => {
    setCancelling(true)
    setCancelDialogOpen(false)
    try {
      await cancelSession()
      toast({ title: t('session.toast.cancelledTitle', { defaultValue: 'Session cancelled' }), description: t('session.toast.cancelledDesc', { defaultValue: 'Session and all linked games have been removed.' }), variant: 'success' })
    } catch (err: any) {
      toast({ title: t('session.toast.cancelError', { defaultValue: 'Error' }), description: err.message, variant: 'destructive' })
    } finally {
      setCancelling(false)
    }
  }

  const openModifyDialog = () => {
    if (!activeSession) return
    let objIds: string[] = []
    try { objIds = JSON.parse(activeSession.objectiveIds) } catch { objIds = [activeSession.objectiveId] }
    let kpiIds: string[] = []
    try { kpiIds = JSON.parse(activeSession.selectedKpiIds ?? '[]') } catch { /* ignore */ }
    setModifyObjectives(objIds)
    setModifyKpiIds(kpiIds)
    setModifyNote(activeSession.customNote ?? '')
    setModifyDialogOpen(true)
  }

  const modifyAddObjective = (id: string) => {
    if (!id || modifyObjectives.includes(id) || modifyObjectives.length >= 3) return
    setModifyObjectives((prev) => [...prev, id])
  }

  const modifyRemoveObjective = (id: string) => {
    setModifyObjectives((prev) => prev.filter((o) => o !== id))
    setModifyKpiIds((prev) => {
      const kpisOfRemoved = allFundamentals.find((f) => f.id === id)?.kpis.map((k) => k.id) ?? []
      return prev.filter((k) => !kpisOfRemoved.includes(k))
    })
  }

  const modifyToggleKpi = (kpiId: string) => {
    setModifyKpiIds((prev) =>
      prev.includes(kpiId) ? prev.filter((id) => id !== kpiId) : [...prev, kpiId],
    )
  }

  const modifyKpisForObjectives = useMemo(() => {
    const result: Array<{ objectiveId: string; objectiveLabel: string; kpis: KPI[] }> = []
    for (const objId of modifyObjectives) {
      const f = allFundamentals.find((ff) => ff.id === objId)
      if (!f) continue
      result.push({ objectiveId: f.id, objectiveLabel: f.label, kpis: f.kpis })
    }
    return result
  }, [modifyObjectives, allFundamentals])

  const handleSaveModify = async () => {
    if (modifyObjectives.length === 0) return
    setSavingModify(true)
    try {
      await updateSessionStore({
        objectiveIds: modifyObjectives,
        selectedKpiIds: modifyKpiIds,
        customNote: modifyNote,
      })
      setModifyDialogOpen(false)
      toast({ title: t('session.toast.modifiedTitle', { defaultValue: 'Session updated' }), variant: 'gold' })
    } catch (err: any) {
      toast({ title: t('session.toast.modifyError', { defaultValue: 'Error' }), description: err.message, variant: 'destructive' })
    } finally {
      setSavingModify(false)
    }
  }

  if (activeSession) {
    const objIds: string[] = (() => {
      try { return JSON.parse(activeSession.objectiveIds) } catch { return [activeSession.objectiveId] }
    })()
    const objLabels = objIds.map((id) => allFundamentals.find((f) => f.id === id)?.label ?? id)

    return (
      <div className="space-y-4 animate-fade-in">
        <div>
          <h1 className="font-display text-2xl font-bold text-hextech-gold-bright">{t('session.activeTitle')}</h1>
          <p className="text-sm text-hextech-text mt-1">{t('session.activeLock')}</p>
        </div>

        <Card className="border-hextech-green/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lock className="h-5 w-5 text-hextech-green" />
              {t('session.objectiveLabel')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {objLabels.map((label, i) => (
                <Badge key={i} variant="gold" className="text-sm px-3 py-1">
                  {label}
                </Badge>
              ))}
            </div>
            {activeSession.customNote && (
              <p className="text-sm text-hextech-text italic">"{activeSession.customNote}"</p>
            )}
            <div className="text-sm text-hextech-text">
              {t('session.gamesPlayed')} {activeSession.games.length} |{' '}
              {t('session.reviewsCompleted')} {activeSession.games.filter((g) => g.review).length}
            </div>

            <div className="flex gap-3 pt-2 flex-wrap items-center">
              <Button onClick={() => navigate('/review')}>
                <Play className="h-4 w-4 mr-2" />
                {t('session.reviewLatest')}
              </Button>
              <Button variant="outline" onClick={handleEnd} disabled={ending}>
                {ending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Square className="h-4 w-4 mr-2" />}
                {t('session.endSession')}
              </Button>
              <Button variant="outline" onClick={openModifyDialog}>
                <Pencil className="h-4 w-4 mr-2" />
                {t('session.modifySession', { defaultValue: 'Modify' })}
              </Button>
              <Button
                variant="outline"
                onClick={() => setCancelDialogOpen(true)}
                disabled={cancelling}
                className="border-[#FF4655]/40 text-[#FF4655] hover:bg-[#FF4655]/10"
              >
                {cancelling ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Ban className="h-4 w-4 mr-2" />}
                {t('session.cancelSession', { defaultValue: 'Cancel Session' })}
              </Button>
              {activeSession.games.length > 0 && (() => {
                const wins = activeSession.games.filter((g) => g.win).length
                const losses = activeSession.games.length - wins
                let objectiveIds: string[] = []
                try { objectiveIds = JSON.parse(activeSession.objectiveIds) } catch { objectiveIds = [activeSession.objectiveId] }
                let selectedKpiIds: string[] = []
                try { selectedKpiIds = JSON.parse(activeSession.selectedKpiIds) } catch { /* ignore */ }
                return (
                  <ShareSessionButton
                    data={{
                      objectiveId: activeSession.objectiveId,
                      objectiveIds,
                      selectedKpiIds,
                      subObjective: activeSession.subObjective,
                      customNote: activeSession.customNote,
                      date: activeSession.date,
                      wins,
                      losses,
                      gamesPlayed: activeSession.games.length,
                      aiSummary: activeSession.aiSummary,
                      sessionConclusion: activeSession.sessionConclusion,
                      games: activeSession.games.map((g) => ({
                        champion: g.champion,
                        opponentChampion: g.opponentChampion,
                        win: g.win,
                        kills: g.kills,
                        deaths: g.deaths,
                        assists: g.assists,
                        cs: g.cs,
                        visionScore: g.visionScore,
                        duration: g.duration,
                        gameEndAt: g.gameEndAt,
                        review: g.review
                          ? { kpiScores: g.review.kpiScores, freeText: g.review.freeText, aiSummary: g.review.aiSummary, timelineNotes: g.review.timelineNotes }
                          : null,
                      })),
                    }}
                  />
                )
              })()}
            </div>

            <div className="border-t border-hextech-border-dim pt-3 mt-1">
              <MatchHistoryPicker onImported={loadActiveSession} />
            </div>
          </CardContent>
        </Card>

        {/* Game list */}
        <ActiveSessionGameList sessionId={activeSession.id} games={activeSession.games} onRefresh={loadActiveSession} />

        {activeSession.games.length > 0 && (
          <SessionInsightPanel
            games={activeSession.games}
            objectiveIds={activeSession.objectiveIds}
            selectedKpiIds={activeSession.selectedKpiIds}
          />
        )}

        {/* End session analysis dialog */}
        {endDialogOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="w-full max-w-lg mx-4 rounded-xl border border-hextech-border bg-hextech-dark shadow-2xl space-y-4 p-6">
              <div>
                <h2 className="font-display text-lg font-bold text-hextech-gold-bright">{t('session.endDialog.title')}</h2>
                <p className="text-xs text-hextech-text-dim mt-1">{t('session.endDialog.subtitle')}</p>
              </div>
              <Textarea
                placeholder={t('session.endDialog.placeholder')}
                value={sessionAnalysis}
                onChange={(e) => setSessionAnalysis(e.target.value)}
                className="min-h-[140px] resize-none bg-hextech-elevated border-hextech-border text-hextech-text placeholder:text-hextech-text-dim"
              />
              <div className="flex gap-3 justify-between">
                <Button variant="outline" onClick={() => setEndDialogOpen(false)} disabled={ending}>
                  {t('session.endDialog.cancel')}
                </Button>
                <div className="flex gap-3">
                  <Button variant="ghost" onClick={() => doEndSession()} disabled={ending}>
                    {t('session.endDialog.skip')}
                  </Button>
                  <Button variant="outline" onClick={() => doEndAndShare(sessionAnalysis || undefined)} disabled={ending}>
                    {ending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Share2 className="h-4 w-4 mr-2" />}
                    {t('session.endDialog.confirmAndShare')}
                  </Button>
                  <Button onClick={() => doEndSession(sessionAnalysis || undefined)} disabled={ending}>
                    {ending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Square className="h-4 w-4 mr-2" />}
                    {t('session.endDialog.confirm')}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Cancel session confirmation dialog */}
        {cancelDialogOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="w-full max-w-md mx-4 rounded-xl border border-[#FF4655]/40 bg-hextech-dark shadow-2xl space-y-4 p-6">
              <div>
                <h2 className="font-display text-lg font-bold text-[#FF4655]">
                  {t('session.cancelDialog.title', { defaultValue: 'Cancel Session?' })}
                </h2>
                <p className="text-sm text-hextech-text mt-2">
                  {t('session.cancelDialog.description', {
                    defaultValue: 'This will permanently delete this session and all linked games and reviews. This action cannot be undone.',
                  })}
                </p>
                {activeSession.games.length > 0 && (
                  <p className="text-sm text-[#FF4655] mt-2 font-medium">
                    {t('session.cancelDialog.gamesWarning', {
                      count: activeSession.games.length,
                      defaultValue: `${activeSession.games.length} game(s) will be deleted.`,
                    })}
                  </p>
                )}
              </div>
              <div className="flex gap-3 justify-end">
                <Button variant="outline" onClick={() => setCancelDialogOpen(false)}>
                  {t('session.cancelDialog.back', { defaultValue: 'Go Back' })}
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleCancelSession}
                  disabled={cancelling}
                >
                  {cancelling ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Ban className="h-4 w-4 mr-2" />}
                  {t('session.cancelDialog.confirm', { defaultValue: 'Cancel Session' })}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Modify session dialog */}
        {modifyDialogOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="w-full max-w-xl mx-4 rounded-xl border border-hextech-border bg-hextech-dark shadow-2xl space-y-4 p-6 max-h-[80vh] overflow-y-auto">
              <div>
                <h2 className="font-display text-lg font-bold text-hextech-gold-bright">
                  {t('session.modifyDialog.title', { defaultValue: 'Modify Session' })}
                </h2>
                <p className="text-xs text-hextech-text-dim mt-1">
                  {t('session.modifyDialog.subtitle', { defaultValue: 'Change objectives, KPIs, or your session note.' })}
                </p>
              </div>

              {/* Apply template */}
              <ModifyTemplateDropdown
                allFundamentals={allFundamentals}
                onApply={handleApplyTemplateToModify}
              />

              {/* Objectives */}
              <div className="space-y-2">
                <Label className="text-hextech-text-bright text-sm">
                  {t('session.modifyDialog.objectives', { defaultValue: 'Objectives' })}
                  <span className="text-hextech-text-dim ml-1">({modifyObjectives.length}/3)</span>
                </Label>
                <div className="flex flex-wrap gap-2">
                  {modifyObjectives.map((id) => {
                    const label = allFundamentals.find((f) => f.id === id)?.label ?? id
                    return (
                      <Badge key={id} variant="gold" className="text-sm px-3 py-1 gap-1.5">
                        {label}
                        <button
                          onClick={() => modifyRemoveObjective(id)}
                          className="hover:text-[#FF4655] transition-colors"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    )
                  })}
                </div>
                <FundamentalPickerDialog
                  FUNDAMENTALS={FUNDAMENTALS}
                  allFundamentals={allFundamentals}
                  selectedObjectives={modifyObjectives}
                  assessmentScores={assessmentScores}
                  onSelect={modifyAddObjective}
                  disabled={modifyObjectives.length >= 3}
                />
              </div>

              {/* KPIs */}
              {modifyKpisForObjectives.length > 0 && (
                <div className="space-y-3">
                  <Label className="text-hextech-text-bright text-sm">
                    {t('session.modifyDialog.kpis', { defaultValue: 'KPIs' })}
                  </Label>
                  {modifyKpisForObjectives.map((group) => (
                    <div key={group.objectiveId} className="space-y-1.5">
                      <p className="text-xs font-semibold text-hextech-gold">{group.objectiveLabel}</p>
                      <div className="flex flex-wrap gap-2">
                        {group.kpis.map((kpi) => {
                          const isChecked = modifyKpiIds.includes(kpi.id)
                          return (
                            <button
                              key={kpi.id}
                              onClick={() => modifyToggleKpi(kpi.id)}
                              className={cn(
                                'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                                isChecked
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

              {/* Note */}
              <div className="space-y-2">
                <Label className="text-hextech-text-bright text-sm">
                  {t('session.modifyDialog.note', { defaultValue: 'Note / Comment' })}
                </Label>
                <Textarea
                  placeholder={t('session.modifyDialog.notePlaceholder', { defaultValue: 'What do you want to focus on?' })}
                  value={modifyNote}
                  onChange={(e) => setModifyNote(e.target.value)}
                  className="min-h-[80px] resize-none bg-hextech-elevated border-hextech-border text-hextech-text placeholder:text-hextech-text-dim"
                />
              </div>

              <div className="flex gap-3 justify-end pt-2">
                <Button variant="outline" onClick={() => setModifyDialogOpen(false)}>
                  {t('session.modifyDialog.cancel', { defaultValue: 'Cancel' })}
                </Button>
                <Button onClick={handleSaveModify} disabled={savingModify || modifyObjectives.length === 0}>
                  {savingModify ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Pencil className="h-4 w-4 mr-2" />}
                  {t('session.modifyDialog.save', { defaultValue: 'Save Changes' })}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4 animate-fade-in">
      <div>
        <h1 className="font-display text-2xl font-bold text-hextech-gold-bright">{t('session.newSession')}</h1>
        <p className="text-sm text-hextech-text mt-1">{t('session.chooseDesc')}</p>
      </div>

      {/* Queue Filter */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-4 p-4">
          <div className="flex items-center gap-2 text-sm text-hextech-text-bright">
            <Filter className="h-4 w-4 text-hextech-gold" />
            <span className="font-medium">{t('session.queueFilter.title')}</span>
          </div>
          <div className="flex gap-2">
            {(['soloq', 'flex', 'both'] as const).map((val) => (
              <button
                key={val}
                onClick={() => handleQueueFilterChange(val)}
                disabled={updatingQueue}
                className={cn(
                  'rounded-md border px-3 py-1 text-xs font-medium transition-colors',
                  queueFilter === val
                    ? 'border-hextech-gold bg-hextech-gold/10 text-hextech-gold-bright'
                    : 'border-hextech-border-dim text-hextech-text-dim hover:border-hextech-border hover:text-hextech-text',
                )}
              >
                {t(`session.queueFilter.${val}`)}
              </button>
            ))}
          </div>
          <p className="text-xs text-hextech-text-dim">{t('session.queueFilter.desc')}</p>
        </CardContent>
      </Card>

      {/* "Same as last session" prefill banner */}
      {lastConfig && (
        <Card className="border-hextech-gold/30 bg-hextech-gold/5">
          <CardContent className="flex items-center justify-between gap-4 p-4">
            <div className="flex items-start gap-3 min-w-0">
              <RotateCcw className="mt-0.5 h-4 w-4 shrink-0 text-hextech-gold" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-hextech-gold-bright">
                  Reprendre la dernière session
                </p>
                <p className="truncate text-xs text-hextech-text-dim mt-0.5">
                  {lastConfig.objectiveIds
                    .map((id) => allFundamentals.find((f) => f.id === id)?.label ?? id)
                    .join(' · ')}
                  {lastConfig.customNote ? ` — ${lastConfig.customNote}` : ''}
                </p>
              </div>
            </div>
            <Button size="sm" variant="outline" onClick={handlePrefill} className="shrink-0 border-hextech-gold/40 text-hextech-gold hover:bg-hextech-gold/10">
              Utiliser
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Templates */}
      {step === 'objectives' && (
        <TemplatePickerSection
          allFundamentals={allFundamentals}
          onApply={handleApplyTemplate}
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          {step === 'objectives' ? (
            <ObjectiveStep
              FUNDAMENTALS={FUNDAMENTALS}
              allFundamentals={allFundamentals}
              selectedObjectives={selectedObjectives}
              assessmentScores={assessmentScores}
              addObjective={addObjective}
              removeObjective={removeObjective}
              onNext={handleGoToKpis}
              sessionType={sessionType}
              setSessionType={setSessionType}
              retroactiveDate={retroactiveDate}
              setRetroactiveDate={setRetroactiveDate}
            />
          ) : (
            <KpiSelectionStep
              allKpisForObjectives={allKpisForObjectives}
              selectedKpiIds={selectedKpiIds}
              allKpiIdPool={allKpiIdPool}
              customNote={customNote}
              setCustomNote={setCustomNote}
              toggleKpi={toggleKpi}
              setSelectedKpiIds={setSelectedKpiIds}
              onBack={() => setStep('objectives')}
              onCreate={handleCreate}
              creating={creating}
              sessionType={sessionType}
            />
          )}
        </div>

        <div>
          <ObjectiveSuggestionPanel assessmentScores={assessmentScores} />
        </div>
      </div>

      {/* Post-end share dialog */}
      {pendingShareData && (
        <ShareSessionDialog
          data={pendingShareData}
          open={true}
          onClose={() => { setPendingShareData(null); navigate('/analytics') }}
        />
      )}
    </div>
  )
}

// ─── Step 1: Objective Selection ─────────────────────────────────────────────

function ObjectiveStep({
  FUNDAMENTALS,
  allFundamentals,
  selectedObjectives,
  assessmentScores,
  addObjective,
  removeObjective,
  onNext,
  sessionType,
  setSessionType,
  retroactiveDate,
  setRetroactiveDate,
}: {
  FUNDAMENTALS: FundamentalCategory[]
  allFundamentals: Fundamental[]
  selectedObjectives: string[]
  assessmentScores: Record<string, number>
  addObjective: (id: string) => void
  removeObjective: (id: string) => void
  onNext: () => void
  sessionType: SessionType
  setSessionType: (t: SessionType) => void
  retroactiveDate: string
  setRetroactiveDate: (d: string) => void
}) {
  const { t } = useTranslation()

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Target className="h-5 w-5" />
          {t('session.chooseTitle')}
        </CardTitle>
        <CardDescription>{t('session.chooseFull')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Session type selector */}
        <div className="space-y-2">
          <Label>{t('session.sessionType.title')}</Label>
          <div className="grid grid-cols-2 gap-3">
            {(['live', 'retroactive'] as SessionType[]).map((type) => (
              <button
                key={type}
                onClick={() => setSessionType(type)}
                className={cn(
                  'flex flex-col items-start gap-1.5 rounded-lg border p-3 text-left transition-all',
                  sessionType === type
                    ? 'border-hextech-gold bg-hextech-gold/10'
                    : 'border-hextech-border-dim hover:border-hextech-border',
                )}
              >
                <div className="flex items-center gap-2">
                  {type === 'live'
                    ? <Zap className="h-4 w-4 text-hextech-gold" />
                    : <History className="h-4 w-4 text-hextech-teal" />
                  }
                  <span className={cn(
                    'text-sm font-semibold',
                    sessionType === type ? 'text-hextech-gold-bright' : 'text-hextech-text',
                  )}>
                    {t(`session.sessionType.${type}`)}
                  </span>
                </div>
                <p className="text-[11px] text-hextech-text-dim leading-tight">
                  {t(`session.sessionType.${type}Desc`)}
                </p>
              </button>
            ))}
          </div>

          {sessionType === 'retroactive' && (
            <div className="space-y-1.5 pt-1">
              <Label className="text-xs">{t('session.sessionType.dateLabel')}</Label>
              <input
                type="date"
                value={retroactiveDate}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setRetroactiveDate(e.target.value)}
                className="w-full rounded-md border border-hextech-border-dim bg-hextech-elevated px-3 py-2 text-sm text-hextech-text focus:outline-none focus:border-hextech-gold"
              />
            </div>
          )}
        </div>
        {selectedObjectives.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {selectedObjectives.map((id) => {
              const f = allFundamentals.find((ff) => ff.id === id)
              return (
                <Badge key={id} variant="gold" className="flex items-center gap-1 pr-1 text-sm">
                  {f?.label ?? id}
                  <button
                    onClick={() => removeObjective(id)}
                    className="ml-1 rounded-full hover:bg-hextech-gold/20 p-0.5 transition-colors"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              )
            })}
            <span className="text-xs text-hextech-text-dim self-center">
              {selectedObjectives.length}/3
            </span>
          </div>
        )}

        <FundamentalPickerDialog
          FUNDAMENTALS={FUNDAMENTALS}
          allFundamentals={allFundamentals}
          selectedObjectives={selectedObjectives}
          assessmentScores={assessmentScores}
          onSelect={addObjective}
          disabled={selectedObjectives.length >= 3}
        />

        {selectedObjectives.length > 0 && (
          <div className="space-y-2">
            {selectedObjectives.map((id) => {
              const f = allFundamentals.find((ff) => ff.id === id)
              if (!f) return null
              return (
                <div key={id} className="rounded-md bg-hextech-elevated p-3 text-sm text-hextech-text">
                  <span className="font-medium text-hextech-gold text-xs">{f.label}</span>
                  <p className="mt-0.5">{f.description}</p>
                </div>
              )
            })}
          </div>
        )}

        <Button
          onClick={onNext}
          disabled={selectedObjectives.length === 0}
          className="w-full"
        >
          {t('session.kpiSelection.title')}
          <ChevronRight className="h-4 w-4 ml-2" />
        </Button>
      </CardContent>
    </Card>
  )
}

// ─── Step 2: KPI Selection ────────────────────────────────────────────────────

function KpiSelectionStep({
  allKpisForObjectives,
  selectedKpiIds,
  allKpiIdPool,
  customNote,
  setCustomNote,
  toggleKpi,
  setSelectedKpiIds,
  onBack,
  onCreate,
  creating,
  sessionType,
}: {
  allKpisForObjectives: Array<{ objectiveId: string; objectiveLabel: string; kpis: KPI[] }>
  selectedKpiIds: string[]
  allKpiIdPool: string[]
  customNote: string
  setCustomNote: (v: string) => void
  toggleKpi: (id: string) => void
  setSelectedKpiIds: (ids: string[]) => void
  onBack: () => void
  onCreate: () => void
  creating: boolean
  sessionType: SessionType
}) {
  const { t } = useTranslation()

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Lock className="h-5 w-5" />
          {t('session.kpiSelection.title')}
        </CardTitle>
        <CardDescription>{t('session.kpiSelection.desc')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {allKpisForObjectives.map(({ objectiveId, objectiveLabel, kpis }) => {
          const allSelected = kpis.every((k) => selectedKpiIds.includes(k.id))

          return (
            <div key={objectiveId} className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-hextech-gold uppercase tracking-wide">
                  {objectiveLabel}
                </span>
                <button
                  onClick={() => {
                    if (allSelected) {
                      setSelectedKpiIds(selectedKpiIds.filter((id) => !kpis.map((k) => k.id).includes(id)))
                    } else {
                      const newIds = new Set([...selectedKpiIds, ...kpis.map((k) => k.id)])
                      setSelectedKpiIds([...newIds])
                    }
                  }}
                  className="text-xs text-hextech-text-dim hover:text-hextech-text transition-colors"
                >
                  {allSelected ? t('session.kpiSelection.deselectAll') : t('session.kpiSelection.selectAll')}
                </button>
              </div>

              <div className="space-y-1">
                {kpis.map((kpi) => {
                  const isSelected = selectedKpiIds.includes(kpi.id)
                  return (
                    <button
                      key={kpi.id}
                      onClick={() => toggleKpi(kpi.id)}
                      className={cn(
                        'w-full text-left rounded-md border px-3 py-2 text-sm transition-all',
                        isSelected
                          ? 'border-hextech-gold/50 bg-hextech-gold/10 text-hextech-text-bright'
                          : 'border-hextech-border-dim text-hextech-text-dim hover:border-hextech-border hover:text-hextech-text',
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <div className={cn(
                          'h-4 w-4 rounded border flex items-center justify-center shrink-0',
                          isSelected ? 'bg-hextech-gold border-hextech-gold' : 'border-hextech-border',
                        )}>
                          {isSelected && <span className="text-black text-[10px] font-bold">✓</span>}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-medium text-xs">{kpi.label}</span>
                            {kpi.priority && (
                              <span className="text-[9px] font-semibold uppercase tracking-wide text-hextech-gold border border-hextech-gold/40 rounded px-1 py-0 leading-4">
                                priorité
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-hextech-text-dim leading-tight mt-0.5">{kpi.description}</div>
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}

        <div className="text-xs text-hextech-text-dim pt-1">
          {t('session.kpiSelection.selected', { count: selectedKpiIds.length })}
        </div>

        <div className="space-y-2">
          <Label>{t('session.note')}</Label>
          <Textarea
            placeholder={t('session.notePlaceholder')}
            value={customNote}
            onChange={(e) => setCustomNote(e.target.value)}
            maxLength={500}
          />
        </div>

        <div className="flex gap-3">
          <Button variant="outline" onClick={onBack} className="gap-2">
            <ChevronLeft className="h-4 w-4" />
            {t('session.fundamental')}
          </Button>
          <Button
            onClick={onCreate}
            disabled={selectedKpiIds.length === 0 || creating}
            className="flex-1"
          >
            {creating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Lock className="h-4 w-4 mr-2" />}
            {sessionType === 'retroactive' ? t('session.startRetroButton') : t('session.startButton')}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Template Picker (Creation Flow) ──────────────────────────────────────────

function TemplatePickerSection({
  allFundamentals,
  onApply,
}: {
  allFundamentals: Fundamental[]
  onApply: (tpl: SessionTemplate) => void
}) {
  const { t, i18n } = useTranslation()
  const isFr = i18n.language.startsWith('fr')
  const [expanded, setExpanded] = useState(false)

  const visible = expanded ? SESSION_TEMPLATES : SESSION_TEMPLATES.slice(0, 4)

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <BookOpen className="h-4 w-4 text-hextech-gold" />
          {t('session.templates.title', { defaultValue: 'Session Templates' })}
        </CardTitle>
        <CardDescription className="text-xs">
          {t('session.templates.desc', { defaultValue: 'Start with a pre-built coaching template — objectives, KPIs and focus note are pre-filled.' })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {visible.map((tpl) => {
            const objectiveLabels = tpl.objectiveIds
              .map((id) => allFundamentals.find((f) => f.id === id)?.label ?? id)
              .slice(0, 3)
            return (
              <button
                key={tpl.id}
                onClick={() => onApply(tpl)}
                className="flex flex-col items-start gap-1.5 rounded-lg border border-hextech-border-dim p-3 text-left transition-all hover:border-hextech-gold/50 hover:bg-hextech-gold/5 group"
              >
                <div className="flex items-center gap-2 w-full">
                  <Sparkles className="h-3.5 w-3.5 text-hextech-gold shrink-0" />
                  <span className="text-sm font-semibold text-hextech-text-bright truncate">
                    {isFr ? tpl.nameFr : tpl.name}
                  </span>
                </div>
                <p className="text-[11px] text-hextech-text-dim leading-tight line-clamp-2">
                  {isFr ? tpl.descriptionFr : tpl.description}
                </p>
                <div className="flex flex-wrap gap-1 mt-0.5">
                  {objectiveLabels.map((label) => (
                    <span
                      key={label}
                      className="rounded-full border border-hextech-gold/30 bg-hextech-gold/5 px-2 py-0 text-[10px] text-hextech-gold"
                    >
                      {label}
                    </span>
                  ))}
                </div>
              </button>
            )
          })}
        </div>

        {SESSION_TEMPLATES.length > 4 && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-xs text-hextech-text-dim hover:text-hextech-gold transition-colors flex items-center gap-1 mx-auto"
          >
            {expanded
              ? t('session.templates.showLess', { defaultValue: 'Show less' })
              : t('session.templates.showAll', { defaultValue: `Show all ${SESSION_TEMPLATES.length} templates` })}
            <ChevronRight className={cn('h-3 w-3 transition-transform', expanded && 'rotate-90')} />
          </button>
        )}
      </CardContent>
    </Card>
  )
}

// ─── Template Dropdown (Modify Dialog) ────────────────────────────────────────

function ModifyTemplateDropdown({
  allFundamentals,
  onApply,
}: {
  allFundamentals: Fundamental[]
  onApply: (tpl: SessionTemplate) => void
}) {
  const { i18n } = useTranslation()
  const isFr = i18n.language.startsWith('fr')
  const [open, setOpen] = useState(false)

  return (
    <div className="space-y-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 text-xs text-hextech-text-dim hover:text-hextech-gold transition-colors"
      >
        <BookOpen className="h-3.5 w-3.5" />
        {isFr ? 'Appliquer un template' : 'Apply a template'}
        <ChevronRight className={cn('h-3 w-3 transition-transform', open && 'rotate-90')} />
      </button>

      {open && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto rounded-lg border border-hextech-border-dim p-2 bg-hextech-elevated/50">
          {SESSION_TEMPLATES.map((tpl) => (
            <button
              key={tpl.id}
              onClick={() => {
                onApply(tpl)
                setOpen(false)
              }}
              className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-hextech-gold/10 group"
            >
              <Sparkles className="h-3 w-3 text-hextech-gold shrink-0" />
              <span className="text-hextech-text-bright group-hover:text-hextech-gold-bright truncate">
                {isFr ? tpl.nameFr : tpl.name}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Active Session Game List ─────────────────────────────────────────────────

function ActiveSessionGameList({
  sessionId,
  games,
  onRefresh,
}: {
  sessionId: string
  games: any[]
  onRefresh: () => void
}) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const navigate = useNavigate()
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [statusUpdatingId, setStatusUpdatingId] = useState<string | null>(null)

  if (games.length === 0) return null

  const handleDelete = async (gameId: string) => {
    setDeletingId(gameId)
    try {
      await window.api.deleteGame(gameId)
      onRefresh()
      setConfirmId(null)
    } catch (err: any) {
      toast({ title: t('history.deleteGame'), description: err.message, variant: 'destructive' })
    } finally {
      setDeletingId(null)
    }
  }

  const handleReviewLater = async (gameId: string) => {
    setStatusUpdatingId(gameId)
    try {
      await window.api.setGameReviewStatus(gameId, 'to_be_reviewed')
      onRefresh()
      toast({ title: t('review.toast.reviewLaterTitle'), variant: 'gold' })
    } catch (err: any) {
      toast({ title: t('review.toast.errorTitle'), description: err.message, variant: 'destructive' })
    } finally {
      setStatusUpdatingId(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('session.gamesList.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {games.map((game, idx) => {
          const csPerMin = game.duration > 0 ? (game.cs / (game.duration / 60)).toFixed(1) : '0'

          return (
            <div
              key={game.id}
              className={cn(
                'rounded-md border p-3 transition-colors',
                game.win ? 'border-hextech-green/20 bg-hextech-green/5' : 'border-[#FF4655]/20 bg-[#FF4655]/5',
              )}
            >
              <div className="flex items-center gap-3">
                <span className="text-xs text-hextech-text-dim w-5 shrink-0">#{games.length - idx}</span>

                <Badge variant={game.win ? 'success' : 'destructive'} className="shrink-0">
                  {game.win ? t('history.win') : t('history.loss')}
                </Badge>

                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <ChampionMatchup
                    playerChampion={game.champion}
                    opponentChampion={game.opponentChampion}
                    size="sm"
                  />
                  <div className="flex flex-col min-w-0">
                    <div className="flex items-center gap-1">
                      <span className="font-medium text-sm text-hextech-text-bright truncate">{game.champion}</span>
                      <span className="text-xs text-hextech-text-dim shrink-0">{game.role}</span>
                    </div>
                    {game.opponentChampion && (
                      <span className="text-[10px] text-hextech-text-dim truncate">vs {game.opponentChampion}</span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3 text-xs text-hextech-text shrink-0">
                  <span className="flex items-center gap-1">
                    <Swords className="h-3 w-3" />
                    {formatKDA(game.kills, game.deaths, game.assists)}
                  </span>
                  <span>{game.cs} CS ({csPerMin}/m)</span>
                  <span className="flex items-center gap-1">
                    <Eye className="h-3 w-3" />
                    {game.visionScore}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {formatGameTime(game.duration)}
                  </span>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {game.review ? (
                    <button
                      onClick={() => navigate(`/review?gameId=${game.id}`)}
                      className="flex items-center gap-1 rounded-full border border-hextech-green/50 bg-hextech-green/5 px-2 py-0.5 text-[10px] text-hextech-green hover:bg-hextech-green/15 transition-colors"
                    >
                      <CheckCircle className="h-3 w-3" />
                      {t('history.gamesTab.reviewed')}
                    </button>
                  ) : game.reviewStatus === 'to_be_reviewed' ? (
                    <button
                      onClick={() => navigate(`/review?gameId=${game.id}`)}
                      className="flex items-center gap-1 rounded-full border border-hextech-cyan/50 bg-hextech-cyan/5 px-2 py-0.5 text-[10px] text-hextech-cyan hover:bg-hextech-cyan/15 transition-colors"
                    >
                      <Clock className="h-3 w-3" />
                      {t('history.gamesTab.toBeReviewed')}
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={() => navigate(`/review?gameId=${game.id}`)}
                        className="flex items-center gap-1 rounded-full border border-hextech-gold/40 bg-hextech-gold/5 px-2 py-0.5 text-[10px] text-hextech-gold hover:bg-hextech-gold/15 transition-colors"
                      >
                        <FileSearch className="h-3 w-3" />
                        {t('history.gamesTab.unreviewed')}
                      </button>
                      <button
                        onClick={() => handleReviewLater(game.id)}
                        disabled={statusUpdatingId === game.id}
                        className="flex items-center gap-1 rounded-full border border-hextech-cyan/40 bg-hextech-cyan/5 px-2 py-0.5 text-[10px] text-hextech-cyan hover:bg-hextech-cyan/15 transition-colors disabled:opacity-60"
                      >
                        {statusUpdatingId === game.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Clock className="h-3 w-3" />}
                        {t('review.reviewLater')}
                      </button>
                    </>
                  )}

                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs gap-1 text-hextech-text-dim hover:text-hextech-gold"
                    onClick={() => navigate(`/stats/${game.matchId}`)}
                  >
                    Stats
                  </Button>

                  {confirmId === game.id ? (
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="destructive"
                        className="h-6 px-2 text-[10px]"
                        onClick={() => handleDelete(game.id)}
                        disabled={deletingId === game.id}
                      >
                        {deletingId === game.id ? <Loader2 className="h-3 w-3 animate-spin" /> : t('session.gamesList.deleteConfirm')}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-[10px]"
                        onClick={() => setConfirmId(null)}
                      >
                        {t('session.gamesList.deleteCancel')}
                      </Button>
                    </div>
                  ) : (
                    <button
                      className="text-hextech-text-dim hover:text-[#FF4655] transition-colors"
                      title={t('session.gamesList.delete')}
                      onClick={() => setConfirmId(game.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
