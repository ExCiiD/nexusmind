import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChampionMatchup } from '@/components/ChampionMatchup'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useLocalizedFundamental, useLocalizedFundamentals } from '@/lib/constants/useFundamentals'
import { formatKDA, formatGameTime } from '@/lib/utils'
import { useTranslation } from 'react-i18next'
import {
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Swords,
  Eye,
  Brain,
  CheckCircle,
  Clock,
  Loader2,
  BarChart3,
  FileSearch,
  Trash2,
  Video,
} from 'lucide-react'
import { AccountBadge } from '@/components/ui/AccountBadge'
import { ShareSessionButton } from '@/components/Share/ShareSessionButton'
import { useUserStore } from '@/store/useUserStore'
import { cn } from '@/lib/utils'

const GAMES_PAGE_SIZE = 20

interface SessionSummary {
  id: string
  objectiveId: string
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
  const [games, setGames] = useState<RiotGameEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
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

  useEffect(() => {
    setLoading(true)
    setError(null)
    window.api.getMatchHistoryWithStatus(100)
      .then((data: any[]) => setGames(data))
      .catch((err: any) => setError(err.message ?? 'Failed to fetch'))
      .finally(() => setLoading(false))
  }, [])

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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 gap-2 text-hextech-text-dim">
        <Loader2 className="h-5 w-5 animate-spin" />
        {t('history.loading')}
      </div>
    )
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-[#FF4655]">{error}</CardContent>
      </Card>
    )
  }

  if (games.length === 0) {
    return (
      <Card>
        <CardContent className="py-16 text-center text-hextech-text-dim">
          {t('history.gamesTab.empty')}
        </CardContent>
      </Card>
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
                        : 'border-hextech-border-dim text-hextech-text-dim opacity-50',
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
                : 'border-[#FF4655]/20 bg-[#FF4655]/5',
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
                  <Badge variant="outline" className="border-hextech-green/50 text-hextech-green text-[10px] gap-1">
                    <CheckCircle className="h-3 w-3" />
                    {t('history.gamesTab.reviewed')}
                  </Badge>
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

/* ─── Sessions Tab: existing session-level history ─── */

function SessionsTab() {
  const { t } = useTranslation()
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  useEffect(() => {
    window.api
      .listSessions()
      .then((data) => {
        setSessions(data)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const handleDelete = async (id: string) => {
    try {
      await window.api.deleteSession(id)
      setSessions((prev) => prev.filter((s) => s.id !== id))
      if (expandedId === id) setExpandedId(null)
    } catch (err) {
      console.error('[history] Failed to delete session:', err)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 gap-2 text-hextech-text-dim">
        <Loader2 className="h-5 w-5 animate-spin" />
        {t('history.loading')}
      </div>
    )
  }

  if (sessions.length === 0) {
    return (
      <Card>
        <CardContent className="py-16 text-center text-hextech-text-dim">
          {t('history.empty')}
        </CardContent>
      </Card>
    )
  }

  const handleGameDelete = (sessionId: string, gameId: string) => {
    setSessions((prev) =>
      prev.map((s) =>
        s.id === sessionId ? { ...s, games: s.games.filter((g) => g.id !== gameId) } : s,
      ),
    )
  }

  return (
    <div className="space-y-3">
      {sessions.map((session) => (
        <SessionCard
          key={session.id}
          session={session}
          expanded={expandedId === session.id}
          onToggle={() => setExpandedId(expandedId === session.id ? null : session.id)}
          onDelete={handleDelete}
          onGameDelete={(gameId) => handleGameDelete(session.id, gameId)}
        />
      ))}
    </div>
  )
}

function SessionCard({ session, expanded, onToggle, onDelete, onGameDelete }: { session: SessionSummary; expanded: boolean; onToggle: () => void; onDelete: (id: string) => void; onGameDelete: (gameId: string) => void }) {
  const { t } = useTranslation()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const fundamental = useLocalizedFundamental(session.objectiveId)
  const dateStr = new Date(session.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
  const winRate = session.gamesPlayed > 0 ? Math.round((session.wins / session.gamesPlayed) * 100) : 0

  return (
    <Card className={cn('transition-colors', session.status === 'active' && 'border-hextech-green/40')}>
      <CardHeader className="cursor-pointer select-none" onClick={onToggle}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-hextech-text-bright truncate">
                {fundamental?.label || session.objectiveId}
              </span>
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

          <div className="flex items-center gap-6 shrink-0">
            <Stat label={t('history.stats.games')} value={session.gamesPlayed.toString()} />
            <Stat label={t('history.stats.winRate')} value={`${winRate}%`} highlight={winRate >= 50} />
            {session.objectiveSuccessRate !== null && (
              <Stat label={t('history.stats.objPct')} value={`${session.objectiveSuccessRate}%`} highlight={session.objectiveSuccessRate >= 50} />
            )}
            <Stat label={t('history.stats.kda')} value={session.avgKDA.toFixed(2)} />
            <Stat label={t('history.stats.csMin')} value={session.avgCSPerMin.toFixed(1)} />
            <div onClick={(e) => e.stopPropagation()}>
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
            {confirmDelete ? (
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
                className="text-hextech-text-dim hover:text-[#FF4655] transition-colors ml-2 shrink-0"
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
                {session.sessionConclusion || session.aiSummary}
              </p>
            </div>
          )}

          <div className="space-y-2">
            {session.games.map((game, idx) => (
              <GameRow
                key={game.id}
                game={game}
                index={idx + 1}
                onDelete={(id) => onGameDelete(id)}
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

function GameRow({ game, index, onDelete }: { game: GameEntry; index: number; onDelete?: (id: string) => void }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const kpiCategories = useLocalizedFundamentals()
  const allKpis = kpiCategories.flatMap((c) => c.fundamentals).flatMap((f) => f.kpis ?? [])
  const [reviewExpanded, setReviewExpanded] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [hasRecording, setHasRecording] = useState(false)
  const csPerMin = game.duration > 0 ? (game.cs / (game.duration / 60)).toFixed(1) : '0'

  useEffect(() => {
    window.api.getRecording(game.id).then((r) => setHasRecording(!!r)).catch(() => {})
  }, [game.id])

  const handleDelete = async () => {
    setDeleting(true)
    try {
      await window.api.deleteGame(game.id)
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
      game.win ? 'border-hextech-green/20 bg-hextech-green/5' : 'border-[#FF4655]/20 bg-[#FF4655]/5',
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
            <Badge variant="outline" className="border-hextech-green/50 text-hextech-green text-[10px] gap-1">
              <CheckCircle className="h-3 w-3" />
              {t('history.gamesTab.reviewed')}
            </Badge>
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
                className="text-hextech-text-dim hover:text-[#FF4655] transition-colors"
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

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="text-center">
      <div className={cn('text-sm font-bold', highlight ? 'text-hextech-green' : 'text-hextech-text-bright')}>
        {value}
      </div>
      <div className="text-xs text-hextech-text-dim">{label}</div>
    </div>
  )
}
