import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useScrollMemory } from '@/hooks/useScrollMemory'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ErrorState } from '@/components/ui/data-state'
import { KIND_STYLE } from '@/lib/planningView'
import { isServerNotReadyError } from '@/lib/matchEventView'
import { buildPlayerStatsSheet } from '@/lib/playerStatsSheetCore'
import { formatClock, parseGameParam, selectGame } from '@/lib/teamSessionHistoryView'
import { GameFilter } from '@/components/TeamSession/GameFilter'
import { PlayerSheet } from '@/components/TeamSession/PlayerSheet'
import type { IndivState } from '@/components/TeamSession/PlayerIndivBlocks'
import { useSessionNavStore } from '@/store/useSessionNavStore'
import { cn } from '@/lib/utils'
import { historyApi, type PlayerSessionStats, type TeamSessionHistoryDetail } from './historyContract'

const ROLE_ORDER = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT']
const panel = 'rounded-lg border border-hextech-border-dim bg-hextech-dark/50 p-4'

/**
 * Player sheet of a finished team session (docs/DESIGN_STATE.md § 24.1): /team-session/:calendarEventId/player/:userId?game=N.
 * Reads the session history detail (the same call as the session page) and hands it to buildPlayerStatsSheet
 * (docs/contracts/player-session-stats.md). The Riot timeline figures of one game come from teamSessionPlayerStats, when deployed.
 */
