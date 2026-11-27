import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, CalendarDays, Check, ChevronDown, ClipboardCopy, ExternalLink, Minus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ErrorState } from '@/components/ui/data-state'
import { useToast } from '@/hooks/useToast'
import { cn } from '@/lib/utils'
import { KIND_STYLE } from '@/lib/planningView'
import { isServerNotReadyError } from '@/lib/matchEventView'
import { formatClock, orderForGame, parseGameParam, selectGame, summaryLines } from '@/lib/teamSessionHistoryView'
import { DuelComparisonTable } from '@/components/TeamSession/DuelComparisonTable'
import { GameFilter } from '@/components/TeamSession/GameFilter'
import { CollectiveStatsBlock, useCollective } from '@/components/TeamSession/CollectiveStats'
import { GamesFrieze } from '@/components/analyst/ObjectivesView'
import type { SynergyPlayerStats } from '@/lib/ipc'
import type { NameOf } from '@/hooks/useCollab'
import { MeetingHistoryView } from './MeetingHistoryView'
import { useSessionNavStore } from '@/store/useSessionNavStore'
import { historyApi, type HistoryGame, type HistoryObjective, type SideTotals, type TeamSessionHistoryDetail, type TeamTotals } from './historyContract'

const ROLE_ORDER = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT']
const panel = 'rounded-lg border border-hextech-border-dim bg-hextech-dark/50 p-4'

