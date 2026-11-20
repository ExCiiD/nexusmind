import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { useUserStore } from '@/store/useUserStore'
import { useSessionStore } from '@/store/useSessionStore'
import { useGameStore } from '@/store/useGameStore'
import { CoachingPatternCard } from '@/components/Coaching/CoachingPatternCard'
import { ReassessmentBanner } from '@/components/Coaching/ReassessmentBanner'
import { AssistantCard } from '@/components/Assistant/AssistantCard'
import { WeeklyCodex } from '@/components/MicroReview/WeeklyCodex'
import { ProgressChart } from '@/components/Charts/ProgressChart'
import { FundamentalsRadarChart } from '@/components/Charts/FundamentalsRadarChart'
import { buildFundamentalsRadar, overallRadarScore, radarAxesForRole } from '@/lib/fundamentalsRadarCore'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
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
  Clock,
  ChevronRight,
  Shield,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Layers,
  Loader2,
  Flame,
  Radio,
  Sparkles,
} from 'lucide-react'
import type { MistakeTopTagEntry } from '@/lib/ipc'
import { useLocalizedFundamentalList } from '@/lib/constants/useFundamentals'
import { findFundamentalLabel } from '@/lib/fundamentals'
import { useTranslation } from 'react-i18next'
import { MyTeamCard } from '@/components/team/MyTeamCard'
import { formatKDA, formatGameTime, cn } from '@/lib/utils'
import { useChampionIconUrl } from '@/hooks/useChampionIconUrl'
import { wrText } from '@/lib/winrate'
import { useCachedQuery } from '@/hooks/useCachedQuery'
import { SNAPSHOTS_KEY, fetchSnapshots } from '@/lib/pageQueries'

const NO_GAMES: RecentGame[] = []
const NO_ROWS: any[] = []

/** « Dernière partie » comes from the Riot list, which knows nothing of sessions: the local history flags the games
 * played outside one (offSession, contract account-region.md), matched by matchId. */
async function loadDashboardRecentGames(): Promise<RecentGame[]> {
  const [games, local] = await Promise.all([
    window.api.getMatchHistoryWithStatus(10),
    window.api.getGameHistory(10).catch(() => [] as any[]),
  ])
  const off = new Set(((local ?? []) as any[]).filter((g) => g?.offSession).map((g) => g.matchId))
  return ((games ?? []) as any[]).map((g) => ({ ...g, offSession: off.has(g.matchId) }))
}

interface RecentGame {
  /** Played outside a session (decision of 20/11/2026): from getGameHistory's `offSession`, matched by matchId. */
  offSession?: boolean
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
  reviewStatus?: 'pending' | 'to_be_reviewed' | 'reviewed'
}

/** Shared panel chrome — translucent so the user's background (Settings →
 *  Appearance) shows through, with the theme's own border token. */
export const panelClass =
  'rounded-2xl border border-hextech-border-dim/70 panel-surface backdrop-blur-sm shadow-lg'

/** `space-y-6` between the cards of a column. */
const COLUMN_GAP_PX = 24
/** Any of these means the user is reading: the balanced card stops moving. */
const READING_EVENTS = ['wheel', 'pointerdown', 'keydown', 'touchstart'] as const

/**
 * Column for the card that reads well on either side (the coaching patterns).
 * The two stacks' heights depend on the data: a running session adds a chart
 * on the left, the weekly Assistant card on the right is long or absent. The
 * card goes where the two columns end closest to each other, so neither side
 * ends on a large void while the other one needs a scroll.
 *
 * Measured while the dashboard's cards arrive (each loads on its own, the page
 * is moving anyway), then fixed for good at the user's first scroll, click or
 * key press, or 4 s after the last change: the card never moves under the
 * user's eyes. Stacked columns (narrow window) keep the default.
 */
