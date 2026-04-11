import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useUserStore } from '@/store/useUserStore'
import { useSessionStore } from '@/store/useSessionStore'
import { useGameStore } from '@/store/useGameStore'
import { XPBar } from '@/components/Gamification/XPBar'
import { StreakCounter } from '@/components/Gamification/StreakCounter'
import { CoachingPatternCard } from '@/components/Coaching/CoachingPatternCard'
import { ProgressChart } from '@/components/Charts/ProgressChart'
import {
  Target,
  Play,
  BarChart3,
  Swords,
  Gamepad2,
  Crosshair,
  ShieldCheck,
  Eye,
  Trophy,
  ClipboardList,
  ClipboardCheck,
  Clock,
  ChevronRight,
  Shield,
  TrendingUp,
  TrendingDown,
} from 'lucide-react'
import { useLocalizedFundamentals } from '@/lib/constants/useFundamentals'
import { useTranslation } from 'react-i18next'
import { formatKDA, formatGameTime, cn } from '@/lib/utils'

import { useChampionIconUrl } from '@/hooks/useChampionIconUrl'

interface LastGame {
  matchId: string
  champion: string
  opponentChampion: string | null
  role: string
  kills: number
  deaths: number
  assists: number
  cs: number
  visionScore: number
  duration: number
  win: boolean
  gameEndAt: string
}

