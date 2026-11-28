import { useEffect, useState, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChampionMatchup } from '@/components/ChampionMatchup'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useLocalizedFundamental, useLocalizedFundamentals } from '@/lib/constants/useFundamentals'
import { formatKDA, formatGameTime } from '@/lib/utils'
import { useTranslation } from 'react-i18next'
import { localizeConclusion } from '@/lib/autoConclusion'
import {
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Swords,
  Eye,
  Brain,
  CheckCircle,
  Check,
  Clock,
  Loader2,
  BarChart3,
  FileSearch,
  Trash2,
  Video,
  X,
  CalendarClock,
  Plus,
} from 'lucide-react'
import { AccountBadge } from '@/components/ui/AccountBadge'
import { ShareSessionButton } from '@/components/Share/ShareSessionButton'
import { useUserStore } from '@/store/useUserStore'
import { cn } from '@/lib/utils'
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/data-state'
import { wrText } from '@/lib/winrate'
import { useCachedQuery } from '@/hooks/useCachedQuery'
import { HISTORY_KEY, fetchHistory } from '@/lib/pageQueries'
import { invalidateCached } from '@/lib/queryCache'
import { isShortReview } from '@/lib/shortReview'
import { parseObjectives } from '@/lib/customObjectives'
import { soloGameRank } from '@/components/Session/SoloPlayerSheet'
import { CustomObjectivesList } from '@/components/Session/CustomObjectivesList'

const NO_HISTORY: any[] = []

const GAMES_PAGE_SIZE = 20

/** The container of the games played outside a session (electron/main/offSessionGames.ts, contract account-region.md). */
const OFF_SESSION_OBJECTIVE_ID = '__review_only__'
/** An entry of games played outside a session: flagged by the server, or the off-session container. */
// 20/11: a session with written objectives and no fundamental has no objectiveId either: it is a real session.
const isOffSession = (s: { offSession?: boolean; objectiveId: string | null; customObjectives?: unknown }) =>
  s.offSession === true || s.objectiveId === OFF_SESSION_OBJECTIVE_ID || (!s.objectiveId && parseObjectives(s.customObjectives).length === 0)

interface SessionSummary {
  id: string
  /** Games recorded without an active session (decision of 20/11/2026): one entry per day, no objective. */
  offSession?: boolean
  objectiveId: string
  /** 20/11: the written objectives (JSON or array, Back-end). */
  customObjectives?: unknown
  subObjective: string | null
  customNote: string | null
  status: string
  date: string
  aiSummary: string | null
  sessionConclusion: string | null
  gamesPlayed: number
  reviewsCompleted: number
  wins: number
  losses: number
  objectiveSuccessRate: number | null
  avgKDA: number
  avgCSPerMin: number
  games: GameEntry[]
}

interface GameEntry {
  id: string
  matchId: string
  champion: string
  opponentChampion: string | null
  reviewStatus: 'pending' | 'to_be_reviewed' | 'reviewed'
  role: string
  kills: number
  deaths: number
  assists: number
  cs: number
  visionScore: number
  duration: number
  win: boolean
  gameEndAt: string
  accountName?: string
  accountProfileIconId?: number
  review: ReviewEntry | null
}

interface ReviewEntry {
  id: string
  freeText: string | null
  aiSummary: string | null
  objectiveRespected: boolean
  timelineNotes: string
  kpiScores: string
}

interface RiotGameEntry {
  gameId: string | null
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
  accountName: string
  accountProfileIconId?: number
  imported: boolean
  reviewed: boolean
  reviewStatus: 'pending' | 'to_be_reviewed' | 'reviewed'
}

type Tab = 'sessions' | 'games'

export function HistoryPage() {
  const { t } = useTranslation()
  const [tab, setTab] = useState<Tab>('games')

  return (
    <div className="space-y-4 animate-fade-in">
      <PageHeader />

      <div className="flex gap-1 rounded-lg bg-hextech-elevated p-1">
        <TabButton active={tab === 'games'} onClick={() => setTab('games')}>
          {t('history.tabs.games')}
        </TabButton>
        <TabButton active={tab === 'sessions'} onClick={() => setTab('sessions')}>
          {t('history.tabs.sessions')}
        </TabButton>
      </div>

      {tab === 'sessions' && <SessionsTab />}
      {tab === 'games' && <GamesTab />}
    </div>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors',
        active
          ? 'bg-hextech-dark text-hextech-gold-bright shadow-sm'
          : 'text-hextech-text-dim hover:text-hextech-text',
      )}
    >
      {children}
    </button>
  )
}

function PageHeader() {
  const { t } = useTranslation()
  return (
    <div>
      <h1 className="font-display text-2xl font-bold text-hextech-gold-bright">{t('history.title')}</h1>
      <p className="text-sm text-hextech-text mt-1">{t('history.subtitle')}</p>
    </div>
  )
}

/* ─── Games Tab: Riot API match history with reviewed/unreviewed tags ─── */

/** Map Riot teamPosition values to short display labels. */
const ROLE_LABELS: Record<string, string> = {
  TOP: 'TOP',
  JUNGLE: 'JGL',
  MIDDLE: 'MID',
  BOTTOM: 'BOT',
  UTILITY: 'SUP',
}
const ALL_ROLES = Object.keys(ROLE_LABELS)