function useBalancedSide(
  left: RefObject<HTMLElement>,
  right: RefObject<HTMLElement>,
  card: RefObject<HTMLElement>,
  ready: boolean,
): 'left' | 'right' {
  const [side, setSide] = useState<'left' | 'right'>('left')
  useEffect(() => {
    const l = left.current
    const r = right.current
    if (!ready || !l || !r || typeof ResizeObserver === 'undefined') return
    let done = false
    let settle: ReturnType<typeof setTimeout> | undefined
    const measure = () => {
      if (l.offsetTop !== r.offsetTop) return // one column under the other
      const c = card.current
      const cardSpace = c && c.offsetHeight > 0 ? c.offsetHeight + COLUMN_GAP_PX : 0
      const inLeft = !!c && l.contains(c)
      const leftBase = l.offsetHeight - (inLeft ? cardSpace : 0)
      const rightBase = r.offsetHeight - (inLeft ? 0 : cardSpace)
      setSide(leftBase <= rightBase ? 'left' : 'right')
      clearTimeout(settle)
      settle = setTimeout(stop, 4000)
    }
    const observer = new ResizeObserver(measure)
    const stop = () => {
      if (done) return
      done = true
      observer.disconnect()
      clearTimeout(settle)
      for (const e of READING_EVENTS) window.removeEventListener(e, stop, true)
    }
    observer.observe(l)
    observer.observe(r)
    for (const e of READING_EVENTS) window.addEventListener(e, stop, true)
    return stop
  }, [left, right, card, ready])
  return side
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
  const allFundamentals = useLocalizedFundamentalList()
  // Cached (useCachedQuery): back on the dashboard, the last data shows at once and refreshes behind.
  const { data: recentGames = NO_GAMES } = useCachedQuery<RecentGame[]>('games:dashboard-recent', loadDashboardRecentGames)
  const { data: snapshots = NO_ROWS } = useCachedQuery<any[]>(SNAPSHOTS_KEY, fetchSnapshots)
  const leftColumn = useRef<HTMLDivElement>(null)
  const rightColumn = useRef<HTMLDivElement>(null)
  const patternsBox = useRef<HTMLDivElement>(null)
  const patternsSide = useBalancedSide(leftColumn, rightColumn, patternsBox, !!user)

  useEffect(() => {
    loadActiveSession()
    loadStats()
    loadProgressData()
  }, [loadActiveSession, loadStats, loadProgressData])

  if (!user) return null

  const sessionObjectiveIds: string[] = (() => {
    if (!activeSession) return []
    try { return JSON.parse(activeSession.objectiveIds) } catch { return [activeSession.objectiveId] }
  })()
  const objectiveName = sessionObjectiveIds
    .map((id: string) => findFundamentalLabel(id, allFundamentals))
    .join(', ')
  const sessionProgressData = progressData.filter((d) => sessionObjectiveIds.includes(d.fundamentalId))

  const statDiffs = computeStatDiffs(snapshots)
  const lastGame = recentGames[0] ?? null
  const form = summarizeForm(recentGames)
  const winrate = stats && stats.totalGames > 0 ? Math.round((stats.wins / stats.totalGames) * 100) : null
  const formDelta = winrate !== null && form ? form.winrate - winrate : null

  return (
    <div className="space-y-6 animate-fade-in">
      {/* ── Header ── */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-2xl font-extrabold tracking-tight text-hextech-text-bright lg:text-3xl">
              {t('dashboard.welcome')} <span className="text-hextech-gold">{user.displayName || user.summonerName}</span>
            </h1>
            {user.streakDays > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-hextech-gold/25 bg-hextech-gold/10 px-2.5 py-1 text-xs font-medium text-hextech-gold-bright">
                <Flame className="h-3.5 w-3.5 fill-hextech-gold text-hextech-gold" />
                {t('dashboard.header.streak', { count: user.streakDays })}
              </span>
            )}
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-hextech-text">
            {form ? (
              <>
                <span>{t('dashboard.header.formLine', { count: form.games })}</span>
                <span className={cn('font-mono font-semibold', wrText(form.winrate, form.games))}>
                  {form.winrate}% {t('dashboard.header.winrateShort')}
                </span>
                {formDelta !== null && formDelta !== 0 && (
                  <span className="text-hextech-text-dim">
                    ({formDelta > 0 ? '+' : ''}{formDelta} {t('dashboard.header.vsOverall')})
                  </span>
                )}
              </>
            ) : (
              t('dashboard.subtitle')
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {form && <FormStrip games={recentGames} />}
          {user.mainRole && (
            <div className="flex items-center gap-1.5 rounded-lg border border-hextech-border-dim bg-hextech-dark/80 px-3 py-1.5 text-xs text-hextech-text">
              <Swords className="h-3.5 w-3.5 text-hextech-gold" />
              <span>{t('dashboard.header.mainRole')}</span>
              <strong className="text-hextech-text-bright">{user.mainRole}</strong>
            </div>
          )}
        </div>
      </div>

      <ReassessmentBanner />

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-12">
        {/* ── Left column ── */}
        <div ref={leftColumn} className="space-y-6 xl:col-span-8">
          <SessionHero
            active={!!activeSession}
            objectiveName={objectiveName}
            gamesCount={activeSession?.games.length ?? 0}
            onStart={() => navigate('/session')}
            onContinue={() => navigate('/review')}
            onProgress={() => navigate('/analytics')}
          />

          {sessionObjectiveIds.length > 0 && (
            <section className={cn(panelClass, 'p-5')}>
              <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-hextech-text-bright">
                <TrendingUp className="h-4 w-4 text-hextech-cyan" />
                {t('dashboard.sessionProgress.title')}
              </h3>
              {sessionProgressData.length > 0 ? (
                <ProgressChart data={sessionProgressData} fundamentalIds={sessionObjectiveIds} />
              ) : (
                <p className="py-6 text-center text-sm text-hextech-text-dim">{t('dashboard.sessionProgress.noData')}</p>
              )}
            </section>
          )}

          {stats && stats.totalGames > 0 && (
            <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
              <KpiCard icon={Gamepad2} label={t('dashboard.kpi.volume')} tone="gold"
                value={stats.totalGames.toString()} unit={t('dashboard.kpi.games')}
                footer={<>
                  <span className="text-hextech-green">{stats.wins} {t('dashboard.kpi.winShort')}</span>
                  <span className="text-hextech-text-dim">•</span>
                  <span className="text-hextech-red">{stats.losses} {t('dashboard.kpi.lossShort')}</span>
                </>}
              />
              <KpiCard icon={Trophy} label={t('dashboard.stats.winRate')} tone="green"
                value={`${winrate}%`}
                badge={formDelta !== null && formDelta !== 0 ? <Delta value={formDelta} suffix="%" /> : undefined}
                footer={<div className="w-full">
                  <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-hextech-red/40">
                    <div className="h-full rounded-full bg-hextech-green" style={{ width: `${winrate}%` }} />
                  </div>
                  {form && <div className="mt-1 text-[10px] text-hextech-text-dim">{t('dashboard.kpi.lastN', { count: form.games, wr: form.winrate })}</div>}
                </div>}
              />
              <KpiCard icon={Crosshair} label={t('dashboard.stats.avgKda')} tone="cyan"
                value={stats.avgKDA.toFixed(2)}
                footer={form ? <span className="text-hextech-text">{form.k.toFixed(1)} / {form.d.toFixed(1)} / {form.a.toFixed(1)}</span> : undefined}
              />
              <KpiCard icon={ShieldCheck} label={t('dashboard.stats.objSuccess')} tone="gold" accentValue
                value={`${stats.objectiveSuccessRate}%`}
                footer={<span className="text-hextech-text">{t('dashboard.kpi.objHint')}</span>}
              />
            </div>
          )}

          {lastGame && <LastGameCard game={lastGame} onViewDetails={() => navigate(`/stats/${lastGame.matchId}`)} onReview={() => navigate('/review')} />}

          {statDiffs.length >= 2 && <StatDiffsCard diffs={statDiffs} onViewAll={() => navigate('/stats')} />}

          {/* In the left column (not full-width below the grid): the right
              column is usually the taller one, and this card fills the gap. */}
          <MistakeFrequencyCard onViewAll={() => navigate('/stats/mistakes')} />
          {/* The patterns go to whichever column ends first (useBalancedSide):
              stuck under the Assistant card, they took a scroll past an empty
              left column. `empty:hidden`: no gap while the card has nothing. */}
          {patternsSide === 'left' && <div ref={patternsBox} className="empty:hidden"><CoachingPatternCard /></div>}
        </div>

        {/* ── Right column ── (level and XP live in the sidebar: no card here) */}
        <div ref={rightColumn} className="space-y-6 xl:col-span-4">
          {/* § 18.5: what the team gives me (next event, coach's plan, goals, verdicts, tasks). */}
          <MyTeamCard />
          <FundamentalsRadarCard role={user.mainRole} />
          <AssistantCard moment="weekly" footer={<WeeklyCodex role={user.mainRole} />} />
          {patternsSide === 'right' && <div ref={patternsBox} className="empty:hidden"><CoachingPatternCard /></div>}
        </div>
      </div>

    </div>
  )
}

/* ─── Header pieces ─── */

function summarizeForm(games: RecentGame[]) {
  if (games.length === 0) return null
  const n = games.length
  const wins = games.filter((g) => g.win).length
  return {
    games: n,
    winrate: Math.round((wins / n) * 100),
    k: games.reduce((s, g) => s + g.kills, 0) / n,
    d: games.reduce((s, g) => s + g.deaths, 0) / n,
    a: games.reduce((s, g) => s + g.assists, 0) / n,
  }
}

/** Last-N results, oldest → newest, as small W/L pips. */
function FormStrip({ games }: { games: RecentGame[] }) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-2 rounded-lg border border-hextech-border-dim bg-hextech-dark/80 px-3 py-1.5" title={t('dashboard.header.formTitle')}>
      <span className="text-[10px] font-semibold uppercase tracking-wider text-hextech-text-dim">{t('dashboard.header.form')}</span>
      <div className="flex gap-1">
        {[...games].reverse().map((g) => (
          <span key={g.matchId} className={cn('h-3.5 w-1.5 rounded-sm', g.win ? 'bg-hextech-green' : 'bg-hextech-red/80')} />
        ))}
      </div>
    </div>
  )
}