export function DashboardPage() {
  const { t } = useTranslation()
  const user = useUserStore((s) => s.user)
  const activeSession = useSessionStore((s) => s.activeSession)
  const loadActiveSession = useSessionStore((s) => s.loadActiveSession)
  const stats = useGameStore((s) => s.stats)
  const loadStats = useGameStore((s) => s.loadStats)
  const progressData = useGameStore((s) => s.progressData)
  const loadProgressData = useGameStore((s) => s.loadProgressData)
  const navigate = useNavigate()
  const allFundamentals = useLocalizedFundamentals().flatMap((c) => c.fundamentals)
  const [lastGame, setLastGame] = useState<LastGame | null>(null)
  const [snapshots, setSnapshots] = useState<any[]>([])

  useEffect(() => {
    loadActiveSession()
    loadStats()
    loadProgressData()
    window.api.getMatchHistoryWithStatus(1).then((games: any[]) => {
      if (games.length > 0) setLastGame(games[0])
    }).catch(() => {})
    window.api.getStatsSnapshots().then(setSnapshots).catch(() => {})
  }, [loadActiveSession, loadStats, loadProgressData])

  if (!user) return null

  const needsReassessment = user.nextAssessmentAt && new Date(user.nextAssessmentAt) < new Date()

  // Resolve session objective IDs
  const sessionObjectiveIds = (() => {
    if (!activeSession) return []
    try { return JSON.parse(activeSession.objectiveIds) } catch { return [activeSession.objectiveId] }
  })()

  const objectiveName = sessionObjectiveIds
    .map((id: string) => allFundamentals.find((f) => f.id === id)?.label ?? id)
    .join(', ')

  // Filter progressData to session objectives
  const sessionProgressData = progressData.filter((d) =>
    sessionObjectiveIds.includes(d.fundamentalId),
  )

  // Stat diffs: last two snapshots
  const statDiffs = computeStatDiffs(snapshots)

  const winrate = stats && stats.totalGames > 0
    ? Math.round((stats.wins / stats.totalGames) * 100)
    : null

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-hextech-gold-bright">
            {t('dashboard.welcome')} {user.displayName || user.summonerName}
          </h1>
          <p className="text-sm text-hextech-text mt-0.5">{t('dashboard.subtitle')}</p>
        </div>
      </div>

      {needsReassessment && (
        <div className="flex items-center justify-between rounded-lg border border-hextech-gold/30 bg-hextech-gold/5 px-4 py-2.5">
          <div className="flex items-center gap-3">
            <ClipboardList className="h-4 w-4 text-hextech-gold shrink-0" />
            <div>
              <p className="text-sm font-medium text-hextech-gold-bright">{t('dashboard.reassessmentBanner.title')}</p>
              <p className="text-xs text-hextech-text">{t('dashboard.reassessmentBanner.desc')}</p>
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={() => navigate('/assessment')} className="shrink-0 ml-4 border-hextech-gold/50 text-hextech-gold hover:bg-hextech-gold/10">
            {t('dashboard.reassessmentBanner.cta')}
          </Button>
        </div>
      )}

      {/* Main row: content (2/3) + sidebar (1/3) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left column */}
        <div className="lg:col-span-2 space-y-4">
          {/* Active session card */}
          {activeSession ? (
            <Card className="border-hextech-green/30 bg-hextech-green/5">
              <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4">
                <div className="flex items-center gap-3 min-w-0">
                  <Swords className="h-5 w-5 text-hextech-green shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs text-hextech-text-dim">{t('dashboard.activeSession.title')}</p>
                    <p className="font-semibold text-hextech-text-bright truncate">{objectiveName}</p>
                    <p className="text-xs text-hextech-text mt-0.5">
                      {t('dashboard.activeSession.game', { count: activeSession.games.length })}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button size="sm" onClick={() => navigate('/review')}>
                    <Play className="h-3.5 w-3.5 mr-1.5" />
                    {t('dashboard.activeSession.continueButton')}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => navigate('/analytics')}>
                    <BarChart3 className="h-3.5 w-3.5 mr-1.5" />
                    {t('dashboard.viewProgress')}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="flex items-center justify-between gap-4 p-4">
                <div>
                  <p className="font-medium text-hextech-text-bright">{t('dashboard.noSession.title')}</p>
                  <p className="text-xs text-hextech-text mt-0.5">{t('dashboard.noSession.desc')}</p>
                </div>
                <Button size="sm" onClick={() => navigate('/session')} className="shrink-0">
                  <Target className="h-3.5 w-3.5 mr-1.5" />
                  {t('dashboard.noSession.button')}
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Session objective progress (only when active) */}
          {sessionObjectiveIds.length > 0 && (
            <Card>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <TrendingUp className="h-4 w-4 text-hextech-cyan" />
                  {t('dashboard.sessionProgress.title')}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                {sessionProgressData.length > 0 ? (
                  <ProgressChart data={sessionProgressData} fundamentalIds={sessionObjectiveIds} />
                ) : (
                  <p className="text-sm text-hextech-text-dim py-6 text-center">
                    {t('dashboard.sessionProgress.noData')}
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Stats grid */}
          {stats && stats.totalGames > 0 && (
            <div className="grid grid-cols-4 gap-3">
              <StatCard icon={Gamepad2} label={t('dashboard.stats.games')} value={stats.totalGames.toString()} />
              <StatCard icon={Trophy} label={t('dashboard.stats.winRate')} value={`${Math.round((stats.wins / stats.totalGames) * 100)}%`} />
              <StatCard icon={Crosshair} label={t('dashboard.stats.avgKda')} value={stats.avgKDA.toFixed(2)} />
              <StatCard icon={ShieldCheck} label={t('dashboard.stats.objSuccess')} value={`${stats.objectiveSuccessRate}%`} />
            </div>
          )}

          {/* Last game */}
          {lastGame && <LastGameCard game={lastGame} onViewDetails={() => navigate(`/stats/${lastGame.matchId}`)} />}
        </div>

        {/* Right sidebar */}
        <div className="space-y-4">
          {/* Progression + compact winrate merged */}
          <Card>
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm">{t('dashboard.progress')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 px-4 pb-4">
              <XPBar totalXp={user.xp} />
              <StreakCounter days={user.streakDays} />
              {winrate !== null && stats && (
                <div className="rounded-lg border border-hextech-border-dim bg-hextech-elevated px-3 py-2">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs text-hextech-text-dim">{t('dashboard.stats.winRate')}</span>
                    <span className="text-sm font-bold text-hextech-gold-bright">{winrate}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-hextech-base overflow-hidden">
                    <div
                      className="h-full rounded-full bg-hextech-green transition-all"
                      style={{ width: `${winrate}%` }}
                    />
                  </div>
                  <div className="flex justify-between mt-1">
                    <span className="text-[10px] text-hextech-green">{stats.wins}W</span>
                    <span className="text-[10px] text-[#FF4655]">{stats.losses}L</span>
                  </div>
                </div>
              )}
              <Button
                variant="outline"
                size="sm"
                className="w-full border-hextech-gold/40 text-hextech-gold hover:bg-hextech-gold/10 gap-2"
                onClick={() => navigate('/assessment')}
              >
                <ClipboardCheck className="h-4 w-4" />
                {t('dashboard.fullAssessmentButton')}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Bottom row: stat diffs (2/3) + coaching patterns (1/3) — same visual line */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          {statDiffs.length >= 2 && (
            <StatDiffsCard diffs={statDiffs} onViewAll={() => navigate('/stats')} />
          )}
        </div>
        <div>
          <CoachingPatternCard />
        </div>
      </div>
    </div>
  )
}

/* ─── Stat helpers ─── */

interface StatDiffItem {
  label: string
  prev: number
  curr: number
  diff: number
  higherIsBetter: boolean
  format: (v: number) => string
}

const KEY_STATS: Array<{ label: string; path: (s: any) => number | null; higherIsBetter?: boolean; format?: (v: number) => string }> = [
  { label: 'CS/min', path: (s) => s.economy.csPerMin, higherIsBetter: true },
  { label: 'Gold/min', path: (s) => s.economy.goldPerMin, higherIsBetter: true },
  { label: 'Win Rate', path: (s) => s.meta.winRate, higherIsBetter: true, format: (v) => `${v}%` },
  { label: 'Kill Part.', path: (s) => s.combat.killParticipation, higherIsBetter: true, format: (v) => `${v}%` },
  { label: 'DMG/min', path: (s) => s.combat.damagePerMin, higherIsBetter: true },
  { label: 'Vision/min', path: (s) => s.vision.visionScorePerMin, higherIsBetter: true },
  { label: 'Gold Diff @15', path: (s) => s.laning.goldDiff15, higherIsBetter: true },
  { label: 'CS Diff @15', path: (s) => s.laning.csDiff15, higherIsBetter: true },
  { label: 'Solo Kills', path: (s) => s.combat.soloKills, higherIsBetter: true },
  { label: 'Wards Destroyed', path: (s) => s.vision.wardsDestroyed, higherIsBetter: true },
]

function computeStatDiffs(snapshots: any[]): StatDiffItem[] {
  if (snapshots.length < 2) return []
  const prev = snapshots[snapshots.length - 2].stats
  const curr = snapshots[snapshots.length - 1].stats

  const diffs: StatDiffItem[] = []
  for (const stat of KEY_STATS) {
    const pv = stat.path(prev)
    const cv = stat.path(curr)
    if (pv == null || cv == null) continue
    diffs.push({
      label: stat.label,
      prev: pv,
      curr: cv,
      diff: cv - pv,
      higherIsBetter: stat.higherIsBetter ?? true,
      format: stat.format ?? ((v) => typeof v === 'number' ? v.toLocaleString() : String(v)),
    })
  }

  // Sort by absolute diff descending, show top 5
  return diffs.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff)).slice(0, 5)
}

