import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { useGameStore } from '@/store/useGameStore'
import { useUserStore } from '@/store/useUserStore'
import { ProgressChart } from '@/components/Charts/ProgressChart'
import { ScoreTrendChart } from '@/components/Charts/ScoreTrendChart'
import { WinrateChart } from '@/components/Charts/WinrateChart'
import { BadgeDisplay } from '@/components/Gamification/BadgeDisplay'
import { XPBar } from '@/components/Gamification/XPBar'
import { StreakCounter } from '@/components/Gamification/StreakCounter'
import { Badge } from '@/components/ui/badge'
import { useLocalizedFundamental, useLocalizedFundamentals } from '@/lib/constants/useFundamentals'
import { formatKDA, formatGameTime } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { TrendingUp, History, Award, BarChart3, Filter, Calendar, ClipboardList, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

const LS_TAB_KEY = 'analytics_tab'
const LS_FILTER_KEY = 'analytics_filter_fundamentals'
const LS_PERIOD_KEY = 'analytics_time_period'
const LS_TREND_FILTER_KEY = 'analytics_trend_filter_fundamentals'

type TimePeriod = 'all' | '90d' | '30d'

function GameObjectiveLabel({ objectiveId }: { objectiveId: string }) {
  const f = useLocalizedFundamental(objectiveId)
  return <>{f?.label || objectiveId}</>
}

export function AnalyticsPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const user = useUserStore((s) => s.user)
  const stats = useGameStore((s) => s.stats)
  const progressData = useGameStore((s) => s.progressData)
  const kpiTimeline = useGameStore((s) => s.kpiTimeline)
  const gameHistory = useGameStore((s) => s.gameHistory)
  const loadStats = useGameStore((s) => s.loadStats)
  const loadProgressData = useGameStore((s) => s.loadProgressData)
  const loadKpiTimeline = useGameStore((s) => s.loadKpiTimeline)
  const loadGameHistory = useGameStore((s) => s.loadGameHistory)
  const FUNDAMENTALS = useLocalizedFundamentals()

  const [userBadges, setUserBadges] = useState<string[]>([])
  const [showObjectiveFilter, setShowObjectiveFilter] = useState(false)
  const [dataLoaded, setDataLoaded] = useState(false)
  const [showTrendFilter, setShowTrendFilter] = useState(false)
  /** When true the trend chart shows live session KPI data in addition to bilans */
  const [trendShowLive, setTrendShowLive] = useState(false)
  type SessionCountOption = 'current' | 'last' | '3' | '5' | '10' | 'all'
  const [sessionCount, setSessionCount] = useState<SessionCountOption>('all')

  // --- Progress chart filter (chart 1) ---
  const [selectedFundamentalIds, setSelectedFundamentalIdsRaw] = useState<string[] | null>(() => {
    try {
      const saved = localStorage.getItem(LS_FILTER_KEY)
      if (!saved) return null
      const parsed = JSON.parse(saved)
      return Array.isArray(parsed) ? parsed : null
    } catch { return null }
  })

  // --- Trend chart filter (chart 2) — independent state ---
  const [trendSelectedIds, setTrendSelectedIdsRaw] = useState<string[] | null>(() => {
    try {
      const saved = localStorage.getItem(LS_TREND_FILTER_KEY)
      if (!saved) return null
      const parsed = JSON.parse(saved)
      return Array.isArray(parsed) ? parsed : null
    } catch { return null }
  })

  // Persisted tab — initialise from localStorage
  const [activeTab, setActiveTabRaw] = useState<string>(() => {
    return localStorage.getItem(LS_TAB_KEY) ?? 'progress'
  })

  // Persisted time period filter (applies to chart 1 only)
  const [timePeriod, setTimePeriodRaw] = useState<TimePeriod>(() => {
    return (localStorage.getItem(LS_PERIOD_KEY) as TimePeriod) ?? 'all'
  })

  const setSelectedFundamentalIds = (ids: string[] | null) => {
    setSelectedFundamentalIdsRaw(ids)
    if (ids === null) localStorage.removeItem(LS_FILTER_KEY)
    else localStorage.setItem(LS_FILTER_KEY, JSON.stringify(ids))
  }

  const setTrendSelectedIds = (ids: string[] | null) => {
    setTrendSelectedIdsRaw(ids)
    if (ids === null) localStorage.removeItem(LS_TREND_FILTER_KEY)
    else localStorage.setItem(LS_TREND_FILTER_KEY, JSON.stringify(ids))
  }

  const setActiveTab = (tab: string) => {
    setActiveTabRaw(tab)
    localStorage.setItem(LS_TAB_KEY, tab)
  }

  const setTimePeriod = (p: TimePeriod) => {
    setTimePeriodRaw(p)
    localStorage.setItem(LS_PERIOD_KEY, p)
  }

  useEffect(() => {
    Promise.all([
      loadStats(),
      loadProgressData(),
      loadKpiTimeline(),
      loadGameHistory(20),
      window.api.getBadges().then(setUserBadges).catch(() => {}),
    ]).finally(() => setDataLoaded(true))
  }, [loadStats, loadProgressData, loadKpiTimeline, loadGameHistory])

  // KPI timeline mapped to the same shape as progressData points
  const kpiPoints = useMemo(
    () => kpiTimeline.map((p) => ({ date: p.date, fundamentalId: p.objectiveId, score: p.avgScore })),
    [kpiTimeline],
  )

  // Chart 1 (Skill Progress): assessment bilans + session KPI data, time-period filtered
  const mergedProgressData = useMemo(() => [...progressData, ...kpiPoints], [progressData, kpiPoints])
  const periodFilteredData = useMemo(() => {
    if (timePeriod === 'all') return mergedProgressData
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - (timePeriod === '90d' ? 90 : 30))
    return mergedProgressData.filter((p) => new Date(p.date) >= cutoff)
  }, [mergedProgressData, timePeriod])

  // Chart 2: data source for filter-dot visibility
  const trendSourceData = useMemo(
    () => (trendShowLive ? mergedProgressData : progressData),
    [trendShowLive, mergedProgressData, progressData],
  )

  // All fundamental IDs across the full FUNDAMENTALS constant (not just those with data)
  const allFundamentalIds = useMemo(
    () => FUNDAMENTALS.flatMap((cat) => cat.fundamentals.map((f) => f.id)),
    [FUNDAMENTALS],
  )

  // For chart 1: fundamentals that have data in the current period
  const fundamentalsWithData = useMemo(
    () => new Set(periodFilteredData.map((d) => d.fundamentalId)),
    [periodFilteredData],
  )

  // For chart 2: fundamentals that have data in the trend source
  const trendFundamentalsWithData = useMemo(
    () => new Set(trendSourceData.map((d) => d.fundamentalId)),
    [trendSourceData],
  )

  // Chart 1 displayed IDs
  const displayedFundamentalIds = selectedFundamentalIds ?? allFundamentalIds
  // Chart 2 displayed IDs (independent filter)
  const trendDisplayedIds = trendSelectedIds ?? allFundamentalIds

  /**
   * Individual fundamental toggle:
   * - First click when everything shown: ISOLATE to this one fundamental.
   * - Subsequent clicks: add/remove normally.
   */
  const toggleFundamental = (id: string) => {
    if (selectedFundamentalIds === null) {
      setSelectedFundamentalIds([id])
      return
    }
    const next = selectedFundamentalIds.includes(id)
      ? selectedFundamentalIds.filter((x) => x !== id)
      : [...selectedFundamentalIds, id]
    setSelectedFundamentalIds(next.length === 0 ? null : next)
  }

  /**
   * Category group toggle (chart 1):
   * - First click when everything shown: ISOLATE to this category's fundamentals.
   * - If category already isolated: add/remove the whole category.
   */
  const toggleCategory = (catFundIds: string[]) => {
    if (selectedFundamentalIds === null) {
      setSelectedFundamentalIds(catFundIds)
      return
    }
    const allActive = catFundIds.every((id) => selectedFundamentalIds.includes(id))
    if (allActive) {
      const next = selectedFundamentalIds.filter((id) => !catFundIds.includes(id))
      setSelectedFundamentalIds(next.length === 0 ? null : next)
    } else {
      setSelectedFundamentalIds([...new Set([...selectedFundamentalIds, ...catFundIds])])
    }
  }

  /** Individual fundamental toggle for chart 2 (same isolate-first logic) */
  const toggleTrendFundamental = (id: string) => {
    if (trendSelectedIds === null) { setTrendSelectedIds([id]); return }
    const next = trendSelectedIds.includes(id)
      ? trendSelectedIds.filter((x) => x !== id)
      : [...trendSelectedIds, id]
    setTrendSelectedIds(next.length === 0 ? null : next)
  }

  /** Category toggle for chart 2 */
  const toggleTrendCategory = (catFundIds: string[]) => {
    if (trendSelectedIds === null) { setTrendSelectedIds(catFundIds); return }
    const allActive = catFundIds.every((id) => trendSelectedIds.includes(id))
    if (allActive) {
      const next = trendSelectedIds.filter((id) => !catFundIds.includes(id))
      setTrendSelectedIds(next.length === 0 ? null : next)
    } else {
      setTrendSelectedIds([...new Set([...trendSelectedIds, ...catFundIds])])
    }
  }

  if (!user) return null

  // Show loading state while data is being fetched
  if (!dataLoaded) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-hextech-gold" />
      </div>
    )
  }

  // Gate: no assessment means no data — block access and redirect to bilan
  if (progressData.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-6 py-24 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full border border-hextech-gold/30 bg-hextech-gold/10">
          <ClipboardList className="h-8 w-8 text-hextech-gold" />
        </div>
        <div className="space-y-2">
          <h2 className="font-display text-xl font-bold text-hextech-gold-bright">
            Bilan initial requis
          </h2>
          <p className="max-w-sm text-sm text-hextech-text-dim leading-relaxed">
            Avant d'accéder aux statistiques, tu dois compléter ton premier bilan de compétences.
            Cela permettra à NexusMind de suivre ta progression dans le temps.
          </p>
        </div>
        <Button onClick={() => navigate('/assessment')} className="gap-2">
          <ClipboardList className="h-4 w-4" />
          Faire mon bilan maintenant
        </Button>
      </div>
    )
  }

  const latestScores = getLatestScores(periodFilteredData)
  const previousScores = getPreviousScores(periodFilteredData)

  const filteredLatestScores: Record<string, number> = {}
  const filteredPreviousScores: Record<string, number> = {}
  for (const id of displayedFundamentalIds) {
    if (latestScores[id] != null) filteredLatestScores[id] = latestScores[id]
    if (previousScores[id] != null) filteredPreviousScores[id] = previousScores[id]
  }

  // Chart 2 — computed independently
  // "Bilans": latest bilan (gold) vs previous bilan (grey)
  // "Sessions": avg session objective scores (gold) vs latest bilan (grey), filtered by session count
  const filteredKpiPoints = (() => {
    if (!trendShowLive) return []
    const sessionDates = [...new Set(kpiPoints.map((p) => p.date))].sort()
    if (sessionCount === 'all') return kpiPoints
    if (sessionCount === 'current') {
      const latest = sessionDates[sessionDates.length - 1]
      return latest ? kpiPoints.filter((p) => p.date === latest) : []
    }
    if (sessionCount === 'last') {
      const prev = sessionDates.length >= 2 ? sessionDates[sessionDates.length - 2] : sessionDates[sessionDates.length - 1]
      return prev ? kpiPoints.filter((p) => p.date === prev) : []
    }
    const n = parseInt(sessionCount, 10)
    const recentDates = new Set(sessionDates.slice(-n))
    return kpiPoints.filter((p) => recentDates.has(p.date))
  })()

  const scoreTrendData = (() => {
    if (trendShowLive) {
      const bilanLatest = getLatestScores(progressData)
      const sessionAvg: Record<string, number> = {}
      const sessionCnts: Record<string, number> = {}
      for (const p of filteredKpiPoints) {
        sessionAvg[p.fundamentalId] = (sessionAvg[p.fundamentalId] ?? 0) + p.score
        sessionCnts[p.fundamentalId] = (sessionCnts[p.fundamentalId] ?? 0) + 1
      }
      for (const id of Object.keys(sessionAvg)) {
        sessionAvg[id] = Number((sessionAvg[id] / sessionCnts[id]).toFixed(2))
      }
      const objectiveIds = new Set(Object.keys(sessionAvg))
      return trendDisplayedIds
        .filter((id) => objectiveIds.has(id))
        .map((id) => ({
          label: id,
          score: sessionAvg[id],
          previousScore: bilanLatest[id],
        }))
    }
    const bilanLatest = getLatestScores(progressData)
    const bilanPrevious = getPreviousScores(progressData)
    return trendDisplayedIds
      .filter((id) => bilanLatest[id] != null)
      .map((id) => ({
        label: id,
        score: bilanLatest[id],
        previousScore: bilanPrevious[id],
      }))
  })()

  return (
    <div className="space-y-4 animate-fade-in">
      <div>
        <h1 className="font-display text-2xl font-bold text-hextech-gold-bright">{t('analytics.title')}</h1>
        <p className="text-sm text-hextech-text mt-1">{t('analytics.subtitle')}</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="progress">
            <TrendingUp className="h-4 w-4 mr-1" /> {t('analytics.tabs.progress')}
          </TabsTrigger>
          <TabsTrigger value="history">
            <History className="h-4 w-4 mr-1" /> {t('analytics.tabs.gameHistory')}
          </TabsTrigger>
          <TabsTrigger value="badges">
            <Award className="h-4 w-4 mr-1" /> {t('analytics.tabs.achievements')}
          </TabsTrigger>
          <TabsTrigger value="stats">
            <BarChart3 className="h-4 w-4 mr-1" /> {t('analytics.tabs.stats')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="progress" className="space-y-4">
          {/* Filter bar: time period + objective filter */}
          <Card>
            <CardContent className="p-3 space-y-3">
              {/* Time period row */}
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-hextech-text-dim shrink-0" />
                <span className="text-xs text-hextech-text-dim mr-1">Period</span>
                {(['all', '90d', '30d'] as TimePeriod[]).map((p) => (
                  <button
                    key={p}
                    onClick={() => setTimePeriod(p)}
                    className={cn(
                      'rounded-full border px-3 py-0.5 text-xs font-medium transition-colors',
                      timePeriod === p
                        ? 'border-hextech-gold bg-hextech-gold/10 text-hextech-gold-bright'
                        : 'border-hextech-border-dim text-hextech-text-dim hover:border-hextech-border',
                    )}
                  >
                    {p === 'all' ? 'All time' : p === '90d' ? 'Last 90 days' : 'Last 30 days'}
                  </button>
                ))}
              </div>

              {/* Objective filter toggle header */}
              <button
                className="flex items-center gap-2 text-sm text-hextech-text-dim hover:text-hextech-text transition-colors"
                onClick={() => setShowObjectiveFilter((v) => !v)}
              >
                <Filter className="h-4 w-4" />
                <span>{t('analytics.objectiveFilter.label')}</span>
                {selectedFundamentalIds !== null && (
                  <Badge variant="gold" className="text-[10px] h-5 px-2">
                    {selectedFundamentalIds.filter((id) => fundamentalsWithData.has(id)).length} with data
                    {selectedFundamentalIds.length > selectedFundamentalIds.filter((id) => fundamentalsWithData.has(id)).length
                      ? ` + ${selectedFundamentalIds.length - selectedFundamentalIds.filter((id) => fundamentalsWithData.has(id)).length} empty`
                      : ''}
                  </Badge>
                )}
              </button>

              {showObjectiveFilter && (
                <div className="space-y-3">
                  {/* "All" reset button */}
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => setSelectedFundamentalIds(null)}
                      className={cn(
                        'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                        selectedFundamentalIds === null
                          ? 'border-hextech-gold bg-hextech-gold/10 text-hextech-gold-bright'
                          : 'border-hextech-border-dim text-hextech-text-dim hover:border-hextech-border',
                      )}
                    >
                      {t('analytics.objectiveFilter.all')}
                    </button>
                  </div>

                  {/* Categories with their fundamentals */}
                  {FUNDAMENTALS.map((cat) => {
                    const catFundIds = cat.fundamentals.map((f) => f.id)
                    const catWithData = catFundIds.filter((id) => fundamentalsWithData.has(id))
                    const allCatActive = catFundIds.every((id) => displayedFundamentalIds.includes(id))
                    return (
                      <div key={cat.id} className="space-y-1.5">
                        {/* Category header — click isolates to this category */}
                        <button
                          onClick={() => toggleCategory(catFundIds)}
                          className={cn(
                            'rounded-full border px-3 py-0.5 text-[11px] font-semibold uppercase tracking-wide transition-colors',
                            allCatActive && selectedFundamentalIds !== null
                              ? 'border-hextech-cyan bg-hextech-cyan/10 text-hextech-cyan'
                              : selectedFundamentalIds === null
                                ? 'border-hextech-border-dim text-hextech-text-dim hover:border-hextech-border'
                                : 'border-hextech-border-dim text-hextech-text-dim hover:border-hextech-border',
                          )}
                        >
                          {cat.label}
                          {catWithData.length > 0 && (
                            <span className="ml-1.5 text-hextech-gold opacity-70">●</span>
                          )}
                        </button>
                        {/* Individual fundamentals in this category */}
                        <div className="flex flex-wrap gap-1.5 pl-2">
                          {cat.fundamentals.map((f) => {
                            const isActive = displayedFundamentalIds.includes(f.id)
                            const hasData = fundamentalsWithData.has(f.id)
                            return (
                              <button
                                key={f.id}
                                onClick={() => toggleFundamental(f.id)}
                                className={cn(
                                  'rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors',
                                  isActive && hasData
                                    ? 'border-hextech-gold bg-hextech-gold/10 text-hextech-gold-bright'
                                    : isActive && !hasData
                                      ? 'border-hextech-border text-hextech-text-dim'
                                      : 'border-hextech-border-dim text-hextech-text-dim opacity-40 hover:opacity-70',
                                )}
                                title={hasData ? undefined : 'No data for this period'}
                              >
                                {f.label}
                                {hasData && <span className="ml-1 text-hextech-gold/60">●</span>}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('analytics.charts.skillProgress')}</CardTitle>
            </CardHeader>
            <CardContent>
              <ProgressChart data={periodFilteredData} fundamentalIds={displayedFundamentalIds} />
            </CardContent>
          </Card>

          {/* Chart 2: Bilan comparison or Session objectives vs Bilan */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <CardTitle>
                  {trendShowLive ? t('analytics.charts.sessionVsBilan') : t('analytics.charts.currentVsPrevious')}
                </CardTitle>
                <div className="flex items-center gap-2">
                  {/* Mode toggle: Bilans / Sessions */}
                  <div className="flex rounded-full border border-hextech-border-dim overflow-hidden">
                    <button
                      onClick={() => setTrendShowLive(false)}
                      className={cn(
                        'px-3 py-1 text-xs font-medium transition-colors',
                        !trendShowLive
                          ? 'bg-hextech-gold/15 text-hextech-gold-bright'
                          : 'text-hextech-text-dim hover:text-hextech-text',
                      )}
                    >
                      {t('analytics.charts.modeBilan')}
                    </button>
                    <button
                      onClick={() => setTrendShowLive(true)}
                      className={cn(
                        'px-3 py-1 text-xs font-medium transition-colors',
                        trendShowLive
                          ? 'bg-hextech-cyan/15 text-hextech-cyan'
                          : 'text-hextech-text-dim hover:text-hextech-text',
                      )}
                    >
                      {t('analytics.charts.modeSession')}
                    </button>
                  </div>
                  {/* Session count selector (only in session mode) */}
                  {trendShowLive && (
                    <div className="flex rounded-full border border-hextech-border-dim overflow-hidden">
                      {([
                        ['current', t('analytics.charts.sessionCount_current')],
                        ['last', t('analytics.charts.sessionCount_last')],
                        ['3', t('analytics.charts.sessionCount_n', { count: 3 })],
                        ['5', t('analytics.charts.sessionCount_n', { count: 5 })],
                        ['10', t('analytics.charts.sessionCount_n', { count: 10 })],
                        ['all', t('analytics.charts.sessionCount_all')],
                      ] as const).map(([val, label]) => (
                        <button
                          key={val}
                          onClick={() => setSessionCount(val as SessionCountOption)}
                          className={cn(
                            'px-2 py-1 text-[10px] font-medium transition-colors',
                            sessionCount === val
                              ? 'bg-hextech-cyan/15 text-hextech-cyan'
                              : 'text-hextech-text-dim hover:text-hextech-text',
                          )}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  )}
                  {/* Filter toggle */}
                  <button
                    className="flex items-center gap-1.5 text-xs text-hextech-text-dim hover:text-hextech-text transition-colors"
                    onClick={() => setShowTrendFilter((v) => !v)}
                  >
                    <Filter className="h-3.5 w-3.5" />
                    <span>Filtre</span>
                    {trendSelectedIds !== null && (
                      <Badge variant="gold" className="text-[10px] h-5 px-2">
                        {trendSelectedIds.filter((id) => trendFundamentalsWithData.has(id)).length}
                      </Badge>
                    )}
                  </button>
                </div>
              </div>

              {/* Inline filter panel for chart 2 */}
              {showTrendFilter && (
                <div className="mt-3 space-y-3 border-t border-hextech-border-dim pt-3">
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => setTrendSelectedIds(null)}
                      className={cn(
                        'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                        trendSelectedIds === null
                          ? 'border-hextech-gold bg-hextech-gold/10 text-hextech-gold-bright'
                          : 'border-hextech-border-dim text-hextech-text-dim hover:border-hextech-border',
                      )}
                    >
                      Tous
                    </button>
                  </div>
                  {FUNDAMENTALS.map((cat) => {
                    const catFundIds = cat.fundamentals.map((f) => f.id)
                    const allCatActive = catFundIds.every((id) => trendDisplayedIds.includes(id))
                    return (
                      <div key={cat.id} className="space-y-1.5">
                        <button
                          onClick={() => toggleTrendCategory(catFundIds)}
                          className={cn(
                            'rounded-full border px-3 py-0.5 text-[11px] font-semibold uppercase tracking-wide transition-colors',
                            allCatActive && trendSelectedIds !== null
                              ? 'border-hextech-cyan bg-hextech-cyan/10 text-hextech-cyan'
                              : 'border-hextech-border-dim text-hextech-text-dim hover:border-hextech-border',
                          )}
                        >
                          {cat.label}
                          {catFundIds.some((id) => trendFundamentalsWithData.has(id)) && (
                            <span className="ml-1.5 text-hextech-gold opacity-70">●</span>
                          )}
                        </button>
                        <div className="flex flex-wrap gap-1.5 pl-2">
                          {cat.fundamentals.map((f) => {
                            const isActive = trendDisplayedIds.includes(f.id)
                            const hasData = trendFundamentalsWithData.has(f.id)
                            return (
                              <button
                                key={f.id}
                                onClick={() => toggleTrendFundamental(f.id)}
                                className={cn(
                                  'rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors',
                                  isActive && hasData
                                    ? 'border-hextech-gold bg-hextech-gold/10 text-hextech-gold-bright'
                                    : isActive && !hasData
                                      ? 'border-hextech-border text-hextech-text-dim'
                                      : 'border-hextech-border-dim text-hextech-text-dim opacity-40 hover:opacity-70',
                                )}
                                title={hasData ? undefined : 'Aucune donnée'}
                              >
                                {f.label}
                                {hasData && <span className="ml-1 text-hextech-gold/60">●</span>}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardHeader>
            <CardContent>
              <ScoreTrendChart
                data={scoreTrendData}
                scoreName={trendShowLive ? t('charts.sessionAvg') : t('charts.latestBilan')}
                previousScoreName={trendShowLive ? t('charts.latestBilan') : t('charts.previousBilan')}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history" className="space-y-4">
          {gameHistory.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-hextech-text-dim">
                {t('analytics.charts.noGames')}
              </CardContent>
            </Card>
          ) : (
            gameHistory.map((game: any) => (
              <Card key={game.id}>
                <CardContent className="flex items-center gap-4 p-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-hextech-text-bright">{game.champion}</span>
                      <Badge variant={game.win ? 'success' : 'destructive'}>
                        {game.win ? t('history.win') : t('history.loss')}
                      </Badge>
                      <span className="text-xs text-hextech-text-dim">{game.role}</span>
                    </div>
                    <div className="text-sm text-hextech-text mt-1">
                      {formatKDA(game.kills, game.deaths, game.assists)} | {t('analytics.game.cs')} {game.cs} | {t('analytics.game.vision')} {game.visionScore} | {formatGameTime(game.duration)}
                    </div>
                    {game.objectiveId && (
                      <div className="text-xs text-hextech-gold mt-1">
                        {t('analytics.game.objective')} <GameObjectiveLabel objectiveId={game.objectiveId} />
                      </div>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-hextech-text-dim">
                      {new Date(game.gameEndAt).toLocaleDateString()}
                    </div>
                    {game.review && (
                      <Badge variant="outline" className="mt-1">
                        {game.review.objectiveRespected ? t('analytics.game.objSuccess') : t('analytics.game.objFail')}
                      </Badge>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="badges" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{t('analytics.achievementsTitle')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <BadgeDisplay unlockedBadgeIds={userBadges} />
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t('analytics.xp')}</CardTitle>
              </CardHeader>
              <CardContent>
                <XPBar totalXp={user.xp} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t('analytics.streak')}</CardTitle>
              </CardHeader>
              <CardContent>
                <StreakCounter days={user.streakDays} />
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="stats" className="space-y-4">
          {stats && stats.totalGames > 0 ? (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <StatCard label={t('analytics.statsLabels.totalGames')} value={stats.totalGames.toString()} />
                <StatCard label={t('analytics.statsLabels.avgKda')} value={stats.avgKDA.toFixed(2)} />
                <StatCard label={t('analytics.statsLabels.avgCsMin')} value={stats.avgCSPerMin.toFixed(1)} />
                <StatCard label={t('analytics.statsLabels.avgVision')} value={stats.avgVisionScore.toFixed(1)} />
                <StatCard label={t('analytics.statsLabels.objSuccess')} value={`${stats.objectiveSuccessRate}%`} />
                <StatCard label={t('analytics.statsLabels.sessions')} value={(stats as any).sessionsCompleted?.toString() ?? '0'} />
              </div>
              <Card>
                <CardHeader>
                  <CardTitle>{t('analytics.statsLabels.winRate')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <WinrateChart wins={stats.wins} losses={stats.losses} />
                </CardContent>
              </Card>
            </>
          ) : (
            <Card>
              <CardContent className="py-12 text-center text-hextech-text-dim">
                {t('analytics.charts.noStats')}
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4 text-center">
        <div className="text-2xl font-bold text-hextech-gold-bright">{value}</div>
        <div className="text-xs text-hextech-text mt-1">{label}</div>
      </CardContent>
    </Card>
  )
}

function getLatestScores(data: any[]): Record<string, number> {
  const scores: Record<string, number> = {}
  const dates = [...new Set(data.map((d) => d.date))].sort()
  const latestDate = dates[dates.length - 1]
  if (!latestDate) return scores

  for (const point of data) {
    if (point.date === latestDate) {
      scores[point.fundamentalId] = point.score
    }
  }
  return scores
}

function getPreviousScores(data: any[]): Record<string, number> {
  const scores: Record<string, number> = {}
  const dates = [...new Set(data.map((d) => d.date))].sort()
  if (dates.length < 2) return scores
  const prevDate = dates[dates.length - 2]

  for (const point of data) {
    if (point.date === prevDate) {
      scores[point.fundamentalId] = point.score
    }
  }
  return scores
}
