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
import { TrendingUp, History, Award, BarChart3, Calendar, ClipboardList, Loader2, Info } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { FundamentalFilter } from './FundamentalFilter'
import { ProgressSummary } from './ProgressSummary'

const LS_TAB_KEY = 'analytics_tab'
const LS_FILTER_KEY = 'analytics_filter_fundamentals'
const LS_PERIOD_KEY = 'analytics_time_period'
const LS_TREND_FILTER_KEY = 'analytics_trend_filter_fundamentals'

type TimePeriod = 'all' | '90d' | '30d'
type SessionCountOption = 'current' | 'last' | '3' | '5' | '10' | 'all'

function GameObjectiveLabel({ objectiveId }: { objectiveId: string }) {
  const f = useLocalizedFundamental(objectiveId)
  return <>{f?.label || objectiveId}</>
}

function readIds(key: string): string[] | null {
  try {
    const saved = localStorage.getItem(key)
    if (!saved) return null
    const parsed = JSON.parse(saved)
    return Array.isArray(parsed) ? parsed : null
  } catch { return null }
}

/** Small "how to read this" line under a chart title. */
function ChartHint({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-1 flex items-start gap-1.5 text-xs text-hextech-text-dim">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />{children}
    </p>
  )
}

/** Labelled segmented control. */
function Segmented<T extends string>({ label, value, options, onChange, tone = 'gold' }: {
  label: string
  value: T
  options: ReadonlyArray<readonly [T, string]>
  onChange: (v: T) => void
  tone?: 'gold' | 'cyan'
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-hextech-text-dim">{label}</span>
      <div className="flex overflow-hidden rounded-full border border-hextech-border-dim">
        {options.map(([v, text]) => (
          <button
            type="button"
            key={v}
            onClick={() => onChange(v)}
            className={cn(
              'px-3 py-1 text-xs font-medium transition-colors',
              value === v
                ? tone === 'gold' ? 'bg-hextech-gold/15 text-hextech-gold-bright' : 'bg-hextech-cyan/15 text-hextech-cyan'
                : 'text-hextech-text-dim hover:text-hextech-text',
            )}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  )
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
  const [dataLoaded, setDataLoaded] = useState(false)
  /** When true the comparison chart uses session KPI scores instead of the previous assessment. */
  const [trendShowLive, setTrendShowLive] = useState(false)
  const [sessionCount, setSessionCount] = useState<SessionCountOption>('all')

  // Chart 1 and chart 2 keep independent, persisted fundamental filters.
  const [selectedFundamentalIds, setSelectedFundamentalIdsRaw] = useState<string[] | null>(() => readIds(LS_FILTER_KEY))
  const [trendSelectedIds, setTrendSelectedIdsRaw] = useState<string[] | null>(() => readIds(LS_TREND_FILTER_KEY))
  const [activeTab, setActiveTabRaw] = useState<string>(() => localStorage.getItem(LS_TAB_KEY) ?? 'progress')
  // Period filter (applies to chart 1)
  const [timePeriod, setTimePeriodRaw] = useState<TimePeriod>(() => (localStorage.getItem(LS_PERIOD_KEY) as TimePeriod) ?? 'all')

  const persistIds = (key: string, ids: string[] | null) => {
    if (ids === null) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(ids))
  }
  const setSelectedFundamentalIds = (ids: string[] | null) => { setSelectedFundamentalIdsRaw(ids); persistIds(LS_FILTER_KEY, ids) }
  const setTrendSelectedIds = (ids: string[] | null) => { setTrendSelectedIdsRaw(ids); persistIds(LS_TREND_FILTER_KEY, ids) }
  const setActiveTab = (tab: string) => { setActiveTabRaw(tab); localStorage.setItem(LS_TAB_KEY, tab) }
  const setTimePeriod = (p: TimePeriod) => { setTimePeriodRaw(p); localStorage.setItem(LS_PERIOD_KEY, p) }

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

  // Chart 1 (Skill Progress): assessments + session KPI data, period filtered
  const mergedProgressData = useMemo(() => [...progressData, ...kpiPoints], [progressData, kpiPoints])
  const periodFilteredData = useMemo(() => {
    if (timePeriod === 'all') return mergedProgressData
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - (timePeriod === '90d' ? 90 : 30))
    return mergedProgressData.filter((p) => new Date(p.date) >= cutoff)
  }, [mergedProgressData, timePeriod])

  // Chart 2: data source for the "has data" dots
  const trendSourceData = useMemo(
    () => (trendShowLive ? mergedProgressData : progressData),
    [trendShowLive, mergedProgressData, progressData],
  )

  const allFundamentalIds = useMemo(() => FUNDAMENTALS.flatMap((cat) => cat.fundamentals.map((f) => f.id)), [FUNDAMENTALS])
  const fundamentalsWithData = useMemo(() => new Set(periodFilteredData.map((d) => d.fundamentalId)), [periodFilteredData])
  const trendFundamentalsWithData = useMemo(() => new Set(trendSourceData.map((d) => d.fundamentalId)), [trendSourceData])
  const labelOf = useMemo(() => {
    const map = new Map(FUNDAMENTALS.flatMap((c) => c.fundamentals.map((f) => [f.id, f.label] as const)))
    return (id: string) => map.get(id) ?? id
  }, [FUNDAMENTALS])

  const displayedFundamentalIds = selectedFundamentalIds ?? allFundamentalIds
  const trendDisplayedIds = trendSelectedIds ?? allFundamentalIds

  if (!user) return null

  if (!dataLoaded) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-hextech-gold" />
      </div>
    )
  }

  // Gate: no assessment means no data — redirect to the first assessment
  if (progressData.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-6 py-24 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full border border-hextech-gold/30 bg-hextech-gold/10">
          <ClipboardList className="h-8 w-8 text-hextech-gold" />
        </div>
        <div className="space-y-2">
          <h2 className="font-display text-xl font-bold text-hextech-gold-bright">{t('analytics.gate.title')}</h2>
          <p className="max-w-sm text-sm leading-relaxed text-hextech-text-dim">{t('analytics.gate.desc')}</p>
        </div>
        <Button onClick={() => navigate('/assessment')} className="gap-2">
          <ClipboardList className="h-4 w-4" />
          {t('analytics.gate.cta')}
        </Button>
      </div>
    )
  }

  // Summary card: latest vs previous assessment (assessments only, all time)
  const bilanLatest = getLatestScores(progressData)
  const bilanPrevious = getPreviousScores(progressData)
  const latestBilanDate = [...new Set(progressData.map((d) => d.date))].sort().pop() ?? null

  // Chart 2 — "Assessments": latest vs previous; "Sessions": session KPI average vs latest assessment
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
        .map((id) => ({ label: id, score: sessionAvg[id], previousScore: bilanLatest[id] }))
    }
    return trendDisplayedIds
      .filter((id) => bilanLatest[id] != null)
      .map((id) => ({ label: id, score: bilanLatest[id], previousScore: bilanPrevious[id] }))
  })()

  // Plain-language list of the gaps shown in chart 2, biggest gain first
  const trendChanges = scoreTrendData
    .filter((d) => d.previousScore != null)
    .map((d) => ({ id: d.label, delta: d.score - (d.previousScore as number) }))
    .filter((d) => Math.abs(d.delta) >= 0.05)
    .sort((a, b) => b.delta - a.delta)

  return (
    <div className="space-y-4 animate-fade-in">
      <div>
        <h1 className="font-display text-2xl font-bold text-hextech-gold-bright">{t('analytics.title')}</h1>
        <p className="mt-1 text-sm text-hextech-text">{t('analytics.subtitle')}</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="progress"><TrendingUp className="mr-1 h-4 w-4" /> {t('analytics.tabs.progress')}</TabsTrigger>
          <TabsTrigger value="history"><History className="mr-1 h-4 w-4" /> {t('analytics.tabs.gameHistory')}</TabsTrigger>
          <TabsTrigger value="badges"><Award className="mr-1 h-4 w-4" /> {t('analytics.tabs.achievements')}</TabsTrigger>
          <TabsTrigger value="stats"><BarChart3 className="mr-1 h-4 w-4" /> {t('analytics.tabs.stats')}</TabsTrigger>
        </TabsList>

        <TabsContent value="progress" className="space-y-4">
          {/* 1. Where I stand — the essentials before any chart */}
          <ProgressSummary latest={bilanLatest} previous={bilanPrevious} labelOf={labelOf} latestDate={latestBilanDate} />

          {/* 2. Evolution over time */}
          <Card>
            <CardHeader className="space-y-3 pb-2">
              <div>
                <CardTitle>{t('analytics.charts.skillProgress')}</CardTitle>
                <ChartHint>{t('analytics.hints.progress')}</ChartHint>
              </div>
              <div className="flex flex-col gap-3 border-t border-hextech-border-dim pt-3">
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 shrink-0 text-hextech-text-dim" />
                  <Segmented<TimePeriod>
                    label={t('analytics.period.label')}
                    value={timePeriod}
                    onChange={setTimePeriod}
                    options={[['all', t('analytics.period.all')], ['90d', t('analytics.period.90d')], ['30d', t('analytics.period.30d')]]}
                  />
                </div>
                <FundamentalFilter
                  categories={FUNDAMENTALS}
                  selected={selectedFundamentalIds}
                  onChange={setSelectedFundamentalIds}
                  withData={fundamentalsWithData}
                />
              </div>
            </CardHeader>
            <CardContent>
              {/* Only fundamentals with data in this view: the others draw no line and only cluttered the legend. */}
              <ProgressChart data={periodFilteredData} fundamentalIds={displayedFundamentalIds.filter((id) => fundamentalsWithData.has(id))} />
            </CardContent>
          </Card>

          {/* 3. Comparison: assessments, or sessions vs latest assessment */}
          <Card>
            <CardHeader className="space-y-3 pb-2">
              <div>
                <CardTitle>{trendShowLive ? t('analytics.charts.sessionVsBilan') : t('analytics.charts.currentVsPrevious')}</CardTitle>
                <ChartHint>{trendShowLive ? t('analytics.hints.sessions') : t('analytics.hints.bilans')}</ChartHint>
              </div>
              <div className="flex flex-col gap-3 border-t border-hextech-border-dim pt-3">
                <Segmented<'bilan' | 'session'>
                  label={t('analytics.compare.label')}
                  value={trendShowLive ? 'session' : 'bilan'}
                  onChange={(v) => setTrendShowLive(v === 'session')}
                  options={[['bilan', t('analytics.charts.modeBilan')], ['session', t('analytics.charts.modeSession')]]}
                />
                {trendShowLive && (
                  <Segmented<SessionCountOption>
                    label={t('analytics.compare.sessions')}
                    value={sessionCount}
                    onChange={setSessionCount}
                    tone="cyan"
                    options={[
                      ['current', t('analytics.charts.sessionCount_current')],
                      ['last', t('analytics.charts.sessionCount_last')],
                      ['3', t('analytics.charts.sessionCount_n', { count: 3 })],
                      ['5', t('analytics.charts.sessionCount_n', { count: 5 })],
                      ['10', t('analytics.charts.sessionCount_n', { count: 10 })],
                      ['all', t('analytics.charts.sessionCount_all')],
                    ]}
                  />
                )}
                <FundamentalFilter
                  categories={FUNDAMENTALS}
                  selected={trendSelectedIds}
                  onChange={setTrendSelectedIds}
                  withData={trendFundamentalsWithData}
                />
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <ScoreTrendChart
                data={scoreTrendData}
                scoreName={trendShowLive ? t('charts.sessionAvg') : t('charts.latestBilan')}
                previousScoreName={trendShowLive ? t('charts.latestBilan') : t('charts.previousBilan')}
              />
              {trendChanges.length > 0 && (
                <div className="space-y-1.5 border-t border-hextech-border-dim pt-3">
                  <div className="text-xs font-medium text-hextech-text-bright">
                    {trendShowLive ? t('analytics.changes.titleSessions') : t('analytics.changes.titleBilans')}
                  </div>
                  <ul className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
                    {trendChanges.map((c) => (
                      <li key={c.id} className="flex justify-between gap-2">
                        <span className="truncate">{labelOf(c.id)}</span>
                        <span className={c.delta > 0 ? 'text-hextech-green' : 'text-[#E24C3A]'}>
                          {c.delta > 0 ? '+' : ''}{c.delta.toFixed(1)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history" className="space-y-4">
          {gameHistory.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-hextech-text-dim">{t('analytics.charts.noGames')}</CardContent>
            </Card>
          ) : (
            gameHistory.map((game: any) => (
              <Card key={game.id}>
                <CardContent className="flex items-center gap-4 p-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-hextech-text-bright">{game.champion}</span>
                      <Badge variant={game.win ? 'success' : 'destructive'}>{game.win ? t('history.win') : t('history.loss')}</Badge>
                      <span className="text-xs text-hextech-text-dim">{game.role}</span>
                    </div>
                    <div className="mt-1 text-sm text-hextech-text">
                      {formatKDA(game.kills, game.deaths, game.assists)} | {t('analytics.game.cs')} {game.cs} | {t('analytics.game.vision')} {game.visionScore} | {formatGameTime(game.duration)}
                    </div>
                    {game.objectiveId && (
                      <div className="mt-1 text-xs text-hextech-gold">
                        {t('analytics.game.objective')} <GameObjectiveLabel objectiveId={game.objectiveId} />
                      </div>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-hextech-text-dim">{new Date(game.gameEndAt).toLocaleDateString()}</div>
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
            <CardHeader><CardTitle>{t('analytics.achievementsTitle')}</CardTitle></CardHeader>
            <CardContent className="space-y-4"><BadgeDisplay unlockedBadgeIds={userBadges} /></CardContent>
          </Card>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="text-base">{t('analytics.xp')}</CardTitle></CardHeader>
              <CardContent><XPBar totalXp={user.xp} /></CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">{t('analytics.streak')}</CardTitle></CardHeader>
              <CardContent><StreakCounter days={user.streakDays} /></CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="stats" className="space-y-4">
          {stats && stats.totalGames > 0 ? (
            <>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
                <StatCard label={t('analytics.statsLabels.totalGames')} value={stats.totalGames.toString()} />
                <StatCard label={t('analytics.statsLabels.avgKda')} value={stats.avgKDA.toFixed(2)} />
                <StatCard label={t('analytics.statsLabels.avgCsMin')} value={stats.avgCSPerMin.toFixed(1)} />
                <StatCard label={t('analytics.statsLabels.avgVision')} value={stats.avgVisionScore.toFixed(1)} />
                <StatCard label={t('analytics.statsLabels.objSuccess')} value={`${stats.objectiveSuccessRate}%`} />
                <StatCard label={t('analytics.statsLabels.sessions')} value={(stats as any).sessionsCompleted?.toString() ?? '0'} />
              </div>
              <Card>
                <CardHeader><CardTitle>{t('analytics.statsLabels.winRate')}</CardTitle></CardHeader>
                <CardContent><WinrateChart wins={stats.wins} losses={stats.losses} /></CardContent>
              </Card>
            </>
          ) : (
            <Card>
              <CardContent className="py-12 text-center text-hextech-text-dim">{t('analytics.charts.noStats')}</CardContent>
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
        <div className="mt-1 text-xs text-hextech-text">{label}</div>
      </CardContent>
    </Card>
  )
}

function getLatestScores(data: any[]): Record<string, number> {
  const scores: Record<string, number> = {}
  const dates = [...new Set(data.map((d) => d.date))].sort()
  const latestDate = dates[dates.length - 1]
  if (!latestDate) return scores
  for (const point of data) if (point.date === latestDate) scores[point.fundamentalId] = point.score
  return scores
}

function getPreviousScores(data: any[]): Record<string, number> {
  const scores: Record<string, number> = {}
  const dates = [...new Set(data.map((d) => d.date))].sort()
  if (dates.length < 2) return scores
  const prevDate = dates[dates.length - 2]
  for (const point of data) if (point.date === prevDate) scores[point.fundamentalId] = point.score
  return scores
}