/* ─── Sub-components ─── */

function StatCard({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-hextech-border-dim bg-hextech-elevated">
          <Icon className="h-4 w-4 text-hextech-gold" />
        </div>
        <div>
          <div className="text-lg font-bold text-hextech-text-bright">{value}</div>
          <div className="text-xs text-hextech-text">{label}</div>
        </div>
      </CardContent>
    </Card>
  )
}

function ChampionIcon({ name, size = 48, className }: { name: string | null | undefined; size?: number; className?: string }) {
  const url = useChampionIconUrl(name)
  const [error, setError] = useState(false)

  if (!url || error) {
    return (
      <div
        style={{ width: size, height: size }}
        className={cn('rounded-full bg-hextech-elevated border border-hextech-border-dim flex items-center justify-center shrink-0', className)}
      >
        <Shield className="h-5 w-5 text-hextech-text-dim" />
      </div>
    )
  }

  return (
    <img
      src={url}
      alt={name ?? ''}
      width={size}
      height={size}
      onError={() => setError(true)}
      className={cn('rounded-full object-cover border-2 shrink-0', className)}
      style={{ width: size, height: size }}
    />
  )
}

function LastGameCard({ game, onViewDetails }: { game: LastGame; onViewDetails: () => void }) {
  const { t } = useTranslation()
  const kda = game.deaths === 0 ? 'Perfect' : ((game.kills + game.assists) / game.deaths).toFixed(2)
  const cspm = game.duration > 0 ? (game.cs / (game.duration / 60)).toFixed(1) : '0'

  return (
    <Card className={cn(
      'border transition-colors',
      game.win ? 'border-hextech-green/30 bg-hextech-green/5' : 'border-[#FF4655]/20 bg-[#FF4655]/5',
    )}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Swords className="h-4 w-4 text-hextech-gold" />
          {t('dashboard.lastGame.title')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-4">
          {/* Result badge */}
          <Badge
            variant={game.win ? 'success' : 'destructive'}
            className="text-sm px-3 py-1 shrink-0 w-12 justify-center"
          >
            {game.win ? 'W' : 'L'}
          </Badge>

          {/* Champion matchup */}
          <div className="flex items-center gap-2 shrink-0">
            <ChampionIcon
              name={game.champion}
              size={52}
              className={game.win ? 'border-hextech-green/50' : 'border-[#FF4655]/40'}
            />
            <div className="flex flex-col items-center">
              <span className="text-xs text-hextech-text-dim">{t('dashboard.lastGame.vs')}</span>
              <div className="h-px w-6 bg-hextech-border-dim mt-0.5" />
            </div>
            <ChampionIcon
              name={game.opponentChampion}
              size={40}
              className="border-hextech-border-dim opacity-70"
            />
          </div>

          {/* Stats */}
          <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-xs">
            <div>
              <div className="text-hextech-text-dim">KDA</div>
              <div className="font-semibold text-hextech-text-bright">
                {formatKDA(game.kills, game.deaths, game.assists)}
                <span className="ml-1 text-hextech-gold font-bold">({kda})</span>
              </div>
            </div>
            <div>
              <div className="text-hextech-text-dim flex items-center gap-1"><Target className="h-3 w-3" />CS/m</div>
              <div className="font-semibold text-hextech-text-bright">{cspm}</div>
            </div>
            <div>
              <div className="text-hextech-text-dim flex items-center gap-1"><Eye className="h-3 w-3" />Vision</div>
              <div className="font-semibold text-hextech-text-bright">{game.visionScore}</div>
            </div>
            <div>
              <div className="text-hextech-text-dim flex items-center gap-1"><Clock className="h-3 w-3" /></div>
              <div className="font-semibold text-hextech-text-bright">{formatGameTime(game.duration)}</div>
            </div>
          </div>

          {/* Link to detailed stats */}
          <Button
            variant="ghost"
            size="sm"
            onClick={onViewDetails}
            className="shrink-0 gap-1 text-xs text-hextech-gold hover:bg-hextech-gold/10"
          >
            {t('dashboard.lastGame.viewDetails')}
            <ChevronRight className="h-3 w-3" />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function StatDiffsCard({ diffs, onViewAll }: { diffs: StatDiffItem[]; onViewAll: () => void }) {
  const { t } = useTranslation()

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <BarChart3 className="h-4 w-4 text-hextech-gold" />
            {t('dashboard.statDiffs.title')}
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={onViewAll} className="gap-1 text-xs text-hextech-text-dim hover:text-hextech-gold">
            {t('statsAvg.tabs.progression')}
            <ChevronRight className="h-3 w-3" />
          </Button>
        </div>
        <p className="text-[11px] text-hextech-text-dim mt-0.5">{t('dashboard.statDiffs.vsSnap')}</p>
      </CardHeader>
      <CardContent className="space-y-2">
        {diffs.map((item) => {
          const isPositive = item.higherIsBetter ? item.diff > 0 : item.diff < 0
          const isNegative = item.higherIsBetter ? item.diff < 0 : item.diff > 0
          const diffColor = isPositive ? 'text-hextech-green' : isNegative ? 'text-[#FF4655]' : 'text-hextech-text-dim'

          return (
            <div key={item.label} className="flex items-center justify-between py-1">
              <span className="text-xs text-hextech-text w-28 shrink-0">{item.label}</span>
              <div className="flex items-center gap-3 flex-1 justify-end">
                <span className="text-xs text-hextech-text-dim">{item.format(item.prev)}</span>
                <span className="text-[10px] text-hextech-text-dim">→</span>
                <span className="text-xs font-semibold text-hextech-text-bright">{item.format(item.curr)}</span>
                <span className={`flex items-center gap-0.5 text-xs font-bold w-14 justify-end shrink-0 ${diffColor}`}>
                  {isPositive ? <TrendingUp className="h-3 w-3" /> : isNegative ? <TrendingDown className="h-3 w-3" /> : null}
                  {item.diff > 0 ? '+' : ''}{item.diff.toFixed(1)}
                </span>
              </div>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