export function PlayerSheetPage() {
  const { calendarEventId, userId } = useParams<{ calendarEventId: string; userId: string }>()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [detail, setDetail] = useState<TeamSessionHistoryDetail | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [fetching, setFetching] = useState(false)
  const [facts, setFacts] = useState<PlayerSessionStats[] | null>(null)
  const [factsState, setFactsState] = useState<IndivState>('loading')
  const [extracting, setExtracting] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const setEndedSessionOpen = useSessionNavStore((s) => s.setEndedSessionOpen)
  // Back from the VOD (« Revoir »): the scroll position comes back once the sheet's figures are there.
  useScrollMemory(detail !== undefined && factsState !== 'loading')
  useEffect(() => { setEndedSessionOpen(true); return () => setEndedSessionOpen(false) }, [setEndedSessionOpen])

  const load = useCallback(async () => {
    const get = historyApi().teamSessionHistoryDetail
    if (!get || !calendarEventId) { setError('unavailable'); setDetail(null); return }
    try {
      const session = await window.api.teamSessionGetByEvent(calendarEventId)
      if (!session) { setError('notFound'); setDetail(null); return }
      setSessionId(session.id)
      setDetail(await get(session.id))
      setError(null)
    } catch (err) {
      setError(isServerNotReadyError(err) ? 'unavailable' : /NOT_FOUND/.test((err as Error)?.message ?? '') ? 'notFound' : 'error')
      setDetail(null)
    }
  }, [calendarEventId])
  useEffect(() => { void load() }, [load])

  // Timeline figures (isolation, gaps, radar…). Games whose cached timeline lacks the per-player block are extracted
  // automatically once on opening (enrich); `extract` also fetches the timelines that were never cached.
  const loadFacts = useCallback(async (extract: boolean) => {
    const get = historyApi().teamSessionPlayerStats
    if (!sessionId || !get) { setFactsState(get ? 'loading' : 'unavailable'); return }
    try {
      if (extract && detail) {
        const api = window.api as unknown as { teamObjectivesGameTimeline?: (id: string) => Promise<unknown> }
        for (const g of detail.games.filter((x) => x.stats === 'ready' && !x.timeline)) await api.teamObjectivesGameTimeline?.(g.gameId).catch(() => null)
      }
      let rows = await get(sessionId)
      setFacts(rows); setFactsState('ready')
      if (extract || rows.some((r) => r.games.some((g) => g.timelineStatus === 'no-players'))) {
        setExtracting(true)
        rows = await get(sessionId, { enrich: true })
        setFacts(rows)
      }
    } catch (err) { setFactsState(isServerNotReadyError(err) ? 'unavailable' : 'error') } finally { setExtracting(false) }
  }, [sessionId, detail])
  const autoEnriched = useRef(false)
  useEffect(() => { if (sessionId && detail && !autoEnriched.current) { autoEnriched.current = true; void loadFacts(false) } }, [sessionId, detail, loadFacts])

  const gameIndex = detail ? parseGameParam(params.get('game'), detail.games) : null
  const sheet = useMemo(() => (detail && userId ? buildPlayerStatsSheet(detail, userId, gameIndex) : null), [detail, userId, gameIndex])
  const sel = useMemo(() => (detail ? selectGame(detail, gameIndex) : null), [detail, gameIndex])

  const gameMatchIds = useMemo(() => Object.fromEntries((detail?.games ?? []).map((g) => [g.gameId, g.matchId])), [detail])

  const search = (index: number | null) => (index == null ? '' : `?game=${index}`)
  const sheetPath = (uid: string, index: number | null = gameIndex) => `/team-session/${encodeURIComponent(calendarEventId ?? '')}/player/${encodeURIComponent(uid)}${search(index)}`
  const sessionPath = `/team-session/${encodeURIComponent(calendarEventId ?? '')}${search(gameIndex)}`
  const pickGame = (index: number | null) => setParams((p) => {
    const n = new URLSearchParams(p)
    if (index == null) n.delete('game'); else n.set('game', String(index))
    return n
  }, { replace: true })

  const fetchMissing = async () => {
    if (!detail) return
    const api = window.api as unknown as { teamSessionFetchMatch?: (id: string) => Promise<unknown> }
    setFetching(true)
    try {
      for (const g of detail.games.filter((x) => x.stats === 'not-fetched' && (gameIndex == null || x.index === gameIndex))) await api.teamSessionFetchMatch?.(g.gameId).catch(() => null)
      await load()
    } finally { setFetching(false) }
  }

  if (detail === undefined) {
    return (
      <div className="space-y-3 py-4" aria-busy role="status" aria-label={t('playerSheet.loading')}>
        <div className="h-24 animate-pulse rounded-lg bg-hextech-elevated/60" />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">{Array.from({ length: 7 }, (_, i) => <div key={i} className="h-20 animate-pulse rounded-md bg-hextech-elevated/60" />)}</div>
        <div className="h-40 animate-pulse rounded-lg bg-hextech-elevated/60" />
      </div>
    )
  }
  if (!detail || !sheet || !sel) {
    return (
      <div className="space-y-3 py-4">
        <Link to="/team-sessions" className="text-sm text-hextech-text-dim hover:text-hextech-gold">← {t('teamSessions.title')}</Link>
        <ErrorState
          title={t('playerSheet.errorTitle', { name: t('playerSheet.player') })}
          cause={t(error === 'unavailable' ? 'teamSessions.notDeployed' : error === 'notFound' ? 'teamSessions.detail.notFound' : 'teamSessions.loadFailedCause')}
          onRetry={error === 'error' ? () => { void load() } : undefined}
        />
      </div>
    )
  }

  const h = detail.header
  const accent = KIND_STYLE[h.kind]?.accent ?? KIND_STYLE.other.accent
  // Name, role and champions come from the whole session so they stay when a single game is picked.
  const all = selectGame(detail, null).players
  const me = all.find((p) => p.memberId === userId) ?? sel.players.find((p) => p.memberId === userId) ?? null
  const name = me?.displayName ?? sheet.line?.displayName ?? t('playerSheet.player')
  const role = me?.role ?? sheet.line?.role ?? ''
  const roster = [...(all.length ? all : sel.players)].sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role))
  const at = roster.findIndex((p) => p.memberId === userId)
  const prev = at > 0 ? roster[at - 1] : null
  const next = at >= 0 && at < roster.length - 1 ? roster[at + 1] : null
  const champs = (me?.byChampion ?? []).map((c) => `${c.championKey} ×${c.games}`).join(' · ')
  const playedGames = sheet.series.filter((p) => p.played)
  const wins = playedGames.filter((p) => p.win === true).length, losses = playedGames.filter((p) => p.win === false).length
  const seconds = playedGames.reduce((n, p) => n + (p.durationSec ?? 0), 0)
  const indiv = facts?.find((p) => p.memberId === userId) ?? null
  const day = new Date(h.startsAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
  const crumb = 'text-hextech-gold hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hextech-gold rounded'

  return (
    <div className="w-full space-y-4 py-4 animate-fade-in">
      <nav aria-label="breadcrumb" className="flex flex-wrap items-center gap-1.5 text-sm">
        <Link to="/team-sessions" className={crumb}>← {t('teamSessions.title')}</Link>
        <span aria-hidden className="text-hextech-text-dim">/</span>
        <Link to={sessionPath} className={crumb}>{h.title}</Link>
        <span aria-hidden className="text-hextech-text-dim">/</span>
        <span aria-current="page" className="text-hextech-text-bright">{name}{gameIndex != null ? ` · G${gameIndex}` : ''}</span>
      </nav>

      <header className={cn(panel, 'flex flex-wrap items-center justify-between gap-4')}>
        <div className="flex min-w-0 items-center gap-4">
          <span aria-hidden className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-2 border-hextech-gold font-mono text-xs font-bold text-hextech-gold">{role === 'SUPPORT' ? 'SUP' : role === 'JUNGLE' ? 'JGL' : role}</span>
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-3xl font-bold text-hextech-text-bright">{name}</h1>
              <span className="rounded px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider" style={{ color: accent, backgroundColor: `${accent}22` }}>{t(`teamSessions.type.${h.kind}`)}</span>
            </div>
            <p className="font-mono text-xs text-hextech-text-dim">
              {[champs, t('teamSessions.detail.gamesCount', { count: playedGames.length }), `${wins} ${t('teamSessions.winShort')} – ${losses} ${t('teamSessions.lossShort')}`, day].filter(Boolean).join(' · ')}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {prev && <Button variant="outline" size="sm" onClick={() => navigate(sheetPath(prev.memberId))} aria-label={t('playerSheet.prev', { name: prev.displayName })}><ChevronLeft className="mr-1 h-3.5 w-3.5" />{prev.displayName} · {prev.role}</Button>}
          {next && <Button variant="outline" size="sm" onClick={() => navigate(sheetPath(next.memberId))} aria-label={t('playerSheet.next', { name: next.displayName })}>{next.displayName} · {next.role}<ChevronRight className="ml-1 h-3.5 w-3.5" /></Button>}
        </div>
      </header>

      {detail.games.length > 0 && (
        <GameFilter games={detail.games} value={gameIndex} onPick={pickGame}
          right={seconds > 0 ? [t('teamSessions.detail.gamesCount', { count: playedGames.length }), formatClock(seconds)].join(' · ') : undefined} />
      )}

      <PlayerSheet sheet={sheet} name={name} role={role} teamPlayers={sel.players} indiv={indiv} indivState={factsState} onExtract={() => { void loadFacts(true) }} extracting={extracting} onPickGame={pickGame} gameMatchIds={gameMatchIds}
        onFetch={() => { void fetchMissing() }} fetching={fetching} />

      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline" size="sm"><Link to={sessionPath}>{t('playerSheet.backToSession')}</Link></Button>
      </div>
    </div>
  )
}