function GamesTab() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const navigateToReview = (gameId: string | null) => navigate(gameId ? `/review?gameId=${gameId}` : '/review')
  const user = useUserStore((s) => s.user)
  // Cached (useCachedQuery): back on the page, the list shows at once and refreshes behind.
  const history = useCachedQuery<RiotGameEntry[]>(HISTORY_KEY, fetchHistory)
  const games = history.data ?? NO_HISTORY
  const loading = history.loading
  const error = history.error ? ((history.error as any)?.message || t('history.state.unknownCause')) as string : null
  const [page, setPage] = useState(0)

  // Role filter — restore from localStorage, fallback to main-role-only if user has mainRole set
  const [mainRoleOnly, setMainRoleOnly] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('history_filters')
      if (saved) return JSON.parse(saved).mainRoleOnly ?? !!user?.mainRole
    } catch { /* ignore */ }
    return !!user?.mainRole
  })
  const [selectedRoles, setSelectedRoles] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('history_filters')
      if (saved) return JSON.parse(saved).selectedRoles ?? ALL_ROLES
    } catch { /* ignore */ }
    return ALL_ROLES
  })

  // Account filter — null means all accounts shown
  const [selectedAccounts, setSelectedAccounts] = useState<string[] | null>(() => {
    try {
      const saved = localStorage.getItem('history_filters')
      if (saved) return JSON.parse(saved).selectedAccounts ?? null
    } catch { /* ignore */ }
    return null
  })

  // Persist filter state across navigation
  useEffect(() => {
    try {
      localStorage.setItem('history_filters', JSON.stringify({ mainRoleOnly, selectedRoles, selectedAccounts }))
    } catch { /* ignore */ }
  }, [mainRoleOnly, selectedRoles, selectedAccounts])


  const toggleRole = (role: string) => {
    setSelectedRoles((prev) =>
      prev.includes(role)
        ? prev.length === 1 ? prev : prev.filter((r) => r !== role)
        : [...prev, role],
    )
    setPage(0)
  }

  /** All distinct account names present in the loaded games */
  const availableAccounts = useMemo(
    () => [...new Set(games.map((g) => g.accountName).filter((n): n is string => !!n))],
    [games],
  )

  /**
   * Account toggle — isolates on first click (when everything is shown),
   * then adds/removes on subsequent clicks.
   */
  const toggleAccount = (name: string) => {
    setPage(0)
    if (selectedAccounts === null) {
      setSelectedAccounts([name])
      return
    }
    const next = selectedAccounts.includes(name)
      ? selectedAccounts.filter((a) => a !== name)
      : [...selectedAccounts, name]
    setSelectedAccounts(next.length === 0 ? null : next)
  }

  /** Games after applying role + account filters */
  const filteredGames = useMemo(() => {
    let result = games
    if (mainRoleOnly && user?.mainRole) {
      result = result.filter((g) => g.role === user.mainRole)
    } else if (selectedRoles.length < ALL_ROLES.length) {
      result = result.filter((g) => selectedRoles.includes(g.role))
    }
    if (selectedAccounts !== null) {
      result = result.filter((g) => g.accountName && selectedAccounts.includes(g.accountName))
    }
    return result
  }, [games, mainRoleOnly, selectedRoles, selectedAccounts, user?.mainRole])

  const totalPages = Math.ceil(filteredGames.length / GAMES_PAGE_SIZE)
  const visibleGames = filteredGames.slice(page * GAMES_PAGE_SIZE, (page + 1) * GAMES_PAGE_SIZE)
  const handlePrev = () => setPage((p) => Math.max(0, p - 1))
  const handleNext = () => setPage((p) => Math.min(totalPages - 1, p + 1))

  if (loading) return <SkeletonRows rows={6} />

  if (error) {
    return (
      <ErrorState
        title={t('history.state.gamesErrorTitle')}
        cause={error}
        hint={t('history.state.gamesErrorHint')}
        onRetry={() => { void history.reload().catch(() => {}) }}
      />
    )
  }

  if (games.length === 0) {
    return (
      <EmptyState
        icon={Swords}
        title={t('history.state.gamesEmptyTitle')}
        description={t('history.state.gamesEmptyDesc')}
      />
    )
  }

  return (
    <div className="space-y-3">
      {/* Filters row */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {/* Role filter */}
        {user?.mainRole && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => { setMainRoleOnly(true); setPage(0) }}
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                mainRoleOnly
                  ? 'border-hextech-gold bg-hextech-gold/10 text-hextech-gold-bright'
                  : 'border-hextech-border-dim text-hextech-text-dim hover:border-hextech-border',
              )}
            >
              {ROLE_LABELS[user.mainRole] ?? user.mainRole} only
            </button>
            <button
              onClick={() => { setMainRoleOnly(false); setPage(0) }}
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                !mainRoleOnly
                  ? 'border-hextech-cyan bg-hextech-cyan/10 text-hextech-cyan'
                  : 'border-hextech-border-dim text-hextech-text-dim hover:border-hextech-border',
              )}
            >
              All roles
            </button>
            {!mainRoleOnly && (
              <div className="flex gap-1.5 ml-1">
                {ALL_ROLES.map((role) => (
                  <button
                    key={role}
                    onClick={() => toggleRole(role)}
                    className={cn(
                      'rounded-full border px-2.5 py-0.5 text-[11px] font-semibold transition-colors',
                      selectedRoles.includes(role)
                        ? 'border-hextech-gold bg-hextech-gold/10 text-hextech-gold-bright'
                        : 'border-hextech-border-dim text-hextech-text hover:border-hextech-border',
                    )}
                  >
                    {ROLE_LABELS[role]}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Account filter — only shown when multiple accounts exist */}
        {availableAccounts.length > 1 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-hextech-text-dim">Compte :</span>
            <button
              onClick={() => { setSelectedAccounts(null); setPage(0) }}
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                selectedAccounts === null
                  ? 'border-hextech-gold bg-hextech-gold/10 text-hextech-gold-bright'
                  : 'border-hextech-border-dim text-hextech-text-dim hover:border-hextech-border',
              )}
            >
              Tous
            </button>
            {availableAccounts.map((name) => {
              const isActive = selectedAccounts === null || selectedAccounts.includes(name)
              return (
                <button
                  key={name}
                  onClick={() => toggleAccount(name)}
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                    isActive
                      ? 'border-hextech-cyan bg-hextech-cyan/10 text-hextech-cyan'
                      : 'border-hextech-border-dim text-hextech-text-dim opacity-50',
                  )}
                >
                  {name}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Pagination header */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-hextech-text-dim">
            {t('history.page', { current: page + 1, total: totalPages })}
          </span>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={handlePrev} disabled={page === 0} className="h-7 px-2 gap-1 text-xs">
              <ChevronLeft className="h-3 w-3" />
              {t('history.prevPage')}
            </Button>
            <Button variant="ghost" size="sm" onClick={handleNext} disabled={page >= totalPages - 1} className="h-7 px-2 gap-1 text-xs">
              {t('history.nextPage')}
              <ChevronRight className="h-3 w-3" />
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {visibleGames.map((game) => (
          <div
            key={game.matchId}
            className={cn(
              'rounded-lg border transition-colors',
              game.win
                ? 'border-hextech-green/20 bg-hextech-green/5'
                : 'border-[#E24C3A]/20 bg-[#E24C3A]/5',
            )}
          >
            <div className="flex items-center gap-3 p-3">
              <Badge variant={game.win ? 'success' : 'destructive'} className="shrink-0 w-8 justify-center">
                {game.win ? t('history.win') : t('history.loss')}
              </Badge>

              {/* Champion + matchup */}
              <div className="flex items-center gap-2 min-w-0 w-44">
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

              <div className="flex items-center gap-4 text-xs text-hextech-text flex-1">
                <span className="flex items-center gap-1">
                  <Swords className="h-3 w-3" />
                  {formatKDA(game.kills, game.deaths, game.assists)}
                </span>
                <span>{game.cs} CS ({game.duration > 0 ? (game.cs / (game.duration / 60)).toFixed(1) : '0'}/m)</span>
                <span className="flex items-center gap-1">
                  <Eye className="h-3 w-3" />
                  {game.visionScore}
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {formatGameTime(game.duration)}
                </span>
                <span className="text-hextech-text-dim">
                  {new Date(game.gameEndAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                </span>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {game.accountName && (
                  <AccountBadge name={game.accountName} profileIconId={game.accountProfileIconId} />
                )}

                {game.reviewed ? (
                  <button
                    onClick={() => navigateToReview(game.gameId)}
                    className="flex items-center gap-1 rounded-full border border-hextech-green/50 bg-hextech-green/5 px-2 py-0.5 text-[10px] text-hextech-green hover:bg-hextech-green/15 transition-colors cursor-pointer"
                  >
                    <CheckCircle className="h-3 w-3" />
                    {t('history.gamesTab.reviewed')}
                  </button>
                ) : isShortReview({ reviewStatus: game.reviewStatus, hasFullReview: !!game.reviewed }) ? (
                  <button
                    onClick={() => navigateToReview(game.gameId)}
                    className="flex items-center gap-1 rounded-full border border-hextech-cyan/50 bg-hextech-cyan/5 px-2 py-0.5 text-[10px] text-hextech-cyan hover:bg-hextech-cyan/15 transition-colors cursor-pointer"
                    title={t('history.gamesTab.shortReviewHint')}
                  >
                    <CheckCircle className="h-3 w-3" />
                    {t('history.gamesTab.shortReview')}
                  </button>
                ) : game.imported && game.reviewStatus === 'to_be_reviewed' ? (
                  <button
                    onClick={() => navigateToReview(game.gameId)}
                    className="flex items-center gap-1 rounded-full border border-hextech-cyan/50 bg-hextech-cyan/5 px-2 py-0.5 text-[10px] text-hextech-cyan hover:bg-hextech-cyan/15 transition-colors"
                  >
                    <Clock className="h-3 w-3" />
                    {t('history.gamesTab.toBeReviewed')}
                  </button>
                ) : game.imported ? (
                  <button
                    onClick={() => navigateToReview(game.gameId)}
                    className="flex items-center gap-1 rounded-full border border-hextech-gold/40 bg-hextech-gold/5 px-2 py-0.5 text-[10px] text-hextech-gold hover:bg-hextech-gold/15 transition-colors"
                  >
                    <FileSearch className="h-3 w-3" />
                    {t('history.gamesTab.unreviewed')}
                  </button>
                ) : (
                  <Badge variant="outline" className="border-hextech-border-dim text-hextech-text-dim text-[10px]">
                    {t('history.gamesTab.notImported')}
                  </Badge>
                )}

                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs gap-1 text-hextech-text-dim hover:text-hextech-gold"
                  onClick={() => navigate(`/stats/${game.matchId}`)}
                >
                  <BarChart3 className="h-3 w-3" />
                  {t('history.gamesTab.details')}
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Pagination footer */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={handlePrev} disabled={page === 0} className="gap-1 text-xs">
            <ChevronLeft className="h-3 w-3" />
            {t('history.prevPage')}
          </Button>
          <span className="text-xs text-hextech-text-dim px-2">
            {t('history.page', { current: page + 1, total: totalPages })}
          </span>
          <Button variant="outline" size="sm" onClick={handleNext} disabled={page >= totalPages - 1} className="gap-1 text-xs">
            {t('history.nextPage')}
            <ChevronRight className="h-3 w-3" />
          </Button>
        </div>
      )}
    </div>
  )
}

/* ─── Sessions Tab: month-grouped, selectable, paginated ─── */

const SESSIONS_PAGE_SIZE = 10

function getMonthKey(dateStr: string): string {
  const d = new Date(dateStr)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function formatMonthLabel(monthKey: string): string {
  const [y, m] = monthKey.split('-')
  const d = new Date(Number(y), Number(m) - 1, 1)
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

function buildSessionPageNumbers(current: number, total: number): Array<number | '…'> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const pages: Array<number | '…'> = [1]
  if (current > 3) pages.push('…')
  for (let p = Math.max(2, current - 1); p <= Math.min(total - 1, current + 1); p++) pages.push(p)
  if (current < total - 2) pages.push('…')
  pages.push(total)
  return pages
}

function SessionCheckbox({ checked, indeterminate, onChange, className, label }: { checked: boolean; indeterminate?: boolean; onChange: () => void; className?: string; label: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate && !checked ? 'mixed' : checked}
      aria-label={label}
      onClick={(e) => { e.stopPropagation(); onChange() }}
      className={cn(
        'w-5 h-5 rounded border-2 flex items-center justify-center transition-colors cursor-pointer shrink-0',
        checked || indeterminate
          ? 'bg-hextech-gold border-hextech-gold'
          : 'bg-black/40 border-white/30 hover:border-hextech-gold/60',
        className,
      )}
    >
      {indeterminate && !checked && <span aria-hidden className="w-2.5 h-0.5 bg-black rounded" />}
      {checked && <Check className="h-3 w-3 text-black" aria-hidden />}
    </button>
  )
}

function SessionsTab() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [collapsedMonths, setCollapsedMonths] = useState<Set<string>>(new Set())
  const [currentPage, setCurrentPage] = useState(1)
  const [bulkDeleting, setBulkDeleting] = useState(false)

  useEffect(() => {
    window.api
      .listSessions()
      .then((data) => {
        setSessions(data)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const totalPages = Math.max(1, Math.ceil(sessions.length / SESSIONS_PAGE_SIZE))
  const safePage = Math.min(currentPage, totalPages)

  const pageSessions = useMemo(
    () => sessions.slice((safePage - 1) * SESSIONS_PAGE_SIZE, safePage * SESSIONS_PAGE_SIZE),
    [sessions, safePage],
  )

  const monthGroups = useMemo(() => {
    const map = new Map<string, SessionSummary[]>()
    for (const s of pageSessions) {
      const key = getMonthKey(s.date)
      const arr = map.get(key) ?? []
      arr.push(s)
      map.set(key, arr)
    }
    return Array.from(map.entries()).sort(([a], [b]) => b.localeCompare(a))
  }, [pageSessions])

  // T (UI-13): which games of this page have a recording, in ONE grouped call (was one getRecording per game row).
  // Optional IPC (absent on the web): no call, no recording badge.
  const [recordedIds, setRecordedIds] = useState<Set<string>>(new Set())
  const pageGameIds = useMemo(() => pageSessions.flatMap((s) => s.games.map((g) => g.id)).slice(0, 1000), [pageSessions])
  const pageGameKey = pageGameIds.join(',')
  useEffect(() => {
    if (pageGameIds.length === 0 || !window.api.recordingGameIdsWithRecording) { setRecordedIds(new Set()); return }
    let alive = true
    window.api.recordingGameIdsWithRecording(pageGameIds)
      .then((ids) => { if (alive) setRecordedIds(new Set(ids)) })
      .catch(() => { /* no badge on failure */ })
    return () => { alive = false }
    // pageGameKey stands for pageGameIds (same ids → no new call).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageGameKey])

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleSelectMonth = useCallback((ids: string[]) => {
    setSelectedIds((prev) => {
      const allSelected = ids.every((id) => prev.has(id))
      const next = new Set(prev)
      if (allSelected) {
        ids.forEach((id) => next.delete(id))
      } else {
        ids.forEach((id) => next.add(id))
      }
      return next
    })
  }, [])

  const toggleMonthCollapse = useCallback((monthKey: string) => {
    setCollapsedMonths((prev) => {
      const next = new Set(prev)
      if (next.has(monthKey)) next.delete(monthKey)
      else next.add(monthKey)
      return next
    })
  }, [])

  const handleDelete = useCallback(async (id: string) => {
    try {
      await window.api.deleteSession(id)
      invalidateCached('games:') // the game lists (History, Stats, Dashboard) refetch
      setSessions((prev) => prev.filter((s) => s.id !== id))
      setSelectedIds((prev) => { const next = new Set(prev); next.delete(id); return next })
      if (expandedId === id) setExpandedId(null)
    } catch (err) {
      console.error('[history] Failed to delete session:', err)
    }
  }, [expandedId])

  const handleBulkDelete = useCallback(async () => {
    if (selectedIds.size === 0) return
    setBulkDeleting(true)
    try {
      await window.api.bulkDeleteSessions(Array.from(selectedIds))
      invalidateCached('games:') // the game lists (History, Stats, Dashboard) refetch
      setSessions((prev) => prev.filter((s) => !selectedIds.has(s.id)))
      if (expandedId && selectedIds.has(expandedId)) setExpandedId(null)
      setSelectedIds(new Set())
    } catch (err) {
      console.error('[history] Failed to bulk delete sessions:', err)
    } finally {
      setBulkDeleting(false)
    }
  }, [selectedIds, expandedId])

  const handleGameDelete = useCallback((sessionId: string, gameId: string) => {
    setSessions((prev) =>
      prev.map((s) =>
        s.id === sessionId ? { ...s, games: s.games.filter((g) => g.id !== gameId) } : s,
      ),
    )
  }, [])

  if (loading) return <SkeletonRows rows={4} />

  if (sessions.length === 0) {
    return (
      <EmptyState
        icon={CalendarClock}
        title={t('history.state.sessionsEmptyTitle')}
        description={t('history.state.sessionsEmptyDesc')}
        action={{ label: t('history.state.createSession'), onClick: () => navigate('/session'), icon: Plus }}
      />
    )
  }

  return (
    <div className="space-y-3">
      {/* Pagination top */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={safePage === 1}
            className={cn(
              'flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors',
              safePage === 1
                ? 'border-hextech-border-dim/40 text-hextech-text-dim/30 bg-hextech-dark/40 cursor-not-allowed'
                : 'border-hextech-border-dim text-hextech-text-dim bg-hextech-elevated hover:border-hextech-gold/50 hover:text-hextech-text',
            )}
          >
            <ChevronLeft className="h-4 w-4" />Prev
          </button>

          <div className="flex items-center gap-1">
            {buildSessionPageNumbers(safePage, totalPages).map((entry, i) =>
              entry === '…' ? (
                <span key={`ellipsis-${i}`} className="w-8 text-center text-hextech-text-dim/40 text-sm select-none">…</span>
              ) : (
                <button
                  key={entry}
                  onClick={() => setCurrentPage(entry as number)}
                  className={cn(
                    'w-8 h-8 rounded-lg border text-sm font-medium transition-colors',
                    entry === safePage
                      ? 'border-hextech-gold bg-hextech-gold/10 text-hextech-gold-bright'
                      : 'border-hextech-border-dim/60 text-hextech-text-dim bg-hextech-dark/60 hover:border-hextech-gold/40 hover:text-hextech-text',
                  )}
                >
                  {entry}
                </button>
              ),
            )}
          </div>

          <button
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            disabled={safePage === totalPages}
            className={cn(
              'flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors',
              safePage === totalPages
                ? 'border-hextech-border-dim/40 text-hextech-text-dim/30 bg-hextech-dark/40 cursor-not-allowed'
                : 'border-hextech-gold/60 text-hextech-gold bg-hextech-gold/10 hover:bg-hextech-gold/20',
            )}
          >
            Next<ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Month groups */}
      {monthGroups.map(([monthKey, monthSessions]) => {
        const monthIds = monthSessions.map((s) => s.id)
        const allMonthSelected = monthIds.length > 0 && monthIds.every((id) => selectedIds.has(id))
        const someMonthSelected = monthIds.some((id) => selectedIds.has(id))
        const isCollapsed = collapsedMonths.has(monthKey)

        return (
          <div key={monthKey} className="mb-4">
            {/* Month header */}
            <div className="flex items-center gap-3 mb-3">
              <SessionCheckbox
                checked={allMonthSelected}
                indeterminate={someMonthSelected && !allMonthSelected}
                onChange={() => toggleSelectMonth(monthIds)}
                label={t('history.select.month')}
              />
              <button
                onClick={() => toggleMonthCollapse(monthKey)}
                className="flex items-center gap-2 flex-1 min-w-0 text-left"
              >
                <span className="text-sm font-semibold text-hextech-text-bright capitalize">
                  {formatMonthLabel(monthKey)}
                </span>
                <span className="text-xs text-hextech-text-dim/60 shrink-0">{monthSessions.length}</span>
                {isCollapsed
                  ? <ChevronDown className="h-4 w-4 text-hextech-text-dim/60 shrink-0" />
                  : <ChevronUp className="h-4 w-4 text-hextech-text-dim/60 shrink-0" />}
              </button>
            </div>

            {/* Sessions */}
            {!isCollapsed && (
              <div className="space-y-3">
                {monthSessions.map((session) => (
                  <SessionCard
                    key={session.id}
                    session={session}
                    isSelected={selectedIds.has(session.id)}
                    onToggleSelect={() => toggleSelect(session.id)}
                    expanded={expandedId === session.id}
                    onToggle={() => setExpandedId(expandedId === session.id ? null : session.id)}
                    onDelete={handleDelete}
                    onGameDelete={(gameId) => handleGameDelete(session.id, gameId)}
                    recordedIds={recordedIds}
                  />
                ))}
              </div>
            )}
          </div>
        )
      })}

      {/* Pagination bottom */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <button
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={safePage === 1}
            className={cn(
              'flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors',
              safePage === 1
                ? 'border-hextech-border-dim/40 text-hextech-text-dim/30 bg-hextech-dark/40 cursor-not-allowed'
                : 'border-hextech-border-dim text-hextech-text-dim bg-hextech-elevated hover:border-hextech-gold/50 hover:text-hextech-text',
            )}
          >
            <ChevronLeft className="h-4 w-4" />Prev
          </button>

          <div className="flex items-center gap-1">
            {buildSessionPageNumbers(safePage, totalPages).map((entry, i) =>
              entry === '…' ? (
                <span key={`ellipsis-${i}`} className="w-8 text-center text-hextech-text-dim/40 text-sm select-none">…</span>
              ) : (
                <button
                  key={entry}
                  onClick={() => setCurrentPage(entry as number)}
                  className={cn(
                    'w-8 h-8 rounded-lg border text-sm font-medium transition-colors',
                    entry === safePage
                      ? 'border-hextech-gold bg-hextech-gold/10 text-hextech-gold-bright'
                      : 'border-hextech-border-dim/60 text-hextech-text-dim bg-hextech-dark/60 hover:border-hextech-gold/40 hover:text-hextech-text',
                  )}
                >
                  {entry}
                </button>
              ),
            )}
          </div>

          <button
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            disabled={safePage === totalPages}
            className={cn(
              'flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors',
              safePage === totalPages
                ? 'border-hextech-border-dim/40 text-hextech-text-dim/30 bg-hextech-dark/40 cursor-not-allowed'
                : 'border-hextech-gold/60 text-hextech-gold bg-hextech-gold/10 hover:bg-hextech-gold/20',
            )}
          >
            Next<ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-xl bg-hextech-dark/95 backdrop-blur border border-hextech-border-dim shadow-2xl px-4 py-2.5">
          <span className="text-sm font-medium text-hextech-text-bright">
            {selectedIds.size} {t('history.selected', { count: selectedIds.size, defaultValue: 'selected' })}
          </span>
          <div className="h-4 w-px bg-hextech-border-dim" />

          <button
            onClick={handleBulkDelete}
            disabled={bulkDeleting}
            className="flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs bg-[#E24C3A]/10 border border-[#E24C3A]/40 text-[#E24C3A] hover:bg-[#E24C3A]/20 transition-colors font-medium disabled:opacity-50"
          >
            {bulkDeleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            {t('history.deleteSelected', { defaultValue: 'Delete' })}
          </button>

          <button
            onClick={() => setSelectedIds(new Set())}
            className="text-hextech-text-dim/60 hover:text-hextech-text-dim transition-colors ml-1"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  )
}

function SessionCard({ session, isSelected, onToggleSelect, expanded, onToggle, onDelete, onGameDelete, recordedIds }: { session: SessionSummary; isSelected: boolean; onToggleSelect: () => void; expanded: boolean; onToggle: () => void; onDelete: (id: string) => void; onGameDelete: (gameId: string) => void; recordedIds: Set<string> }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const fundamental = useLocalizedFundamental(session.objectiveId)
  const written = parseObjectives(session.customObjectives)
  const dateStr = new Date(session.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
  const winRate = session.gamesPlayed > 0 ? Math.round((session.wins / session.gamesPlayed) * 100) : 0

  return (
    <Card className={cn(
      'transition-colors',
      session.status === 'active' && 'border-hextech-green/40',
      isSelected && 'border-hextech-gold/60 ring-1 ring-hextech-gold/30',
    )}>
      <CardHeader className="cursor-pointer select-none" onClick={onToggle}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <SessionCheckbox checked={isSelected} onChange={onToggleSelect} className="mt-1" label={t('history.select.session')} />
            <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-hextech-text-bright truncate">
                {isOffSession(session) ? t('history.offSession.title') : fundamental?.label || session.objectiveId || written.map((o) => o.text).join(' · ')}
              </span>
              {isOffSession(session) && <Badge variant="outline" className="shrink-0 text-xs text-hextech-text-dim">{t('history.offSession.badge')}</Badge>}
              {session.subObjective && (
                <Badge variant="outline" className="text-xs shrink-0">{session.subObjective}</Badge>
              )}
              {session.status === 'active' ? (
                <Badge variant="success" className="shrink-0">{t('history.status.active')}</Badge>
              ) : (
                <Badge variant="outline" className="shrink-0 text-hextech-text-dim">{t('history.status.completed')}</Badge>
              )}
            </div>
            <div className="flex items-center gap-1 mt-1 text-xs text-hextech-text-dim">
              <Clock className="h-3 w-3" />
              {dateStr}
            </div>
          </div>
          </div>

          <div className="flex items-center gap-6 shrink-0">
            <Stat label={t('history.stats.games')} value={session.gamesPlayed.toString()} />
            <Stat label={t('history.stats.winRate')} value={`${winRate}%`} toneClass={wrText(winRate, session.gamesPlayed)} />
            {session.objectiveSuccessRate !== null && (
              <Stat label={t('history.stats.objPct')} value={`${session.objectiveSuccessRate}%`} highlight={session.objectiveSuccessRate >= 50} />
            )}
            <Stat label={t('history.stats.kda')} value={session.avgKDA.toFixed(2)} />
            <Stat label={t('history.stats.csMin')} value={session.avgCSPerMin.toFixed(1)} />
            {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- event barrier only: stops the click from reaching the clickable row; the buttons inside handle the keyboard. */}
            <div onClick={(e) => e.stopPropagation()} className={cn(isOffSession(session) && 'hidden')}>
              <ShareSessionButton
                data={{
                  objectiveId: session.objectiveId,
                  subObjective: session.subObjective,
                  customNote: session.customNote,
                  date: session.date,
                  wins: session.wins,
                  losses: session.losses,
                  gamesPlayed: session.gamesPlayed,
                  avgKDA: session.avgKDA,
                  avgCSPerMin: session.avgCSPerMin,
                  objectiveSuccessRate: session.objectiveSuccessRate,
                  aiSummary: session.aiSummary,
                  sessionConclusion: session.sessionConclusion,
                  games: session.games.map((g) => ({
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
            </div>
            <Button variant="outline" size="sm" className="ml-2 h-7 shrink-0 border-hextech-gold/60 px-2 text-xs text-hextech-gold" disabled={session.games.length === 0}
              title={session.games.length === 0 ? t('playerSheet.noGamesTip') : undefined}
              onClick={(e) => { e.stopPropagation(); navigate(`/history/session/${encodeURIComponent(session.id)}/stats`) }}>
              {t('playerSheet.myStats')}
            </Button>
            {confirmDelete ? (
              // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- event barrier only: stops the click from reaching the clickable row; the buttons inside handle the keyboard.
              <div className="flex items-center gap-1 ml-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                <Button
                  size="sm"
                  variant="destructive"
                  className="h-6 px-2 text-[10px]"
                  onClick={() => onDelete(session.id)}
                >
                  {t('history.confirmDelete')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-[10px]"
                  onClick={() => setConfirmDelete(false)}
                >
                  {t('history.cancelDelete')}
                </Button>
              </div>
            ) : (
              <button
                className="text-hextech-text-dim hover:text-[#E24C3A] transition-colors ml-2 shrink-0"
                title={t('history.deleteSession')}
                onClick={(e) => { e.stopPropagation(); setConfirmDelete(true) }}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
            <button className="text-hextech-text-dim hover:text-hextech-text transition-colors ml-1">
              {expanded ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {/* 20/11: the written objectives, under the fundamental (alone, they are the card's title). */}
        {written.length > 0 && (session.objectiveId || written.length > 1) && <CustomObjectivesList objectives={written} className="mt-2" />}
        {session.customNote && (
          <p className="text-xs text-hextech-text italic mt-2">"{session.customNote}"</p>
        )}
      </CardHeader>

      {expanded && (
        <CardContent className="pt-0 space-y-4 border-t border-hextech-border-dim">
          {(session.sessionConclusion || session.aiSummary) && (
            <div className="flex gap-3 rounded-lg bg-hextech-elevated p-3 mt-4">
              <Brain className="h-4 w-4 text-hextech-cyan shrink-0 mt-0.5" />
              <p className="text-sm text-hextech-text leading-relaxed">
                {session.sessionConclusion ? localizeConclusion(session.sessionConclusion, t) : session.aiSummary}
              </p>
            </div>
          )}

          <div className="space-y-2">
            {session.games.map((game, idx) => (
              <GameRow
                key={game.id}
                game={game}
                index={idx + 1}
                hasRecording={recordedIds.has(game.id)}
                onDelete={(id) => onGameDelete(id)}
                statsPath={`/history/session/${encodeURIComponent(session.id)}/stats?game=${soloGameRank(session.games, game.id)}`}
              />
            ))}
          </div>

          {session.games.length === 0 && (
            <p className="text-sm text-hextech-text-dim py-4 text-center">{t('history.noGames')}</p>
          )}
        </CardContent>
      )}
    </Card>
  )
}

function GameRow({ game, index, hasRecording, onDelete, statsPath }: { game: GameEntry; index: number; hasRecording: boolean; onDelete?: (id: string) => void; statsPath?: string }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const kpiCategories = useLocalizedFundamentals()
  const allKpis = kpiCategories.flatMap((c) => c.fundamentals).flatMap((f) => f.kpis ?? [])
  const [reviewExpanded, setReviewExpanded] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const csPerMin = game.duration > 0 ? (game.cs / (game.duration / 60)).toFixed(1) : '0'

  const handleDelete = async () => {
    setDeleting(true)
    try {
      await window.api.deleteGame(game.id)
      invalidateCached('games:') // the game lists (History, Stats, Dashboard) refetch
      onDelete?.(game.id)
      setConfirmDelete(false)
    } catch {
      // ignore
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className={cn(
      'rounded-md border transition-colors',
      game.win ? 'border-hextech-green/20 bg-hextech-green/5' : 'border-[#E24C3A]/20 bg-[#E24C3A]/5',
    )}>
      <div className="flex items-center gap-4 p-3">
        <span className="text-xs text-hextech-text-dim w-5 shrink-0">#{index}</span>

        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Badge variant={game.win ? 'success' : 'destructive'} className="shrink-0">
            {game.win ? t('history.win') : t('history.loss')}
          </Badge>
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
              <span className="text-[10px] text-hextech-text-dim">vs {game.opponentChampion}</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-4 text-xs text-hextech-text shrink-0">
          <span className="flex items-center gap-1">
            <Swords className="h-3 w-3" />
            {formatKDA(game.kills, game.deaths, game.assists)}
          </span>
          <span>{game.cs} CS ({csPerMin}/m)</span>
          <span className="flex items-center gap-1">
            <Eye className="h-3 w-3" />
            {game.visionScore}
          </span>
          <span>{formatGameTime(game.duration)}</span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {game.accountName && (
            <AccountBadge name={game.accountName} profileIconId={game.accountProfileIconId} />
          )}

          {game.review ? (
            <button
              onClick={() => navigate(`/review?gameId=${game.id}`)}
              className="flex items-center gap-1 rounded-full border border-hextech-green/50 bg-hextech-green/5 px-2 py-0.5 text-[10px] text-hextech-green hover:bg-hextech-green/15 transition-colors cursor-pointer"
            >
              <CheckCircle className="h-3 w-3" />
              {t('history.gamesTab.reviewed')}
            </button>
          ) : isShortReview({ reviewStatus: game.reviewStatus, hasFullReview: !!game.review }) ? (
            <button
                    onClick={() => navigate(`/review?gameId=${game.id}`)}
                    className="flex items-center gap-1 rounded-full border border-hextech-cyan/50 bg-hextech-cyan/5 px-2 py-0.5 text-[10px] text-hextech-cyan hover:bg-hextech-cyan/15 transition-colors cursor-pointer"
                    title={t('history.gamesTab.shortReviewHint')}
                  >
                    <CheckCircle className="h-3 w-3" />
                    {t('history.gamesTab.shortReview')}
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
            <button
              onClick={() => navigate(`/review?gameId=${game.id}`)}
              className="flex items-center gap-1 rounded-full border border-hextech-gold/40 bg-hextech-gold/5 px-2 py-0.5 text-[10px] text-hextech-gold hover:bg-hextech-gold/15 transition-colors"
            >
              <FileSearch className="h-3 w-3" />
              {t('history.gamesTab.unreviewed')}
            </button>
          )}

          {hasRecording && (
            <span title="Has recording" className="flex items-center text-hextech-cyan">
              <Video className="h-3.5 w-3.5" />
            </span>
          )}

          {game.review && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => setReviewExpanded(!reviewExpanded)}
            >
              {t('history.reviewButton')} {reviewExpanded ? <ChevronUp className="h-3 w-3 ml-1" /> : <ChevronDown className="h-3 w-3 ml-1" />}
            </Button>
          )}

          {statsPath && (
            <Button variant="outline" size="sm" className="h-6 border-hextech-gold/60 px-2 text-xs text-hextech-gold" onClick={() => navigate(statsPath)}>
              {t('playerSheet.gameSheet')}
            </Button>
          )}

          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs gap-1 text-hextech-text-dim hover:text-hextech-gold"
            onClick={() => navigate(`/stats/${game.matchId}`)}
          >
            <BarChart3 className="h-3 w-3" />
          </Button>

          {onDelete && (
            confirmDelete ? (
              // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- event barrier only: stops the click from reaching the clickable row; the buttons inside handle the keyboard.
              <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                <Button
                  size="sm"
                  variant="destructive"
                  className="h-6 px-2 text-[10px]"
                  onClick={handleDelete}
                  disabled={deleting}
                >
                  {deleting ? <Loader2 className="h-3 w-3 animate-spin" /> : t('history.confirmDelete')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-[10px]"
                  onClick={() => setConfirmDelete(false)}
                >
                  {t('history.cancelDelete')}
                </Button>
              </div>
            ) : (
              <button
                className="text-hextech-text-dim hover:text-[#E24C3A] transition-colors"
                title={t('history.deleteGame')}
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )
          )}
        </div>
      </div>

      {reviewExpanded && game.review && (
        <div className="border-t border-hextech-border-dim mx-3 py-3 space-y-3">
          {game.review.aiSummary && (
            <div className="flex gap-2">
              <Brain className="h-3.5 w-3.5 text-hextech-cyan shrink-0 mt-0.5" />
              <p className="text-xs text-hextech-text leading-relaxed">{game.review.aiSummary}</p>
            </div>
          )}

          {game.review.freeText && (
            <div className="rounded bg-hextech-elevated px-3 py-2">
              <p className="text-xs text-hextech-text italic">"{game.review.freeText}"</p>
            </div>
          )}

          {(() => {
            let notes: Array<{ time: string; note: string }> = []
            try { notes = JSON.parse(game.review.timelineNotes) } catch {}
            if (notes.length === 0) return null
            return (
              <div className="space-y-1">
                {notes.map((n, i) => (
                  <div key={i} className="flex gap-2 text-xs">
                    <span className="text-hextech-gold font-mono shrink-0">{n.time}</span>
                    <span className="text-hextech-text">{n.note}</span>
                  </div>
                ))}
              </div>
            )
          })()}

          {(() => {
            let kpiMap: Record<string, number> = {}
            try { kpiMap = JSON.parse(game.review.kpiScores) } catch {}
            const entries = Object.entries(kpiMap)
            if (entries.length === 0) return null
            return (
              <div className="space-y-1.5 pt-1">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-hextech-text-dim">KPI Scores</p>
                {entries.map(([id, score]) => {
                  const label = allKpis.find((k) => k.id === id)?.label ?? id
                  const pct = Math.round((score / 10) * 100)
                  return (
                    <div key={id} className="flex items-center gap-2 text-xs">
                      <span className="text-hextech-text w-36 truncate shrink-0">{label}</span>
                      <div className="flex-1 h-1.5 rounded-full bg-hextech-border-dim overflow-hidden">
                        <div
                          className="h-full rounded-full bg-hextech-gold transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-hextech-text-dim w-8 text-right shrink-0">{score}/10</span>
                    </div>
                  )
                })}
              </div>
            )
          })()}
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, highlight, toneClass }: { label: string; value: string; highlight?: boolean; toneClass?: string }) {
  return (
    <div className="text-center">
      <div className={cn('text-sm font-bold', toneClass ?? (highlight ? 'text-hextech-green' : 'text-hextech-text-bright'))}>
        {value}
      </div>
      <div className="text-xs text-hextech-text-dim">{label}</div>
    </div>
  )
}