function Delta({ value, suffix = '' }: { value: number; suffix?: string }) {
  const up = value > 0
  return (
    <span className={cn('flex items-center gap-0.5 font-mono text-[11px] font-semibold', up ? 'text-hextech-green' : 'text-hextech-red')}>
      {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {up ? '+' : ''}{value}{suffix}
    </span>
  )
}

/* ─── Session hero ─── */

function SessionHero({ active, objectiveName, gamesCount, onStart, onContinue, onProgress }: {
  active: boolean
  objectiveName: string
  gamesCount: number
  onStart: () => void
  onContinue: () => void
  onProgress: () => void
}) {
  const { t } = useTranslation()
  return (
    <section className={cn(
      panelClass,
      'relative overflow-hidden p-5 lg:p-6',
      active ? 'border-hextech-green/40' : 'bg-gradient-to-br from-hextech-elevated/90 via-hextech-dark/90 to-hextech-dark/90',
    )}>
      <div className="pointer-events-none absolute -right-16 -top-24 h-56 w-56 rounded-full bg-hextech-gold/10 blur-3xl" />
      <div className="relative flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded border border-hextech-gold/30 bg-hextech-gold/15 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-hextech-gold-bright">
              <Crosshair className="h-3 w-3" /> {t('dashboard.hero.badge')}
            </span>
            {active && (
              <span className="inline-flex items-center gap-1.5 rounded border border-hextech-green/40 bg-hextech-green/15 px-2 py-0.5 font-mono text-[10px] uppercase text-hextech-green">
                <Radio className="h-3 w-3 animate-pulse" /> {t('dashboard.activeSession.title')}
              </span>
            )}
          </div>
          <h2 className="mt-2 text-lg font-bold text-hextech-text-bright">
            {active ? objectiveName : t('dashboard.noSession.title')}
          </h2>
          <p className="mt-0.5 text-xs text-hextech-text">
            {active ? t('dashboard.activeSession.game', { count: gamesCount }) : t('dashboard.hero.desc')}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {active ? (
            <>
              <Button onClick={onContinue} className="gap-1.5 font-bold"><Play className="h-4 w-4 fill-current" />{t('dashboard.activeSession.continueButton')}</Button>
              <Button variant="outline" onClick={onProgress} className="gap-1.5"><BarChart3 className="h-4 w-4" />{t('dashboard.viewProgress')}</Button>
            </>
          ) : (
            <Button onClick={onStart} size="lg" className="gap-2 px-5 font-bold shadow-lg shadow-hextech-gold/20">
              <Target className="h-4 w-4" />{t('dashboard.noSession.button')}
            </Button>
          )}
        </div>
      </div>
    </section>
  )
}

/* ─── KPI card ─── */

const TONES = {
  gold: 'border-hextech-gold/25 bg-hextech-gold/10 text-hextech-gold',
  green: 'border-hextech-green/25 bg-hextech-green/10 text-hextech-green',
  cyan: 'border-hextech-cyan/25 bg-hextech-cyan/10 text-hextech-cyan',
} as const

function KpiCard({ icon: Icon, label, value, unit, badge, footer, tone, accentValue }: {
  icon: any
  label: string
  value: string
  unit?: string
  badge?: ReactNode
  footer?: ReactNode
  tone: keyof typeof TONES
  accentValue?: boolean
}) {
  return (
    <div className={cn(panelClass, 'rounded-xl p-4 transition-colors hover:border-hextech-border')}>
      <div className="mb-2 flex items-center justify-between text-hextech-text">
        <span className="text-xs font-medium">{label}</span>
        <div className={cn('flex h-7 w-7 items-center justify-center rounded-lg border', TONES[tone])}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <div className="flex items-baseline gap-2">
        <span className={cn('font-mono text-2xl font-extrabold tabular-nums', accentValue ? 'text-hextech-gold' : 'text-hextech-text-bright')}>{value}</span>
        {unit && <span className="text-xs text-hextech-text">{unit}</span>}
        {badge}
      </div>
      {footer && (
        <div className="mt-2 flex items-center justify-between gap-1 border-t border-hextech-border-dim/50 pt-2 font-mono text-[11px]">
          {footer}
        </div>
      )}
    </div>
  )
}

/**
 * "Empreinte des fondamentaux" — compares the user's recent form (avg of
 * the last 15 games) against their longer snapshot (avg of the last 40
 * games), across the 9 KPIs of the reference design. Desktop-only (needs
 * the local Riot fetch pipeline), loads on its own so a slow Riot API
 * round-trip never blocks the rest of the dashboard.
 */
function FundamentalsRadarCard({ role }: { role: string | null }) {
  const { t } = useTranslation()
  const radar = useCachedQuery<{ recent: any; recentGameCount: number; snapshot: any; snapshotGameCount: number } | null>(
    'games:radar', () => window.api.getFundamentalsRadar(),
  )
  const data = radar.error ? null : radar.data
  const [showModal, setShowModal] = useState(false)


  if (data === undefined) {
    return (
      // About the loaded card's height: the column below does not jump when
      // the Riot round-trip ends.
      <section className={cn(panelClass, 'flex min-h-[22rem] items-center justify-center gap-2 p-6 text-xs text-hextech-text-dim')}>
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {t('dashboard.radar.loading')}
      </section>
    )
  }
  if (!data) return null

  const isSupport = radarAxesForRole(role) !== radarAxesForRole(null)
  const points = buildFundamentalsRadar(data.recent, data.snapshot, radarAxesForRole(role))
    .map((p) => ({ ...p, label: t(`dashboard.radar.axis.${p.key}`, { defaultValue: p.label }) }))
  const score = overallRadarScore(points)

  return (
    <>
      <section className={cn(panelClass, 'space-y-3 p-5')}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-hextech-text-bright">
            {t('dashboard.radar.title')}
            {isSupport && <span className="ml-2 rounded border border-hextech-cyan/40 bg-hextech-cyan/10 px-1.5 py-0.5 align-middle text-[10px] font-semibold text-hextech-cyan">{t('dashboard.radar.supportBadge')}</span>}
          </h3>
          {score !== null && (
            <span className="font-mono text-[10px] text-hextech-green">{t('dashboard.radar.score', { score })}</span>
          )}
        </div>
        <div className="rounded-xl border border-hextech-border-dim/60 bg-hextech-black/50 p-3">
          <FundamentalsRadarChart points={points} />
        </div>
        <div className="flex items-center justify-center gap-4 text-[10px] text-hextech-text-dim">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-hextech-gold" />
            {t('dashboard.radar.recentLabel', { count: data.recentGameCount })}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full border border-dashed border-slate-400" />
            {t('dashboard.radar.snapshotLabel', { count: data.snapshotGameCount })}
          </span>
        </div>
        <Button variant="outline" size="sm" className="w-full gap-2 text-xs" onClick={() => setShowModal(true)}>
          <Layers className="h-3.5 w-3.5 text-hextech-gold" />
          {t('dashboard.radar.fullBreakdown')}
        </Button>
      </section>

      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('dashboard.radar.modalTitle')}</DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] space-y-2 overflow-y-auto">
            {points.map((p) => {
              const diff = p.recentScore != null && p.snapshotScore != null ? p.recentScore - p.snapshotScore : null
              return (
                <div key={p.key} className="rounded-lg border border-hextech-border-dim bg-hextech-elevated p-3">
                  <div className="mb-1.5 flex items-center justify-between text-xs">
                    <span className="font-bold text-hextech-text-bright">{p.label}</span>
                    <div className="flex items-center gap-2 font-mono">
                      <span className="text-hextech-text-dim">
                        {fmtNum(p.snapshotRaw)}{p.unit} → <span className="text-hextech-text-bright">{fmtNum(p.recentRaw)}{p.unit}</span>
                      </span>
                      {diff !== null && (
                        <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-bold', diff >= 0 ? 'bg-hextech-green/15 text-hextech-green' : 'bg-hextech-red/15 text-hextech-red')}>
                          {diff >= 0 ? `+${diff}` : diff} pts
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="relative h-2 w-full overflow-hidden rounded-full bg-hextech-elevated">
                    <div className="absolute inset-y-0 left-0 rounded-full bg-slate-500/40" style={{ width: `${p.snapshotScore ?? 0}%` }} />
                    <div
                      className={cn('absolute inset-y-0 left-0 rounded-full', (p.recentScore ?? 0) >= 75 ? 'bg-hextech-green' : (p.recentScore ?? 0) >= 50 ? 'bg-hextech-gold' : 'bg-hextech-red')}
                      style={{ width: `${p.recentScore ?? 0}%`, opacity: 0.9 }}
                    />
                  </div>
                  {p.recentParts && (
                    <p className="mt-1.5 font-mono text-[10px] text-hextech-text-dim">
                      {p.recentParts
                        .map((part) => `${t(`dashboard.radar.parts.${part.key}`)} ${fmtNum(Math.round(part.value))}${part.weight === 1 ? '' : ` × ${part.weight.toLocaleString()}`}`)
                        .join(' + ')}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
          <DialogFooter>
            <Button onClick={() => setShowModal(false)}>{t('common.close')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function fmtNum(v: number | null): string {
  // Large values (gold, XP) read better as whole numbers: 6 277 g, not 6 277.4.
  return v != null ? v.toLocaleString(undefined, { maximumFractionDigits: Math.abs(v) >= 100 ? 0 : 2 }) : '—'
}

function MistakeFrequencyCard({ onViewAll }: { onViewAll: () => void }) {
  const { t } = useTranslation()
  const { data: rows } = useCachedQuery<MistakeTopTagEntry[]>('games:mistake-top-7d', () => window.api.getMistakeTopTags({ days: 7 }))
  const top = (rows ?? []).slice(0, 3)
  if (top.length === 0) return null

  return (
    <section className={cn(panelClass, 'p-5')}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-bold text-hextech-text-bright">
          <AlertTriangle className="h-4 w-4 text-amber-300" />
          {t('dashboard.mistakes.title')}
        </h3>
        <Button variant="ghost" size="sm" onClick={onViewAll} className="h-7 text-xs">
          {t('dashboard.mistakes.viewAll')}
          <ChevronRight className="ml-0.5 h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
        {top.map((entry) => (
          <div
            key={entry.tag.id}
            className="rounded-lg border border-hextech-border-dim bg-hextech-elevated/70 px-3 py-2.5"
            style={entry.tag.color ? { borderLeftColor: entry.tag.color, borderLeftWidth: 3 } : undefined}
          >
            <p className="truncate text-xs font-medium text-hextech-text-bright" title={entry.tag.label}>{entry.tag.label}</p>
            <p className="text-[10px] capitalize text-hextech-text-dim">{entry.tag.category}</p>
            <p className="mt-1 text-lg font-bold text-amber-200">{entry.count}<span className="ml-1 text-[10px] font-normal text-hextech-text-dim">{t('dashboard.mistakes.tagged')}</span></p>
          </div>
        ))}
      </div>
    </section>
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
      format: stat.format ?? ((v) => (typeof v === 'number' ? v.toLocaleString() : String(v))),
    })
  }
  // Rank by relative change so a +40 gold/min doesn't always beat a +1.0 CS/min.
  const rel = (d: StatDiffItem) => Math.abs(d.diff) / Math.max(Math.abs(d.prev), 1)
  return diffs.sort((a, b) => rel(b) - rel(a)).slice(0, 5)
}

/** Bar fills for the before/after gauge: both values on one shared scale
 *  that also covers 0, so negative stats (gold diff) still read correctly. */
export function comparisonFills(prev: number, curr: number): { prevFill: number; currFill: number } {
  const lo = Math.min(0, prev, curr)
  const hi = Math.max(0, prev, curr)
  const span = hi - lo || 1
  const pad = span * 0.15
  const toPct = (v: number) => Math.round(((v - lo + pad) / (span + pad * 2)) * 100)
  return { prevFill: toPct(prev), currFill: toPct(curr) }
}

/* ─── Sub-components ─── */

function ChampionIcon({ name, size = 48, className }: { name: string | null | undefined; size?: number; className?: string }) {
  const url = useChampionIconUrl(name)
  const [error, setError] = useState(false)

  if (!url || error) {
    return (
      <div
        style={{ width: size, height: size }}
        className={cn('flex shrink-0 items-center justify-center rounded-full border border-hextech-border-dim bg-hextech-elevated', className)}
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
      className={cn('shrink-0 rounded-full border-2 object-cover', className)}
      style={{ width: size, height: size }}
    />
  )
}

function timeAgo(iso: string, t: (k: string, o?: any) => string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return ''
  const h = Math.floor(ms / 3_600_000)
  if (h < 1) return t('dashboard.lastGame.justNow')
  if (h < 24) return t('dashboard.lastGame.hoursAgo', { count: h })
  return t('dashboard.lastGame.daysAgo', { count: Math.floor(h / 24) })
}

function LastGameCard({ game, onViewDetails, onReview }: { game: RecentGame; onViewDetails: () => void; onReview: () => void }) {
  const { t } = useTranslation()
  const kda = game.deaths === 0 ? 'Perfect' : ((game.kills + game.assists) / game.deaths).toFixed(2)
  const minutes = game.duration / 60
  const cspm = minutes > 0 ? game.cs / minutes : 0
  const vpm = minutes > 0 ? game.visionScore / minutes : 0
  const needsReview = game.reviewStatus && game.reviewStatus !== 'reviewed'

  return (
    <section className={cn(panelClass, 'overflow-hidden')}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hextech-border-dim/50 px-5 pb-3 pt-4">
        <div className="flex items-center gap-2.5">
          <Swords className="h-4 w-4 text-hextech-gold" />
          <h3 className="text-sm font-bold text-hextech-text-bright">{t('dashboard.lastGame.title')}</h3>
          <span className="text-[11px] text-hextech-text-dim">• {timeAgo(game.gameEndAt, t)}</span>
          {game.offSession && <span className="rounded border border-hextech-border-dim px-1.5 py-0.5 text-[10px] text-hextech-text-dim">{t('history.offSession.badge')}</span>}
        </div>
        {needsReview && (
          <button onClick={onReview} className="flex items-center gap-1 rounded border border-hextech-gold/30 bg-hextech-gold/15 px-2 py-0.5 text-[11px] font-medium text-hextech-gold-bright hover:bg-hextech-gold/25">
            <Sparkles className="h-3 w-3" /> {t('dashboard.lastGame.toReview')}
          </button>
        )}
      </div>

      <div className={cn(
        'flex flex-col justify-between gap-5 bg-gradient-to-r to-transparent p-5 lg:flex-row lg:items-center',
        game.win ? 'from-hextech-green/10 via-transparent' : 'from-hextech-red/10 via-transparent',
      )}>
        <div className="flex items-center gap-4">
          <div className={cn(
            'shrink-0 rounded-xl border px-3 py-2.5 text-center',
            game.win ? 'border-hextech-green/40 bg-hextech-green/15' : 'border-hextech-red/40 bg-hextech-red/15',
          )}>
            <div className={cn('text-xs font-extrabold uppercase tracking-wider', game.win ? 'text-hextech-green' : 'text-hextech-red')}>
              {game.win ? t('dashboard.lastGame.victory') : t('dashboard.lastGame.defeat')}
            </div>
            <div className="mt-0.5 font-mono text-[11px] text-hextech-text">{formatGameTime(game.duration)}</div>
          </div>
          <div className="flex items-center gap-3">
            <ChampionIcon name={game.champion} size={52} className={game.win ? 'border-hextech-green/50' : 'border-hextech-red/40'} />
            <span className="px-1 font-mono text-[10px] font-bold text-hextech-text-dim">VS</span>
            <ChampionIcon name={game.opponentChampion} size={40} className="border-hextech-border-dim opacity-80" />
          </div>
        </div>

        <div className="grid flex-1 grid-cols-2 gap-4 sm:grid-cols-4 lg:gap-6 lg:px-4">
          <Metric label="KDA" value={formatKDA(game.kills, game.deaths, game.assists)} sub={`${kda} ratio`} subClass="text-hextech-gold" />
          <Metric label="CS / min" icon={Target} value={cspm.toFixed(1)} sub={`${game.cs} CS`} />
          <Metric label="Vision" icon={Eye} value={String(game.visionScore)} sub={`${vpm.toFixed(2)} / min`} />
          <Metric label={t('dashboard.lastGame.duration')} icon={Clock} value={formatGameTime(game.duration)} sub={game.role} />
        </div>

        <Button variant="outline" size="sm" onClick={onViewDetails} className="shrink-0 gap-1.5 text-xs text-hextech-gold">
          {t('dashboard.lastGame.viewDetails')}
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </section>
  )
}

function Metric({ label, value, sub, icon: Icon, subClass }: { label: string; value: string; sub?: string; icon?: any; subClass?: string }) {
  return (
    <div>
      <div className="flex items-center gap-1 text-[11px] text-hextech-text-dim">
        {Icon && <Icon className="h-3 w-3" />}{label}
      </div>
      <div className="mt-0.5 font-mono text-sm font-bold text-hextech-text-bright">{value}</div>
      {sub && <div className={cn('font-mono text-[10px] capitalize text-hextech-text-dim', subClass)}>{sub}</div>}
    </div>
  )
}

function StatDiffsCard({ diffs, onViewAll }: { diffs: StatDiffItem[]; onViewAll: () => void }) {
  const { t } = useTranslation()
  return (
    <section className={cn(panelClass, 'p-5 lg:p-6')}>
      <div className="flex flex-col justify-between gap-2 border-b border-hextech-border-dim/50 pb-4 sm:flex-row sm:items-center">
        <div>
          <h3 className="flex items-center gap-2 text-base font-bold text-hextech-text-bright">
            <TrendingUp className="h-4 w-4 text-hextech-green" />
            {t('dashboard.statDiffs.title')}
          </h3>
          <p className="mt-0.5 text-xs text-hextech-text">{t('dashboard.statDiffs.vsSnap')}</p>
        </div>
        <button onClick={onViewAll} className="flex items-center gap-1 self-start text-xs font-semibold text-hextech-gold hover:text-hextech-gold-bright sm:self-center">
          {t('statsAvg.tabs.progression')}
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-4 space-y-2.5">
        {diffs.map((item) => {
          const good = item.higherIsBetter ? item.diff > 0 : item.diff < 0
          const bad = item.higherIsBetter ? item.diff < 0 : item.diff > 0
          const { prevFill, currFill } = comparisonFills(item.prev, item.curr)
          return (
            <div key={item.label} className={cn('rounded-xl border p-3.5', good ? 'border-hextech-green/20 bg-hextech-green/[0.04]' : 'border-hextech-border-dim/50 bg-hextech-black/40')}>
              <div className="grid grid-cols-1 items-center gap-3 md:grid-cols-12">
                <div className="text-xs font-bold text-hextech-text-bright md:col-span-3">{item.label}</div>
                <div className="md:col-span-5">
                  <div className="relative h-2 w-full overflow-hidden rounded-full bg-hextech-elevated">
                    <div className="absolute inset-y-0 left-0 rounded-full bg-slate-500/40" style={{ width: `${prevFill}%` }} />
                    <div
                      className={cn('absolute inset-y-0 left-0 rounded-full transition-all duration-500', good ? 'bg-gradient-to-r from-hextech-green/50 to-hextech-green' : bad ? 'bg-gradient-to-r from-hextech-red/50 to-hextech-red' : 'bg-hextech-text-dim')}
                      style={{ width: `${currFill}%`, opacity: 0.9 }}
                    />
                  </div>
                  <div className="mt-1 flex justify-between font-mono text-[10px] text-hextech-text-dim">
                    <span>{t('dashboard.statDiffs.prev')}</span>
                    <span className="text-hextech-text">{t('dashboard.statDiffs.now')}</span>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3 font-mono tabular-nums md:col-span-4 md:justify-end">
                  <span className="text-xs text-hextech-text-dim line-through">{item.format(item.prev)}</span>
                  <span className="text-hextech-text-dim">→</span>
                  <span className="text-sm font-bold text-hextech-text-bright">{item.format(item.curr)}</span>
                  <span className={cn(
                    'min-w-[68px] rounded-md border px-2 py-1 text-right text-xs font-bold',
                    good ? 'border-hextech-green/30 bg-hextech-green/15 text-hextech-green' : bad ? 'border-hextech-red/30 bg-hextech-red/15 text-hextech-red' : 'border-hextech-border-dim text-hextech-text-dim',
                  )}>
                    {item.diff > 0 ? '▲ +' : item.diff < 0 ? '▼ ' : ''}{item.diff.toFixed(1)}
                  </span>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
