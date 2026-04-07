import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChampionMatchup } from '@/components/ChampionMatchup'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useSessionStore } from '@/store/useSessionStore'
import { useUserStore } from '@/store/useUserStore'
import { AISuggestionPanel } from '@/components/AIPanel/AISuggestionPanel'
import { AISummaryPanel } from '@/components/AIPanel/AISummaryPanel'
import type { Fundamental, FundamentalCategory, KPI } from '@/lib/constants/fundamentals'
import { useLocalizedFundamentals } from '@/lib/constants/useFundamentals'
import {
  Target, Lock, Play, Square, Loader2, X, ChevronRight, ChevronLeft,
  Swords, Eye, Clock, CheckCircle, FileSearch, Trash2, Filter, Zap, History,
} from 'lucide-react'
import { ShareSessionButton } from '@/components/Share/ShareSessionButton'
import { useToast } from '@/hooks/useToast'
import { useTranslation } from 'react-i18next'
import { MatchHistoryPicker } from '@/components/Session/MatchHistoryPicker'
import { cn, formatKDA, formatGameTime } from '@/lib/utils'

type CreationStep = 'objectives' | 'kpis'
type SessionType = 'live' | 'retroactive'

export function SessionPage() {
  const { t } = useTranslation()
  const FUNDAMENTALS = useLocalizedFundamentals()
  const activeSession = useSessionStore((s) => s.activeSession)
  const loadActiveSession = useSessionStore((s) => s.loadActiveSession)
  const createSession = useSessionStore((s) => s.createSession)
  const endSession = useSessionStore((s) => s.endSession)
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
  const [assessmentScores, setAssessmentScores] = useState<Record<string, number>>({})
  const [queueFilter, setQueueFilter] = useState<'soloq' | 'flex' | 'both'>('both')
  const [updatingQueue, setUpdatingQueue] = useState(false)

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
    // Default: all KPIs selected
    setSelectedKpiIds(allKpiIdPool)
    setStep('kpis')
  }

  const toggleKpi = (kpiId: string) => {
    setSelectedKpiIds((prev) =>
      prev.includes(kpiId) ? prev.filter((id) => id !== kpiId) : [...prev, kpiId],
    )
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
    // If the session has no AI summary yet, prompt the user for a manual analysis
    if (!activeSession?.aiSummary) {
      setSessionAnalysis('')
      setEndDialogOpen(true)
    } else {
      doEndSession()
    }
  }

  const doEndSession = async (summary?: string) => {
    setEnding(true)
    setEndDialogOpen(false)
    try {
      await endSession(summary || undefined)
      toast({ title: t('session.toast.endedTitle'), description: t('session.toast.endedDesc'), variant: 'success' })
      navigate('/analytics')
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

  if (activeSession) {
    const objIds: string[] = (() => {
      try { return JSON.parse(activeSession.objectiveIds) } catch { return [activeSession.objectiveId] }
    })()
    const objLabels = objIds.map((id) => allFundamentals.find((f) => f.id === id)?.label ?? id)

    return (
      <div className="space-y-6 animate-fade-in">
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
          <AISummaryPanel type="session" data={{ sessionId: activeSession.id }} />
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
                  <Button onClick={() => doEndSession(sessionAnalysis || undefined)} disabled={ending}>
                    {ending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Square className="h-4 w-4 mr-2" />}
                    {t('session.endDialog.confirm')}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in">
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
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
          <AISuggestionPanel scores={assessmentScores} />
        </div>
      </div>
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

        <div className="space-y-2">
          <Label>
            {t('session.fundamental')}
            {selectedObjectives.length >= 3 && (
              <span className="ml-2 text-xs text-hextech-text-dim">({t('session.maxReached')})</span>
            )}
          </Label>
          <Select value="" onValueChange={addObjective} disabled={selectedObjectives.length >= 3}>
            <SelectTrigger>
              <SelectValue placeholder={t('session.fundamentalPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {FUNDAMENTALS.map((cat: FundamentalCategory) => (
                <div key={cat.id}>
                  <div className="px-2 py-1.5 text-xs font-semibold text-hextech-gold">{cat.label}</div>
                  {cat.fundamentals.map((f: Fundamental) => (
                    <SelectItem
                      key={f.id}
                      value={f.id}
                      disabled={selectedObjectives.includes(f.id)}
                    >
                      <span className={cn(selectedObjectives.includes(f.id) && 'opacity-50')}>
                        {f.label}
                        {assessmentScores[f.id] != null && (
                          <span className="ml-2 text-hextech-text-dim">({assessmentScores[f.id]}/10)</span>
                        )}
                      </span>
                    </SelectItem>
                  ))}
                </div>
              ))}
            </SelectContent>
          </Select>
        </div>

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
                        <div>
                          <div className="font-medium text-xs">{kpi.label}</div>
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
