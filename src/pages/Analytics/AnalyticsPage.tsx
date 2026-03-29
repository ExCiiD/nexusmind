import { useEffect, useState, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
import { TrendingUp, History, Award, BarChart3, Filter } from 'lucide-react'
import { useTranslation } from 'react-i18next'

function GameObjectiveLabel({ objectiveId }: { objectiveId: string }) {
  const f = useLocalizedFundamental(objectiveId)
  return <>{f?.label || objectiveId}</>
}

export function AnalyticsPage() {
  const { t } = useTranslation()
  const user = useUserStore((s) => s.user)
  const stats = useGameStore((s) => s.stats)
  const progressData = useGameStore((s) => s.progressData)
  const gameHistory = useGameStore((s) => s.gameHistory)
  const loadStats = useGameStore((s) => s.loadStats)
  const loadProgressData = useGameStore((s) => s.loadProgressData)
  const loadGameHistory = useGameStore((s) => s.loadGameHistory)
  const FUNDAMENTALS = useLocalizedFundamentals()

  const [userBadges, setUserBadges] = useState<string[]>([])
  const [showObjectiveFilter, setShowObjectiveFilter] = useState(false)
  const [selectedFundamentalIds, setSelectedFundamentalIds] = useState<string[] | null>(null)

  useEffect(() => {
    loadStats()
    loadProgressData()
    loadGameHistory(20)
    window.api.getBadges().then(setUserBadges).catch(() => {})
  }, [loadStats, loadProgressData, loadGameHistory])

  // All fundamentals that appear in progress data
  const availableFundamentalIds = useMemo(
    () => [...new Set(progressData.map((d) => d.fundamentalId))],
    [progressData],
  )

  // Displayed IDs: selectedFundamentalIds (if set) or all available
  const displayedFundamentalIds = selectedFundamentalIds ?? availableFundamentalIds

  const toggleFundamental = (id: string) => {
    const current = selectedFundamentalIds ?? availableFundamentalIds
    if (current.includes(id)) {
      const next = current.filter((x) => x !== id)
      setSelectedFundamentalIds(next.length === 0 ? null : next)
    } else {
      setSelectedFundamentalIds([...current, id])
    }
  }

  if (!user) return null

  const latestScores = getLatestScores(progressData)
  const previousScores = getPreviousScores(progressData)

  const filteredLatestScores: Record<string, number> = {}
  const filteredPreviousScores: Record<string, number> = {}
  for (const id of displayedFundamentalIds) {
    if (latestScores[id] != null) filteredLatestScores[id] = latestScores[id]
    if (previousScores[id] != null) filteredPreviousScores[id] = previousScores[id]
  }

  const scoreTrendData = Object.entries(filteredLatestScores).map(([id, score]) => ({
    label: id,
    score,
    previousScore: filteredPreviousScores[id],
  }))

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="font-display text-2xl font-bold text-hextech-gold-bright">{t('analytics.title')}</h1>
        <p className="text-sm text-hextech-text mt-1">{t('analytics.subtitle')}</p>
      </div>

      <Tabs defaultValue="progress">
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

        <TabsContent value="progress" className="space-y-6">
          {/* Objective filter */}
          {availableFundamentalIds.length > 0 && (
            <Card>
              <CardContent className="p-3">
                <button
                  className="flex items-center gap-2 text-sm text-hextech-text-dim hover:text-hextech-text transition-colors"
                  onClick={() => setShowObjectiveFilter((v) => !v)}
                >
                  <Filter className="h-4 w-4" />
                  <span>{t('analytics.objectiveFilter.label')}</span>
                  {selectedFundamentalIds !== null && (
                    <Badge variant="gold" className="text-[10px] h-5 px-2">
                      {selectedFundamentalIds.length}/{availableFundamentalIds.length}
                    </Badge>
                  )}
                </button>

                {showObjectiveFilter && (
                  <div className="mt-3 space-y-2">
                    {/* Category + All toggles */}
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
                      {FUNDAMENTALS.map((cat) => {
                        const catFundIds = cat.fundamentals.map((f) => f.id).filter((fid) => availableFundamentalIds.includes(fid))
                        if (catFundIds.length === 0) return null
                        const allActive = catFundIds.every((fid) => displayedFundamentalIds.includes(fid))
                        return (
                          <button
                            key={cat.id}
                            onClick={() => {
                              const current = selectedFundamentalIds ?? availableFundamentalIds
                              if (allActive) {
                                const next = current.filter((id) => !catFundIds.includes(id))
                                setSelectedFundamentalIds(next.length === 0 ? null : next)
                              } else {
                                setSelectedFundamentalIds([...new Set([...current, ...catFundIds])])
                              }
                            }}
                            className={cn(
                              'rounded-full border px-3 py-1 text-xs font-semibold transition-colors',
                              allActive
                                ? 'border-hextech-cyan bg-hextech-cyan/10 text-hextech-cyan'
                                : 'border-hextech-border-dim text-hextech-text-dim hover:border-hextech-border',
                            )}
                          >
                            {cat.label}
                          </button>
                        )
                      })}
                    </div>
                    {/* Individual fundamentals */}
                    <div className="flex flex-wrap gap-2">
                      {availableFundamentalIds.map((id) => {
                        const label = FUNDAMENTALS.flatMap((c) => c.fundamentals).find((f) => f.id === id)?.label
                          ?? id.replace(/_/g, ' ')
                        const isActive = displayedFundamentalIds.includes(id)
                        return (
                          <button
                            key={id}
                            onClick={() => toggleFundamental(id)}
                            className={cn(
                              'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                              isActive
                                ? 'border-hextech-gold bg-hextech-gold/10 text-hextech-gold-bright'
                                : 'border-hextech-border-dim text-hextech-text-dim hover:border-hextech-border',
                            )}
                          >
                            {label}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>{t('analytics.charts.skillProgress')}</CardTitle>
            </CardHeader>
            <CardContent>
              <ProgressChart data={progressData} fundamentalIds={displayedFundamentalIds} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('analytics.charts.currentVsPrevious')}</CardTitle>
            </CardHeader>
            <CardContent>
              <ScoreTrendChart data={scoreTrendData} />
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

        <TabsContent value="badges" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{t('analytics.achievementsTitle')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <BadgeDisplay unlockedBadgeIds={userBadges} />
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
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

        <TabsContent value="stats" className="space-y-6">
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
