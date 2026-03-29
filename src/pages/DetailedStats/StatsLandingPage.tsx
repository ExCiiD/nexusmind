import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChampionMatchup } from '@/components/ChampionMatchup'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useTranslation } from 'react-i18next'
import { cn, formatKDA, formatGameTime } from '@/lib/utils'
import {
  Loader2,
  Swords,
  Eye,
  Clock,
  BarChart3,
  CheckCircle,
  FileSearch,
  TrendingUp,
  ChevronLeft,
  ChevronRight,
  User,
} from 'lucide-react'

const PAGE_SIZE = 20

interface GameHistoryEntry {
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
  imported: boolean
  reviewed: boolean
  reviewStatus: 'pending' | 'to_be_reviewed' | 'reviewed'
  accountName: string
}

export function StatsLandingPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [games, setGames] = useState<GameHistoryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [autoSnapMsg, setAutoSnapMsg] = useState<string | null>(null)

  useEffect(() => {
    const loadGames = async () => {
      try {
        const data = await window.api.getMatchHistoryWithStatus(100)
        setGames(data as GameHistoryEntry[])
      } catch (err: any) {
        setError(err.message ?? 'Failed to fetch')
      } finally {
        setLoading(false)
      }
    }

    const triggerAutoSnapshot = async () => {
      try {
        const result = await window.api.autoSnapshot()
        if (result.created > 0) {
          setAutoSnapMsg(t('statsAvg.autoSnapshotDone', { count: result.created }))
          setTimeout(() => setAutoSnapMsg(null), 5000)
        }
      } catch { /* silent */ }
    }

    loadGames()
    triggerAutoSnapshot()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const totalPages = Math.ceil(games.length / PAGE_SIZE)
  const visibleGames = games.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  const handlePrev = () => setPage((p) => Math.max(0, p - 1))
  const handleNext = () => setPage((p) => Math.min(totalPages - 1, p + 1))

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-hextech-gold-bright">
            {t('detailedStats.pageTitle')}
          </h1>
          <p className="text-sm text-hextech-text mt-1">{t('detailedStats.pageSubtitle')}</p>
        </div>
        <Button
          variant="outline"
          className="gap-2 border-hextech-gold/40 text-hextech-gold hover:bg-hextech-gold/10"
          onClick={() => navigate('/stats/averages')}
        >
          <TrendingUp className="h-4 w-4" />
          {t('statsAvg.navButton')}
        </Button>
      </div>

      {autoSnapMsg && (
        <div className="flex items-center gap-2 rounded-lg border border-hextech-cyan/30 bg-hextech-cyan/5 px-4 py-2 text-sm text-hextech-cyan">
          <TrendingUp className="h-4 w-4 shrink-0" />
          {autoSnapMsg}
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-20 gap-2 text-hextech-text-dim">
          <Loader2 className="h-5 w-5 animate-spin" />
          {t('detailedStats.loading')}
        </div>
      )}

      {error && (
        <Card>
          <CardContent className="py-12 text-center text-[#FF4655]">{error}</CardContent>
        </Card>
      )}

      {!loading && !error && games.length === 0 && (
        <Card>
          <CardContent className="py-16 text-center text-hextech-text-dim">
            {t('detailedStats.noGames')}
          </CardContent>
        </Card>
      )}

      {!loading && !error && games.length > 0 && (
        <div className="space-y-3">
          {/* Pagination header */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-hextech-text-dim">
                {t('history.page', { current: page + 1, total: totalPages })}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handlePrev}
                  disabled={page === 0}
                  className="h-7 px-2 gap-1 text-xs"
                >
                  <ChevronLeft className="h-3 w-3" />
                  {t('history.prevPage')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleNext}
                  disabled={page >= totalPages - 1}
                  className="h-7 px-2 gap-1 text-xs"
                >
                  {t('history.nextPage')}
                  <ChevronRight className="h-3 w-3" />
                </Button>
              </div>
            </div>
          )}

          <div className="space-y-2">
            {visibleGames.map((game) => (
              <button
                key={game.matchId}
                className={cn(
                  'w-full rounded-lg border transition-all hover:ring-1 hover:ring-hextech-gold/40',
                  game.win
                    ? 'border-hextech-green/20 bg-hextech-green/5'
                    : 'border-[#FF4655]/20 bg-[#FF4655]/5',
                )}
                onClick={() => navigate(`/stats/${game.matchId}`)}
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
                        <span className="font-medium text-sm text-hextech-text-bright truncate">
                          {game.champion}
                        </span>
                        <span className="text-xs text-hextech-text-dim shrink-0">{game.role}</span>
                      </div>
                      {game.opponentChampion && (
                        <span className="text-[10px] text-hextech-text-dim truncate">
                          vs {game.opponentChampion}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-4 text-xs text-hextech-text flex-1">
                    <span className="flex items-center gap-1">
                      <Swords className="h-3 w-3" />
                      {formatKDA(game.kills, game.deaths, game.assists)}
                    </span>
                    <span>
                      {game.cs} CS (
                      {game.duration > 0 ? (game.cs / (game.duration / 60)).toFixed(1) : '0'}/m)
                    </span>
                    <span className="flex items-center gap-1">
                      <Eye className="h-3 w-3" />
                      {game.visionScore}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatGameTime(game.duration)}
                    </span>
                    <span className="text-hextech-text-dim">
                      {new Date(game.gameEndAt).toLocaleDateString(undefined, {
                        day: 'numeric',
                        month: 'short',
                      })}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {/* Account tag */}
                    {game.accountName && (
                      <Badge variant="outline" className="border-hextech-border-dim text-hextech-text-dim text-[10px] gap-1 hidden sm:flex">
                        <User className="h-2.5 w-2.5" />
                        {game.accountName}
                      </Badge>
                    )}

                    {game.reviewed ? (
                      <Badge variant="outline" className="border-hextech-green/50 text-hextech-green text-[10px] gap-1">
                        <CheckCircle className="h-3 w-3" />
                        {t('history.gamesTab.reviewed')}
                      </Badge>
                    ) : game.imported && game.reviewStatus === 'to_be_reviewed' ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          if (game.gameId) navigate(`/review?gameId=${game.gameId}`)
                        }}
                        className="flex items-center gap-1 rounded-full border border-hextech-cyan/50 bg-hextech-cyan/5 px-2 py-0.5 text-[10px] text-hextech-cyan hover:bg-hextech-cyan/15 transition-colors"
                      >
                        <Clock className="h-3 w-3" />
                        {t('history.gamesTab.toBeReviewed')}
                      </button>
                    ) : game.imported ? (
                      <Badge variant="outline" className="border-hextech-gold/40 text-hextech-gold text-[10px] gap-1">
                        <FileSearch className="h-3 w-3" />
                        {t('history.gamesTab.unreviewed')}
                      </Badge>
                    ) : null}

                    <BarChart3 className="h-4 w-4 text-hextech-gold/60" />
                  </div>
                </div>
              </button>
            ))}
          </div>

          {/* Pagination footer */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handlePrev}
                disabled={page === 0}
                className="gap-1 text-xs"
              >
                <ChevronLeft className="h-3 w-3" />
                {t('history.prevPage')}
              </Button>
              <span className="text-xs text-hextech-text-dim px-2">
                {t('history.page', { current: page + 1, total: totalPages })}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={handleNext}
                disabled={page >= totalPages - 1}
                className="gap-1 text-xs"
              >
                {t('history.nextPage')}
                <ChevronRight className="h-3 w-3" />
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