function Block({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className={cn(panel, 'space-y-3')} aria-label={title}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-hextech-gold">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  )
}

/**
 * The page of a finished team session (docs/DESIGN_STATE.md § 15.2), shown by TeamSessionPage for an `ended`
 * session: header, game filter (`?game=2`), team stats, player stats with their lane duel, the session's objectives,
 * notes and reviews. Data: teamSessionHistoryDetail (docs/contracts/team-session-history.md). Games whose stats or
 * timeline are not cached yet are fetched once (teamSessionFetchMatch, teamObjectivesGameTimeline), then reloaded.
 */
export function TeamSessionHistoryView({ sessionId, calendarEventId, canManage, nameOf, objectiveLabel, onNotHistory }: {
  sessionId: string
  /** Null when the slot was deleted after the session started (opened by its id). */
  calendarEventId: string | null
  canManage: boolean
  nameOf: NameOf
  objectiveLabel: (id: string) => string
  /** This session has no history view (a meeting without its meeting data): the caller shows its own page. */
  onNotHistory?: () => void
}) {
  const { t, i18n } = useTranslation()
  const { toast } = useToast()
  const [params, setParams] = useSearchParams()
  const [detail, setDetail] = useState<TeamSessionHistoryDetail | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const filled = useRef(false)
  // The sidebar lights « Sessions d'équipe » while a finished session is open.
  const setEndedSessionOpen = useSessionNavStore((s) => s.setEndedSessionOpen)
  useEffect(() => { setEndedSessionOpen(true); return () => setEndedSessionOpen(false) }, [setEndedSessionOpen])

  const load = useCallback(async () => {
    const get = historyApi().teamSessionHistoryDetail
    if (!get) { setError('unavailable'); setDetail(null); return }
    try {
      setDetail(await get(sessionId))
      setError(null)
    } catch (err) {
      setError(isServerNotReadyError(err) ? 'unavailable' : /NOT_FOUND/.test((err as Error)?.message ?? '') ? 'notFound' : 'error')
      setDetail(null)
    }
  }, [sessionId])
  useEffect(() => { void load() }, [load])

  // Games without cached stats or timeline: fetch them once, then reload.
  useEffect(() => {
    if (!detail || filled.current) return
    const missingMatch = detail.games.filter((g) => g.stats === 'not-fetched')
    const missingTimeline = detail.games.filter((g) => g.stats === 'ready' && !g.timeline)
    if (!missingMatch.length && !missingTimeline.length) return
    filled.current = true
    const api = window.api as unknown as { teamSessionFetchMatch?: (id: string) => Promise<unknown>; teamObjectivesGameTimeline?: (id: string) => Promise<unknown> }
    void (async () => {
      for (const g of missingMatch) await api.teamSessionFetchMatch?.(g.gameId).catch(() => null)
      for (const g of missingTimeline) await api.teamObjectivesGameTimeline?.(g.gameId).catch(() => null)
      await load()
    })()
  }, [detail, load])

  const gameIndex = detail ? parseGameParam(params.get('game'), detail.games) : null
  const pickGame = (index: number | null) => setParams((p) => {
    const n = new URLSearchParams(p)
    if (index == null) n.delete('game'); else n.set('game', String(index))
    return n
  }, { replace: true })
  // One player sheet for everything individual (/…/player/:userId?game=N): the « Stats indiv » tab, a click on a player row
  // and the legacy ?tab=indiv&player=<id> link all lead there.
  const sheetBase = calendarEventId ? `/team-session/${encodeURIComponent(calendarEventId)}` : `/team-sessions/${encodeURIComponent(sessionId)}`
  const sheetPath = (memberId: string) => `${sheetBase}/player/${encodeURIComponent(memberId)}${gameIndex != null ? `?game=${gameIndex}` : ''}`
  const legacyPlayer = params.get('tab') === 'indiv' ? params.get('player') : null
  const navigate = useNavigate()
  useEffect(() => { if (legacyPlayer && detail) navigate(sheetPath(legacyPlayer), { replace: true }) })
  const sel = useMemo(() => (detail ? selectGame(detail, gameIndex) : null), [detail, gameIndex])
  const collective = useCollective(sessionId, detail?.games.filter((g) => g.stats === 'ready' && g.timeline).length ?? 0)
  const gameMatchIds = useMemo(() => Object.fromEntries((detail?.games ?? []).map((g) => [g.gameId, g.matchId])), [detail])
  const meetingWithoutData = !!detail && detail.header.kind === 'meeting' && !detail.meeting
  useEffect(() => { if (meetingWithoutData) onNotHistory?.() }, [meetingWithoutData, onNotHistory])

  if (detail === undefined) return <div className="space-y-3" aria-busy>{[0, 1, 2].map((i) => <div key={i} className="h-28 animate-pulse rounded-lg bg-hextech-elevated/60" />)}</div>
  if (!detail || !sel) {
    return (
      <div className="space-y-3">
        <BackLink />
        <ErrorState
          title={t('teamSessions.detail.loadFailed')}
          cause={t(error === 'unavailable' ? 'teamSessions.notDeployed' : error === 'notFound' ? 'teamSessions.detail.notFound' : 'teamSessions.loadFailedCause')}
          onRetry={error === 'error' ? () => { void load() } : undefined}
        />
      </div>
    )
  }

  // § 15.2 bis: a meeting has its own page (attendance, recording, summary, transcript).
  if (detail.header.kind === 'meeting') {
    return detail.meeting
      ? <MeetingHistoryView detail={{ ...detail, meeting: detail.meeting }} calendarEventId={calendarEventId} canManage={canManage} nameOf={nameOf} />
      : null
  }

  const h = detail.header
  const accent = KIND_STYLE[h.kind]?.accent ?? KIND_STYLE.other.accent
  const start = new Date(h.startsAt)
  const time = (d: Date) => d.toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' })
  const dateLine = `${start.toLocaleDateString(i18n.language, { weekday: 'long', day: 'numeric', month: 'long' })} · ${time(start)} – ${time(new Date(h.endsAt))}${h.format ? ` · ${h.format.toUpperCase()}` : ''}`
  const gameLabel = (g: HistoryGame) => `G${g.index} ${g.win === true ? t('teamSessions.winShort') : g.win === false ? t('teamSessions.lossShort') : ''}`.trim()

  const exportSummary = async () => {
    const text = summaryLines(detail, {
      date: dateLine,
      kind: t(`teamSessions.type.${h.kind}`),
      game: (g) => `${gameLabel(g)}${g.durationSec ? ` · ${formatClock(g.durationSec)}` : ''}${g.enemyTeamName ? ` · vs ${g.enemyTeamName}` : ''}`,
      objective: objectiveLabel,
      held: (held) => t(held === true ? 'teamSessions.detail.held' : held === false ? 'teamSessions.detail.notHeld' : 'teamSessions.detail.notJudged'),
      team: t('teamSessions.detail.teamStats'),
    }).join('\n')
    try {
      await navigator.clipboard.writeText(text)
      toast({ title: t('teamSessions.detail.exported') })
    } catch {
      toast({ title: t('teamSessions.detail.exportFailed'), variant: 'destructive' })
    }
  }

  return (
    <div className="space-y-4 animate-fade-in">
      <BackLink />

      {/* Header */}
      <header className={cn(panel, 'flex flex-wrap items-start justify-between gap-4')} style={{ borderLeft: `3px solid ${accent}` }}>
        <div className="min-w-0 space-y-1">
          <span className="rounded px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider" style={{ color: accent, backgroundColor: `${accent}22` }}>
            {t(`teamSessions.type.${h.kind}`)}
          </span>
          <h1 className="font-display text-2xl font-bold text-hextech-gold-bright">{h.title}</h1>
          <p className="font-mono text-xs text-hextech-text-dim">{dateLine}</p>
          {h.responsibleUserIds.length > 0 && (
            <p className="text-xs text-hextech-text-dim">{t('teamSessions.detail.responsible', { names: h.responsibleUserIds.map((id) => nameOf(id)).join(', ') })}</p>
          )}
        </div>
        <div className="flex flex-col items-end gap-2">
          <p className="font-display text-4xl tabular-nums text-hextech-text-bright" aria-label={t('teamSessions.detail.score', { wins: h.wins, losses: h.losses })}>
            {h.wins} – {h.losses}
          </p>
          <div className="flex flex-wrap gap-2">
            {calendarEventId && (
              <Button asChild variant="outline" size="sm">
                <Link to={`/management?tab=planning&event=${encodeURIComponent(calendarEventId)}`}><CalendarDays className="mr-1.5 h-3.5 w-3.5" />{t('teamSessions.detail.openPlanning')}</Link>
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => { void exportSummary() }}>
              <ClipboardCopy className="mr-1.5 h-3.5 w-3.5" />{t('teamSessions.detail.export')}
            </Button>
          </div>
        </div>
      </header>

      {detail.games.length === 0 ? (
        <p className={cn(panel, 'text-sm text-hextech-text-dim')}>{t('teamSessions.detail.noGames')}</p>
      ) : (
        <>
          {/* Tabs: team view (this page) / individual stats (the player sheet) */}
          <div role="tablist" aria-label={t('teamSessions.detail.indiv.tabsLabel')} className="flex gap-1 border-b border-hextech-border-dim">
            {([['team', 'tabTeam'], ['indiv', 'tabIndiv']] as const).map(([id, key]) => (
              <button key={id} id={`tab-${id}`} type="button" role="tab" aria-selected={id === 'team'} aria-controls="team-panel" disabled={id === 'indiv' && sel.players.length === 0}
                onClick={() => { if (id === 'indiv') navigate(sheetPath([...sel.players].sort((x, y) => ROLE_ORDER.indexOf(x.role) - ROLE_ORDER.indexOf(y.role))[0].memberId)) }}
                className={cn('-mb-px rounded-t px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hextech-gold',
                  id === 'team' ? 'border-b-2 border-hextech-gold text-hextech-gold-bright' : 'text-hextech-text-dim hover:text-hextech-text')}>
                {t(`teamSessions.detail.indiv.${key}`)}
              </button>
            ))}
          </div>

          {/* Game filter */}
          <GameFilter games={detail.games} value={gameIndex} onPick={pickGame} />

          {sel.game && sel.game.stats !== 'ready' ? (
            <p className={cn(panel, 'text-sm text-hextech-text-dim')}>
              {t(sel.game.stats === 'not-fetched' ? 'teamSessions.detail.statsLoading' : sel.game.stats === 'no-side' ? 'teamSessions.detail.statsNoSide' : 'teamSessions.detail.statsError', { n: sel.game.index })}
            </p>
          ) : (
            <>
              <div id="team-panel" role="tabpanel" aria-labelledby="tab-team" className="space-y-4">
                <CollectiveStatsBlock state={collective.state} gameIndex={gameIndex} onRetry={() => { void collective.reload() }} onExtract={(ids) => { void collective.extract(ids) }} extracting={collective.extracting}
                  matchIdOf={gameMatchIds} roleOf={(id) => sel.players.find((p) => p.memberId === id)?.role} />
                {sel.team && <TeamStatsBlock team={sel.team} single={!!sel.game} counted={sel.counted} />}
                {sel.game?.timeline && <GamesFrieze games={[sel.game.timeline]} pageSize={1} />}
                {sel.players.length > 0 && <PlayerStatsBlock players={sel.players} duels={sel.duels} whole={!sel.game} sheetPath={sheetPath} />}
              </div>
            </>
          )}
          {!sel.game && detail.games.some((g) => g.stats === 'error' || g.stats === 'no-side') && (
            <p className="text-xs text-hextech-text-dim">
              {detail.games.filter((g) => g.stats === 'error' || g.stats === 'no-side').map((g) => t('teamSessions.detail.statsError', { n: g.index })).join(' · ')}
            </p>
          )}
        </>
      )}

      {detail.objectives.length > 0 && (
        <ObjectivesBlock detail={detail} canManage={canManage} objectiveLabel={objectiveLabel} onChanged={setDetail} />
      )}

      <NotesBlock detail={detail} gameId={sel.game?.gameId ?? null} canManage={canManage} nameOf={nameOf} calendarEventId={calendarEventId} />
    </div>
  )
}

function BackLink() {
  const { t } = useTranslation()
  return (
    <Link to="/team-sessions" className="inline-flex items-center gap-1 text-sm text-hextech-text-dim hover:text-hextech-gold">
      <ArrowLeft className="h-3.5 w-3.5" />{t('teamSessions.title')}
    </Link>
  )
}

/* ─── Block 1: team stats ─── */

function StatTile({ label, our, enemy, delta, deltaGood }: { label: string; our: string; enemy?: string; delta?: string; deltaGood?: boolean | null }) {
  return (
    <div className="rounded-md border border-hextech-border-dim bg-hextech-black/40 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-hextech-text-dim">{label}</p>
      <p className="mt-0.5 font-mono text-lg text-hextech-text-bright tabular-nums">{our}</p>
      <p className="font-mono text-[11px] tabular-nums">
        {enemy && <span className="text-hextech-text-dim">{enemy}</span>}
        {delta && <span className={cn('ml-1.5', deltaGood == null ? 'text-hextech-text-dim' : deltaGood ? 'text-hextech-green' : 'text-hextech-red')}>{delta}</span>}
      </p>
    </div>
  )
}

const kda = (s: SideTotals) => `${s.kills} / ${s.deaths} / ${s.assists}`
const k = (n: number) => (Math.abs(n) >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)))
const signed = (n: number, fmt = k) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${fmt(Math.abs(n))}`

function TeamStatsBlock({ team, single, counted }: { team: TeamTotals; single: boolean; counted: number }) {
  const { t } = useTranslation()
  const o = team.our, e = team.enemy
  const them = (v: string) => t('teamSessions.detail.them', { value: v })
  return (
    <Block title={t('teamSessions.detail.teamStats')} right={!single ? <span className="font-mono text-xs text-hextech-text-dim">{t('teamSessions.detail.gamesCounted', { count: counted })}</span> : undefined}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
        <StatTile label="K / D / A" our={kda(o)} enemy={them(kda(e))} delta={signed(o.kills - e.kills, String)} deltaGood={o.kills === e.kills ? null : o.kills > e.kills} />
        <StatTile label={t('teamSessions.detail.gold')} our={k(o.gold)} enemy={them(k(e.gold))} delta={signed(o.gold - e.gold)} deltaGood={o.gold === e.gold ? null : o.gold > e.gold} />
        <StatTile label={t('teamSessions.detail.damage')} our={k(o.damage)} enemy={them(k(e.damage))} delta={signed(o.damage - e.damage)} deltaGood={o.damage === e.damage ? null : o.damage > e.damage} />
        <StatTile label={t('teamSessions.detail.vision')} our={String(Math.round(o.vision))} enemy={them(String(Math.round(e.vision)))} delta={signed(o.vision - e.vision, (n) => String(Math.round(n)))} deltaGood={o.vision === e.vision ? null : o.vision > e.vision} />
        <StatTile label={t(single ? 'teamSessions.detail.duration' : 'teamSessions.detail.avgDuration')} our={formatClock(team.avgDurationSec) ?? '—'} />
      </div>
    </Block>
  )
}

/* ─── Block 2: player stats, with the lane duel ─── */

function PlayerStatsBlock({ players, duels, whole, sheetPath }: { players: SynergyPlayerStats[]; duels: TeamSessionHistoryDetail['games'][number]['duels']; whole: boolean; sheetPath: (memberId: string) => string }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [open, setOpen] = useState<string | null>(null)
  const rows = [...players].sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role))
  const cols = ['KDA', 'CS/min', 'Gold/min', 'DMG/min', 'Vision', t('teamSessions.detail.dmgShare'), 'KP']
  return (
    <Block title={t('teamSessions.detail.playerStats')}>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-[10px] uppercase tracking-wider text-hextech-text-dim">
            <tr>
              <th className="px-2 py-1.5 text-left font-semibold">{t('teamSessions.detail.role')}</th>
              <th className="px-2 py-1.5 text-left font-semibold">{t('teamSessions.detail.player')}</th>
              <th className="px-2 py-1.5 text-left font-semibold">{t('teamSessions.detail.champion')}</th>
              {cols.map((c) => <th key={c} className="px-2 py-1.5 text-right font-semibold">{c}</th>)}
              <th className="w-6" />
            </tr>
          </thead>
          <tbody className="divide-y divide-hextech-border-dim/40">
            {rows.map((p) => {
              const duel = duels.find((d) => d.role === p.role)
              const isOpen = open === p.memberId
              const champ = p.byChampion.map((c) => c.championKey).join(', ')
              const a = p.averages
              return (
                <Fragment key={p.memberId}>
                  <tr className="cursor-pointer hover:bg-hextech-elevated/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-hextech-gold"
                    tabIndex={0}
                    onClick={() => navigate(sheetPath(p.memberId))}
                    onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) navigate(sheetPath(p.memberId)) }}>
                    <td className="px-2 py-1.5 font-mono text-[10px] text-hextech-text-dim">{p.role}</td>
                    <td className="px-2 py-1.5 font-semibold text-hextech-text-bright">
                      {p.displayName}
                      {whole && <span className="ml-1 font-normal text-hextech-text-dim">({t('teamSessions.detail.gamesCount', { count: p.gamesPlayed })})</span>}
                    </td>
                    <td className="max-w-[140px] truncate px-2 py-1.5 text-hextech-text" title={champ}>{champ || '—'}</td>
                    <td className="px-2 py-1.5 text-right font-mono tabular-nums">{a.kda.toFixed(2)}</td>
                    <td className="px-2 py-1.5 text-right font-mono tabular-nums">{a.csPerMin.toFixed(1)}</td>
                    <td className="px-2 py-1.5 text-right font-mono tabular-nums">{Math.round(a.goldPerMin)}</td>
                    <td className="px-2 py-1.5 text-right font-mono tabular-nums">{Math.round(a.damagePerMin)}</td>
                    <td className="px-2 py-1.5 text-right font-mono tabular-nums">{a.visionScore.toFixed(1)}</td>
                    <td className="px-2 py-1.5 text-right font-mono tabular-nums">{Math.round(p.shares.damagePct)} %</td>
                    <td className="px-2 py-1.5 text-right font-mono tabular-nums">{Math.round(p.shares.kpPct)} %</td>
                    <td className="px-1">
                      {duel && (
                        <button type="button" aria-expanded={isOpen} aria-label={t('teamSessions.detail.showDuel', { name: p.displayName })}
                          onClick={(e) => { e.stopPropagation(); setOpen(isOpen ? null : p.memberId) }}
                          className="rounded p-0.5 text-hextech-text-dim hover:text-hextech-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hextech-gold">
                          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', isOpen && 'rotate-180')} />
                        </button>
                      )}
                    </td>
                  </tr>
                  {isOpen && duel && (
                    <tr><td colSpan={cols.length + 4} className="bg-hextech-black/30 p-2"><DuelComparisonTable rows={[duel]} /></td></tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </Block>
  )
}

/* ─── Block 3: the session's objectives ─── */

function Verdict({ value }: { value: boolean | null | undefined }) {
  const { t } = useTranslation()
  if (value === true) return <span className="inline-flex items-center gap-1 text-hextech-green"><Check className="h-3 w-3" />{t('teamSessions.detail.held')}</span>
  if (value === false) return <span className="inline-flex items-center gap-1 text-hextech-red"><X className="h-3 w-3" />{t('teamSessions.detail.notHeld')}</span>
  return <span className="text-hextech-text-dim">{t('teamSessions.detail.notJudged')}</span>
}

/** Staff toggle: held → not held → no verdict → held. */
function VerdictToggle({ value, label, onSet }: { value: boolean | null | undefined; label: string; onSet: (next: boolean | null) => void }) {
  const next = value === true ? false : value === false ? null : true
  return (
    <button type="button" onClick={() => onSet(next)} aria-label={label}
      className={cn('flex h-6 w-6 items-center justify-center rounded border text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hextech-gold',
        value === true ? 'border-hextech-green/60 bg-hextech-green/15 text-hextech-green' : value === false ? 'border-hextech-red/60 bg-hextech-red/15 text-hextech-red' : 'border-hextech-border-dim text-hextech-text-dim')}>
      {value === true ? <Check className="h-3 w-3" /> : value === false ? <X className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
    </button>
  )
}

function ObjectivesBlock({ detail, canManage, objectiveLabel, onChanged }: {
  detail: TeamSessionHistoryDetail
  canManage: boolean
  objectiveLabel: (id: string) => string
  onChanged: (d: TeamSessionHistoryDetail) => void
}) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const set = historyApi().teamSessionSetObjectiveResult
  const editable = canManage && !!set
  const noVerdictYet = detail.objectives.every((o) => o.held == null && o.session == null && Object.keys(o.byGame).length === 0)

  const write = async (o: HistoryObjective, gameId: string | null, met: boolean | null) => {
    const before = detail
    const patched: HistoryObjective = gameId == null
      ? { ...o, session: met }
      : { ...o, byGame: Object.fromEntries(Object.entries({ ...o.byGame, [gameId]: met }).filter(([, v]) => v != null)) as Record<string, boolean> }
    onChanged({ ...detail, objectives: detail.objectives.map((x) => (x.objectiveId === o.objectiveId ? patched : x)) })
    try {
      await set!(detail.header.sessionId, o.objectiveId, gameId, met)
    } catch (err) {
      onChanged(before)
      const msg = (err as Error)?.message ?? ''
      toast({
        title: t(/NOT_AVAILABLE/.test(msg) || isServerNotReadyError(err) ? 'teamSessions.detail.verdictNotAvailable' : /FORBIDDEN/.test(msg) ? 'teamSessions.detail.verdictForbidden' : 'teamSessions.loadFailedCause'),
        variant: 'destructive',
      })
    }
  }

  return (
    <Block title={t('teamSessions.detail.objectives')}>
      {noVerdictYet && <p className="text-xs text-hextech-text-dim">{t(editable ? 'teamSessions.detail.noVerdictStaff' : 'teamSessions.detail.noVerdict')}</p>}
      <ul className="space-y-2">
        {detail.objectives.map((o) => (
          <li key={o.objectiveId} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
            <span className="min-w-[180px] flex-1 font-medium text-hextech-text-bright">{objectiveLabel(o.objectiveId)}</span>
            <span className="w-24"><Verdict value={o.held} /></span>
            <span className="flex flex-wrap items-center gap-1.5">
              {detail.games.map((g) => (
                <span key={g.gameId} className="flex items-center gap-1">
                  <span className="font-mono text-[10px] text-hextech-text-dim">G{g.index}</span>
                  {editable
                    ? <VerdictToggle value={o.byGame[g.gameId]} label={t('teamSessions.detail.setVerdict', { objective: objectiveLabel(o.objectiveId), game: `G${g.index}` })} onSet={(met) => { void write(o, g.gameId, met) }} />
                    : <span className={cn('font-mono text-[10px]', o.byGame[g.gameId] === true ? 'text-hextech-green' : o.byGame[g.gameId] === false ? 'text-hextech-red' : 'text-hextech-text-dim')}>
                        {o.byGame[g.gameId] === true ? '✓' : o.byGame[g.gameId] === false ? '✗' : '–'}
                      </span>}
                </span>
              ))}
              {editable && (
                <span className="ml-2 flex items-center gap-1">
                  <span className="text-[10px] text-hextech-text-dim">{t('teamSessions.detail.wholeShort')}</span>
                  <VerdictToggle value={o.session} label={t('teamSessions.detail.setVerdict', { objective: objectiveLabel(o.objectiveId), game: t('teamSessions.detail.whole') })} onSet={(met) => { void write(o, null, met) }} />
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </Block>
  )
}

/* ─── Block 4: notes and reviews ─── */

function NotesBlock({ detail, gameId, canManage, nameOf, calendarEventId }: {
  detail: TeamSessionHistoryDetail
  gameId: string | null
  canManage: boolean
  nameOf: NameOf
  calendarEventId: string | null
}) {
  const { t } = useTranslation()
  const reviews = orderForGame(detail.reviews.filter((r) => r.summary || r.youtubeUrl || r.transcript), gameId)
  const notes = detail.scrimNotes
  const hasNotes = !!notes && (!!notes.prepNotes || !!notes.reviewNotes || notes.checklist.length > 0)
  const attendance = Object.entries(detail.attendance)
  const gameOf = (id: string | null) => detail.games.find((g) => g.gameId === id)
  const empty = reviews.length === 0 && detail.feedback.length === 0 && !hasNotes && attendance.length === 0

  return (
    <Block title={t('teamSessions.detail.notes')}>
      {empty ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-hextech-text-dim">
          <span>{t('teamSessions.detail.noReview')}</span>
          {canManage && calendarEventId && (
            <Button asChild size="sm" variant="outline">
              <Link to={`/team-session/${encodeURIComponent(calendarEventId)}?final=1`}>{t('teamSessions.detail.doReview')}</Link>
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {reviews.length > 0 && (
            <div className="space-y-2">
              {reviews.map((r) => {
                const g = gameOf(r.gameId)
                return (
                  <article key={r.id} className="rounded-md border border-hextech-border-dim bg-hextech-black/30 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-hextech-text-dim">
                      {g ? t('teamSessions.detail.gameReview', { n: g.index }) : r.scope === 'meeting' ? t('teamSessions.detail.meetingReview') : t('teamSessions.detail.sessionReview')}
                    </p>
                    {r.summary && <p className="mt-1 whitespace-pre-wrap text-sm text-hextech-text">{r.summary}</p>}
                    {r.youtubeUrl && (
                      <a href={r.youtubeUrl} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-hextech-gold hover:underline">
                        {t('teamSessions.detail.watchVod')}<ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                    {r.transcript && (
                      <details className="mt-1 text-xs text-hextech-text-dim">
                        <summary className="cursor-pointer">{t('teamSessions.detail.transcript')}</summary>
                        <p className="mt-1 whitespace-pre-wrap">{r.transcript}</p>
                      </details>
                    )}
                  </article>
                )
              })}
            </div>
          )}

          {detail.feedback.length > 0 && (
            <div>
              <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-hextech-text-dim">{t('teamSessions.detail.feedback')}</h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {detail.feedback.map((f) => (
                  <article key={f.userId} className="rounded-md border border-hextech-border-dim bg-hextech-black/30 p-3">
                    <p className="text-xs font-semibold text-hextech-text-bright">{nameOf(f.userId)}</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-hextech-text">{f.body}</p>
                  </article>
                ))}
              </div>
            </div>
          )}

          {hasNotes && notes && (
            <div>
              <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-hextech-text-dim">{t('teamSessions.detail.scrimNotes')}</h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {notes.prepNotes && <article className="rounded-md border border-hextech-border-dim bg-hextech-black/30 p-3"><p className="text-[11px] text-hextech-text-dim">{t('teamSessions.detail.prep')}</p><p className="mt-1 whitespace-pre-wrap text-sm">{notes.prepNotes}</p></article>}
                {notes.reviewNotes && <article className="rounded-md border border-hextech-border-dim bg-hextech-black/30 p-3"><p className="text-[11px] text-hextech-text-dim">{t('teamSessions.detail.after')}</p><p className="mt-1 whitespace-pre-wrap text-sm">{notes.reviewNotes}</p></article>}
              </div>
              {notes.checklist.length > 0 && (
                <ul className="mt-2 space-y-0.5 text-xs">
                  {notes.checklist.map((c, i) => (
                    <li key={i} className={cn('flex items-center gap-1.5', c.done ? 'text-hextech-text' : 'text-hextech-text-dim')}>
                      {c.done ? <Check className="h-3 w-3 text-hextech-green" /> : <Minus className="h-3 w-3" />}{c.label}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {attendance.length > 0 && (
            <div>
              <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-hextech-text-dim">{t('teamSessions.detail.attendance')}</h3>
              <p className="text-xs text-hextech-text">
                {attendance.map(([id, here]) => (
                  <span key={id} className={cn('mr-3 inline-flex items-center gap-1', !here && 'text-hextech-text-dim line-through')}>{nameOf(id)}</span>
                ))}
              </p>
            </div>
          )}

          {reviews.length === 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-hextech-text-dim">
              <span>{t('teamSessions.detail.noReview')}</span>
              {canManage && calendarEventId && (
                <Button asChild size="sm" variant="outline">
                  <Link to={`/team-session/${encodeURIComponent(calendarEventId)}?final=1`}>{t('teamSessions.detail.doReview')}</Link>
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </Block>
  )
}
