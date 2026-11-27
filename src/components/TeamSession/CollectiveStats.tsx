import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ErrorState } from '@/components/ui/data-state'
import { cn } from '@/lib/utils'
import { wrText } from '@/lib/winrate'
import { mmss } from '@/lib/playerSheetView'
import type { SessionCollective } from '@/lib/teamCollectiveStatsCore'
import {
  SMALL_SAMPLE, WARDS_THRESHOLD, conversionOf, controlShare, deathsOf, deathsSummary, gamesWithoutTimeline, goldOf, headerOf, kpOf, objectivesOf, scopeGames,
  deathsGames, scopeOf, setupOf, winPct, type CollectiveScope, type WinRow,
} from '@/lib/collectiveView'
import { ReviewButton, useRecordings } from './PlayerTimelineBlocks'
import { WhyEmpty } from './PlayerIndivBlocks'
import { RulesSection, RulesSummary } from './CollectiveRules'

/* ── Data ── */

type CollectiveApi = { teamSessionCollectiveStats?: (id: string, o?: { enrich?: boolean }) => Promise<SessionCollective | null>; teamObjectivesGameTimeline?: (id: string) => Promise<unknown> }
const api = () => window.api as unknown as CollectiveApi

export type CollectiveState =
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'error' }
  | { status: 'ready'; data: SessionCollective }

/**
 * Loads the session's collective stats (Back-end `teamSessionCollectiveStats`, desktop and web). `refreshKey` reloads it
 * (the live page passes the number of finished games). Null from the API = no game with a usable match: nothing to show.
 */
export function useCollective(sessionId: string, refreshKey: string | number = 0) {
  const [state, setState] = useState<CollectiveState>({ status: 'loading' })
  const load = useCallback(async (quiet = false) => {
    const get = api().teamSessionCollectiveStats
    if (!get) { setState({ status: 'unavailable' }); return }
    if (!quiet) setState((s) => (s.status === 'ready' ? s : { status: 'loading' }))
    try {
      const data = await get(sessionId, { enrich: true })
      setState(data ? { status: 'ready', data } : { status: 'unavailable' })
    } catch { setState((s) => (s.status === 'ready' ? s : { status: 'error' })) }
  }, [sessionId])
  useEffect(() => { void load(true) }, [load, refreshKey])
  const [extracting, setExtracting] = useState(false)
  /** Extracts the timeline of the games that have none (one at a time), then reloads. */
  const extract = useCallback(async (gameIds: string[]) => {
    setExtracting(true)
    try { for (const id of gameIds) await api().teamObjectivesGameTimeline?.(id).catch(() => null) } finally { setExtracting(false) }
    await load(true)
  }, [load])
  return { state, reload: () => load(), extract, extracting }
}

/* ── Small pieces ── */

const OPEN_KEY = 'ascend.collective.open'
type SectionId = 'objectives' | 'gold' | 'conversion' | 'setup' | 'deaths' | 'kp' | 'winrate' | 'rules'
function readOpen(): SectionId[] {
  try { const v = JSON.parse(localStorage.getItem(OPEN_KEY) ?? '[]'); return Array.isArray(v) ? v : [] } catch { return [] }
}
function useOpenSections() {
  const [open, setOpen] = useState<SectionId[]>(readOpen)
  const toggle = (id: SectionId) => setOpen((cur) => {
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
    try { localStorage.setItem(OPEN_KEY, JSON.stringify(next)) } catch { /* private mode */ }
    return next
  })
  return { open, toggle }
}

const LIST_LIMIT = 5

function Pill({ tone, children }: { tone: 'green' | 'red' | 'gold' | 'dim'; children: ReactNode }) {
  return (
    <span className={cn('rounded px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase', tone === 'green' && 'bg-hextech-green/15 text-hextech-green', tone === 'red' && 'bg-hextech-red/15 text-hextech-red',
      tone === 'gold' && 'bg-hextech-gold/15 text-hextech-gold', tone === 'dim' && 'bg-hextech-elevated text-hextech-text-dim')}>{children}</span>
  )
}

function Accordion({ id, title, summary, open, onToggle, children, disabled = false }: { id: SectionId; title: string; summary: ReactNode; open: boolean; onToggle: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <div className="border-b border-hextech-border-dim last:border-b-0">
      <button type="button" aria-expanded={disabled ? false : open} aria-controls={`collective-${id}`} aria-disabled={disabled || undefined} onClick={disabled ? undefined : onToggle}
        className="flex min-h-[44px] w-full flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-hextech-gold">
        <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 transition-transform', disabled ? 'text-hextech-text-dim' : 'text-hextech-gold', open && !disabled && 'rotate-90')} aria-hidden />
        <span className={cn('font-mono text-xs font-bold uppercase tracking-wider', disabled ? 'text-hextech-text-dim' : 'text-hextech-text-bright')}>{title}</span>
        <span className="min-w-0 basis-full truncate pl-6 font-mono text-[11px] text-hextech-text-dim sm:ml-auto sm:basis-auto sm:pl-0 sm:text-right">{summary}</span>
      </button>
      {open && !disabled && <div id={`collective-${id}`} className="space-y-3 px-3 pb-4 pt-1">{children}</div>}
    </div>
  )
}

function ShowAll({ total, shown, onClick, expanded }: { total: number; shown: number; onClick: () => void; expanded: boolean }) {
  const { t } = useTranslation()
  if (total <= LIST_LIMIT) return null
  return (
    <Button type="button" size="sm" variant="outline" className="h-7 text-[11px]" aria-expanded={expanded} onClick={onClick}>
      {expanded ? t('teamCollective.showLess') : t('teamCollective.showAll', { count: total })}
      <span className="sr-only">{shown}</span>
    </Button>
  )
}

/** First rows of a long list, the button for the rest. */
function useLimited<T>(items: T[]) {
  const [all, setAll] = useState(false)
  return { shown: all ? items : items.slice(0, LIST_LIMIT), toggle: () => setAll((v) => !v), all }
}

const b = (v: ReactNode, cls = 'text-hextech-text-bright') => <b className={cn('font-bold', cls)}>{v}</b>

/* ── The block ── */

export function CollectiveStatsBlock({ state, gameIndex, onRetry, onExtract, extracting, matchIdOf, roleOf, live = false }: {
  state: CollectiveState
  /** Picked game (HistoryGame.index), null = whole session. */
  gameIndex: number | null
  onRetry: () => void
  onExtract: (gameIds: string[]) => void
  extracting: boolean
  /** Team game id → Riot match id, to find a game's recording. */
  matchIdOf?: Record<string, string>
  roleOf?: (memberId: string) => string | undefined
  live?: boolean
}) {
  const { t, i18n } = useTranslation()
  const { open, toggle } = useOpenSections()
  const lang = i18n.language
  if (state.status === 'unavailable') return null
  if (state.status === 'loading') return <CollectiveSkeleton />
  if (state.status === 'error') {
    return <ErrorState title={t('teamCollective.errorTitle')} cause={t('teamCollective.errorCause')} onRetry={onRetry} />
  }
  const scope = scopeOf(state.data, gameIndex)
  if (!scope) return null
  return <CollectiveBody scope={scope} lang={lang} open={open} toggle={toggle} onExtract={onExtract} extracting={extracting} matchIdOf={matchIdOf} roleOf={roleOf} live={live} t={t} />
}

function CollectiveSkeleton() {
  const { t } = useTranslation()
  const bar = (w: string) => <span className={cn('block h-2 animate-pulse rounded bg-hextech-elevated/80', w)} />
  return (
    <section className="space-y-3 rounded-lg border border-hextech-border-dim bg-hextech-dark/50 p-4" aria-busy aria-label={t('teamCollective.title')}>
      <h2 className="font-mono text-xs font-semibold uppercase tracking-wider text-hextech-gold">{t('teamCollective.title')}</h2>
      <div role="status" className="flex items-center gap-2 rounded-md border border-hextech-gold/30 bg-hextech-gold/10 px-3 py-2 text-xs text-hextech-text">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-hextech-gold" aria-hidden />{t('teamCollective.reading')}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((i) => <div key={i} className="space-y-3 rounded-lg border border-hextech-border-dim bg-hextech-black/40 p-4">{bar('w-24')}<span className="block h-8 w-28 animate-pulse rounded bg-hextech-elevated/80" />{bar('w-40')}</div>)}
      </div>
      <div className="rounded-lg border border-hextech-border-dim">
        {(['objectives', 'gold', 'conversion', 'setup', 'deaths', 'kp', 'winrate'] as const).map((k) => (
          <div key={k} className="flex min-h-[44px] items-center gap-3 border-b border-hextech-border-dim px-3 last:border-b-0">
            <ChevronRight className="h-3.5 w-3.5 text-hextech-gold" aria-hidden />
            <span className="font-mono text-xs font-bold uppercase tracking-wider text-hextech-text-bright">{t(`teamCollective.sec.${k}`)}</span>
            <span className="ml-auto">{bar('w-40')}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

type Tr = (k: string, o?: Record<string, unknown>) => string

function CollectiveBody({ scope, lang, open, toggle, onExtract, extracting, matchIdOf, roleOf, live, t }: {
  scope: CollectiveScope; lang: string; open: SectionId[]; toggle: (id: SectionId) => void; onExtract: (ids: string[]) => void; extracting: boolean
  matchIdOf?: Record<string, string>; roleOf?: (id: string) => string | undefined; live: boolean; t: Tr
}) {
  const single = scope.kind === 'game'
  const head = headerOf(scope)
  const nf = (n: number, d = 0) => n.toLocaleString(lang, { maximumFractionDigits: d })
  const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${nf(Math.abs(Math.round(n)))}`
  const obj = useMemo(() => objectivesOf(scope), [scope])
  const control = controlShare(obj.rows)
  const gold = useMemo(() => goldOf(scope), [scope])
  const conv = useMemo(() => conversionOf(scope), [scope])
  const setup = useMemo(() => setupOf(scope), [scope])
  const deaths = deathsOf(scope)
  const kp = kpOf(scope)
  const rules = (scope.kind === 'game' ? scope.game.rules : scope.c.rules) ?? null
  const roleName = (r: string) => { const m = kp.find((p) => roleOf?.(p.memberId) === r); return m?.displayName }
  const noTimeline = gamesWithoutTimeline(scope)
  const small = head.games < SMALL_SAMPLE
  const pctText = (p: number | null) => (p == null ? '—' : `${Math.round(p)} %`)
  const rate = (p: number | null, games: number) => (p == null ? 'text-hextech-text-dim' : small ? 'text-hextech-text-dim' : wrText(p, games))
  const goldTone = gold.at15 == null ? 'text-hextech-text-dim' : gold.at15 > 0 ? 'text-hextech-green' : gold.at15 < 0 ? 'text-hextech-red' : 'text-hextech-text-dim'
  const row = (key: string) => obj.rows.find((r) => r.key === key)!
  const gameIds = scopeGames(scope).map((g) => g.gameId)
  const rec = useRecordings(gameIds, matchIdOf)
  const sideWord = (s: 'blue' | 'red') => t(s === 'blue' ? 'teamCollective.sideBlue' : 'teamCollective.sideRed')

  const extractAction = noTimeline.length > 0 ? (
    <Button type="button" size="sm" variant="outline" disabled={extracting} onClick={() => onExtract(noTimeline.map((g) => g.gameId))}>
      {extracting && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />}{t('teamCollective.extract', { count: noTimeline.length })}
    </Button>
  ) : null
  const needsTimeline = (ok: boolean, children: ReactNode) => (ok ? children : (
    <WhyEmpty text={t('teamCollective.noTimelineWhy', { count: Math.max(1, noTimeline.length) })} action={noTimeline.length > 0 ? t('teamCollective.extract', { count: noTimeline.length }) : undefined}
      onAction={() => onExtract(noTimeline.map((g) => g.gameId))} busy={extracting} />
  ))
  const noneReady = noTimeline.length > 0 && noTimeline.length === scopeGames(scope).length
  const timelineNeeded = <span>— · {t('teamCollective.timelineNeeded')}</span>
  const over = (n: number) => (n < head.games && n > 0 ? <> · {t('teamCollective.overGames', { count: n })}</> : null)

  const metaGame = single ? scope.game : null
  return (
    <section className="space-y-4 rounded-lg border border-hextech-border-dim bg-hextech-dark/50 p-4" aria-label={t('teamCollective.title')}>
      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
        <h2 className="font-mono text-xs font-semibold uppercase tracking-wider text-hextech-gold">{t('teamCollective.title')}</h2>
        <p className="font-mono text-[11px] text-hextech-text-dim">
          {metaGame
            ? <>G{metaGame.gameIndex} · <SideDot side={metaGame.side} />{sideWord(metaGame.side)} · {mmss(metaGame.durationSec)} · {t(metaGame.win ? 'teamCollective.win' : 'teamCollective.loss')}</>
            : <>
              {t('teamCollective.meta', { count: head.games, wins: head.wins, losses: head.losses })}
              {head.blue.games > 0 && <> · <SideDot side="blue" />{sideWord('blue')} {head.blue.wins}–{head.blue.games - head.blue.wins}</>}
              {head.red.games > 0 && <> · <SideDot side="red" />{sideWord('red')} {head.red.wins}–{head.red.games - head.red.wins}</>}
              {noTimeline.length > 0 && <> · {t('teamCollective.withTimeline', { ready: head.games - noTimeline.length, games: head.games })}</>}
            </>}
        </p>
      </div>

      {(noTimeline.length > 0) && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-hextech-gold/30 bg-hextech-gold/10 px-3 py-2 text-xs text-hextech-text">
          <span>
            <b className="block text-hextech-gold">{single ? t('teamCollective.noTimelineGame', { n: noTimeline[0].gameIndex }) : noneReady ? t('teamCollective.noTimelineAll', { count: noTimeline.length }) : t('teamCollective.noTimelineSome', { count: noTimeline.length, list: noTimeline.map((g) => `G${g.gameIndex}`).join(', ') })}</b>
            <span className="text-hextech-text-dim">{t(noneReady ? 'teamCollective.noTimelineAllHint' : 'teamCollective.noTimelineSomeHint', { count: head.games })}</span>
          </span>
          {extractAction}
        </div>
      )}
      {!single && setup.gamesWithout > 0 && <p className="text-[11px] text-hextech-text-dim">{t('teamCollective.noVisionGames', { count: setup.gamesWithout })}</p>}

      {/* Hero tiles */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Tile label={t('teamCollective.tile.control')} value={pctText(control.pct)} tone={rate(control.pct, head.games)} small={small && !single} badge={single ? t('teamCollective.gamesBadge', { count: 1 }) : undefined}>
          <div className="mt-2 flex h-1.5 overflow-hidden rounded-sm" role="img" aria-label={t('teamCollective.controlFoot', { us: control.ours, them: control.theirs })}>
            <span className="bg-hextech-gold" style={{ width: `${control.pct ?? 0}%` }} />
            <span className="flex-1 border border-hextech-red/70" />
          </div>
          <p className="mt-1 font-mono text-[11px] text-hextech-text-dim">{t('teamCollective.controlFoot', { us: control.ours, them: control.theirs })}</p>
        </Tile>
        <Tile label={t('teamCollective.tile.gold')} value={gold.at15 == null ? '—' : signed(gold.at15)} tone={goldTone} small={small && !single} badge={single ? t('teamCollective.gamesBadge', { count: 1 }) : gold.known && gold.perGame.length < head.games ? t('teamCollective.gamesBadge', { count: gold.perGame.length }) : undefined}>
          <p className="mt-2 font-mono text-[11px] text-hextech-text-dim">
            {!gold.known && timelineNeeded}
            {gold.known && t(single ? 'teamCollective.goldFootGame' : 'teamCollective.goldFoot')}
            {gold.known && gold.ahead > 0 && <> · <span className={gold.lostWhileAhead > 0 ? 'text-hextech-red' : undefined}>{t('teamCollective.lostWhileAhead', { lost: gold.lostWhileAhead, ahead: gold.ahead })}</span></>}
          </p>
        </Tile>
        <Tile label={t('teamCollective.tile.conv')} value={conv.known ? (single && conv.fightsWon > 0 ? `${conv.converted} / ${conv.fightsWon}` : pctText(conv.ratePct)) : '—'} tone={rate(conv.ratePct, head.games)} small={small && !single}
          badge={single ? t('teamCollective.gamesBadge', { count: 1 }) : conv.known && conv.games < head.games ? t('teamCollective.gamesBadge', { count: conv.games }) : undefined}>
          <p className="mt-2 font-mono text-[11px] text-hextech-text-dim">{conv.known ? t('teamCollective.convFoot', { count: conv.fightsWon, done: conv.converted, won: conv.fightsWon }) : timelineNeeded}</p>
        </Tile>
      </div>

      <div className="rounded-lg border border-hextech-border-dim">
        {/* 1 · Objectives */}
        <Accordion id="objectives" title={t('teamCollective.sec.objectives')} open={open.includes('objectives')} onToggle={() => toggle('objectives')}
          summary={<>{t('teamCollective.dragons')} {b(`${row('dragons').ours}–${row('dragons').theirs}`)}{obj.types === null && ` (${t('teamCollective.typesUnknown')})`} · Grubs {b(`${row('grubs').ours}–${row('grubs').theirs}`)} · Baron {b(`${row('baron').ours}–${row('baron').theirs}`)} · {t('teamCollective.towers')} {b(`${row('towers').ours}–${row('towers').theirs}`)}</>}>
          <ObjectivesSection obj={obj} t={t} />
        </Accordion>

        {/* 2 · Gold lead */}
        <Accordion id="gold" title={t('teamCollective.sec.gold')} open={open.includes('gold')} onToggle={() => toggle('gold')}
          summary={gold.known
            ? <>{([['10', gold.at10], ['15', gold.at15], ['20', gold.at20]] as const).map(([m, v], i) => <span key={m}>{i > 0 && ' · '}{v == null ? '—' : b(signed(v), v >= 0 ? 'text-hextech-green' : 'text-hextech-red')} @{m}</span>)}{gold.lostWhileAhead > 0 && <> · {b(t('teamCollective.lostCount', { count: gold.lostWhileAhead }), 'text-hextech-red')}</>}</>
            : timelineNeeded}>
          {needsTimeline(gold.known, <GoldSection gold={gold} single={single} t={t} signed={signed} rec={rec} />)}
        </Accordion>

        {/* 3 · Fights → objective */}
        <Accordion id="conversion" title={t('teamCollective.sec.conversion')} open={open.includes('conversion')} onToggle={() => toggle('conversion')}
          summary={conv.known ? <>{b(`${conv.converted} / ${conv.fightsWon}`)} {t('teamCollective.converted')} · {b(pctText(conv.ratePct), rate(conv.ratePct, head.games))} · {conv.fightsWon - conv.converted} {t('teamCollective.noObjective')}{over(conv.games)}</> : timelineNeeded}>
          {needsTimeline(conv.known, <ConversionSection conv={conv} t={t} rec={rec} />)}
        </Accordion>

        {/* 4 · Objective setup */}
        <Accordion id="setup" title={t('teamCollective.sec.setup')} open={open.includes('setup')} onToggle={() => toggle('setup')}
          summary={setup.known
            ? <>{b(`${setup.taken} / ${setup.rows.length}`)} {t('teamCollective.takenWord')} · {t('teamCollective.wardsAvg', { avg: nf(setup.avgWards ?? 0, 1) })}{over(setup.games)}{setup.missing.length > 0 && <> · {setup.missing.map((n) => `G${n}`).join(', ')} {t('teamCollective.unavailableShort')}</>}</>
            : noneReady ? timelineNeeded : t('teamCollective.notAvailable')}>
          {setup.known ? <SetupSection setup={setup} t={t} rec={rec} /> : setup.missing.length === 0 && noTimeline.length > 0 ? needsTimeline(false, null) : <WhyEmpty text={t('teamCollective.setupWhy', { count: Math.max(1, setup.missing.length) })} />}
        </Accordion>

        {/* 5 · Deaths */}
        <Accordion id="deaths" title={t('teamCollective.sec.deaths')} open={open.includes('deaths')} onToggle={() => toggle('deaths')}
          summary={deaths ? (() => { const s = deathsSummary(deaths); return <>{b(s.total)} {t('teamCollective.deathsWord')} · {b(s.isolated, 'text-hextech-red')} {t('teamCollective.isolatedWord')} · {b(s.late)} {t('teamCollective.afterWord')}{over(deathsGames(scope))}</> })() : timelineNeeded}>
          {needsTimeline(!!deaths, deaths && <DeathsSection deaths={deaths} t={t} />)}
        </Accordion>

        {/* 6 · Kill participation */}
        <Accordion id="kp" title={t('teamCollective.sec.kp')} open={open.includes('kp')} onToggle={() => toggle('kp')}
          summary={kp.length > 0 ? (() => {
            const avg = kp.reduce((n, p) => n + p.kpPct, 0) / kp.length
            const worst = [...kp].sort((a, c) => a.gapPct - c.gapPct)[0]
            return <>{t('teamCollective.teamWord')} {b(`${Math.round(avg)} %`)}{worst.gapPct < 0 && <> · {t('teamCollective.biggestGap')} : {b(`${worst.displayName} ${signed(worst.gapPct)} pts`, 'text-hextech-red')}</>}</>
          })() : '—'}>
          {kp.length === 0 ? <WhyEmpty text={t('teamCollective.noKp')} /> : <KpSection kp={kp} roleOf={roleOf} t={t} signed={signed} />}
        </Accordion>

        {/* 7 · Win rate by side and duration (whole session only) */}
        {!single && scope.kind === 'session' && (
          <Accordion id="winrate" title={t('teamCollective.sec.winrate')} open={open.includes('winrate')} onToggle={() => toggle('winrate')}
            summary={<>{(['blue', 'red'] as const).map((s, i) => <span key={s}>{i > 0 && ' · '}{sideWord(s)} {b(`${scope.c.bySide[s].wins}–${scope.c.bySide[s].games - scope.c.bySide[s].wins}`)}</span>)}</>}>
            <WinrateSection scope={scope} t={t} sideWord={sideWord} pct={pctText} />
          </Accordion>
        )}

        {/* 8 · Prio, crossmap & duo (docs/design/STATS_COLLECTIVES_EQUIPE.md A.3) */}
        <Accordion id="rules" title={t('prioRules.title')} open={open.includes('rules')} onToggle={() => toggle('rules')} disabled={!rules}
          summary={<RulesSummary rules={rules} timelineNeeded />}>
          {rules && <RulesSection rules={rules} noTimeline={noTimeline.map((g) => g.gameIndex)} games={head.games} duoNames={{ adc: roleName('ADC'), support: roleName('SUPPORT') }} />}
        </Accordion>
      </div>
      {live && <p className="text-[11px] text-hextech-text-dim">{t('teamCollective.liveNote')}</p>}
    </section>
  )
}

function SideDot({ side }: { side: 'blue' | 'red' }) {
  return <span aria-hidden className={cn('mr-1 inline-block h-2 w-2 rounded-full align-middle', side === 'blue' ? 'bg-[var(--side-blue)]' : 'bg-hextech-red')} />
}

function Tile({ label, value, tone, small, badge, children }: { label: string; value: string; tone: string; small: boolean; badge?: string; children: ReactNode }) {
  const { t } = useTranslation()
  return (
    <div className="rounded-lg border border-hextech-border-dim bg-hextech-black/40 p-3 sm:p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-hextech-text-dim">{label}</p>
        {badge && <span className="rounded bg-hextech-elevated px-1.5 py-0.5 font-mono text-[10px] text-hextech-text-dim">{badge}</span>}
      </div>
      <p className={cn('mt-1 font-mono text-2xl font-bold tabular-nums sm:text-[32px] sm:leading-10', tone)}>{value}</p>
      {children}
      {small && <p className="mt-1 text-[10px] text-hextech-text-dim">{t('teamCollective.smallSample')}</p>}
    </div>
  )
}

/* ── Sections ── */

function ObjectivesSection({ obj, t }: { obj: ReturnType<typeof objectivesOf>; t: Tr }) {
  const max = Math.max(1, ...obj.rows.flatMap((r) => [r.ours, r.theirs]))
  const label = (k: string) => (k === 'dragons' ? t('teamCollective.dragons') : k === 'towers' ? t('teamCollective.towers') : k === 'grubs' ? 'Grubs' : k === 'herald' ? 'Herald' : k === 'baron' ? 'Baron' : 'Elder')
  return (
    <>
      <div role="table" aria-label={t('teamCollective.sec.objectives')} className="text-xs">
        <div role="row" className="grid grid-cols-[4.5rem_1fr_1fr] gap-2 border-b border-hextech-border-dim pb-1 font-mono text-[10px] uppercase tracking-wider text-hextech-text-dim sm:grid-cols-[6rem_1fr_1fr]">
          <span role="columnheader">{t('teamCollective.objective')}</span><span role="columnheader" className="text-right">{t('teamCollective.us')}</span><span role="columnheader">{t('teamCollective.them')}</span>
        </div>
        {obj.rows.map((r) => (
          <div role="row" key={r.key} className="grid min-h-[30px] grid-cols-[4.5rem_1fr_1fr] items-center gap-2 border-b border-hextech-border-dim/50 sm:grid-cols-[6rem_1fr_1fr]">
            <span role="rowheader" className="text-hextech-text">{label(r.key)}</span>
            <span role="cell" className="flex items-center justify-end gap-2"><b className="font-mono tabular-nums text-hextech-text-bright">{r.ours}</b><i className="block h-2 rounded-sm bg-hextech-gold" style={{ width: `${(r.ours / max) * 70}%`, minWidth: r.ours > 0 ? 4 : 0 }} /></span>
            <span role="cell" className="flex items-center gap-2"><i className="block h-2 rounded-sm border border-hextech-red/80" style={{ width: `${(r.theirs / max) * 70}%`, minWidth: r.theirs > 0 ? 4 : 2 }} /><b className="font-mono tabular-nums text-hextech-text">{r.theirs}</b></span>
          </div>
        ))}
      </div>
      {obj.types && obj.types.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-wider text-hextech-text-dim">{t('teamCollective.dragonsByType')}</span>
          {obj.types.map((d) => (
            <span key={d.type} className="rounded border border-hextech-border-dim px-2 py-0.5 font-mono text-[11px] text-hextech-text">
              {t(`teamCollective.dragon.${d.type}`)} <b className="text-hextech-gold">{d.ours}</b> – <b className="text-hextech-red">{d.theirs}</b>
            </span>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-wider text-hextech-text-dim">{t('teamCollective.firsts')}</span>
        {obj.firsts.map((f) => (
          <span key={f.key} className="rounded border border-hextech-border-dim px-2 py-0.5 font-mono text-[11px] text-hextech-text">
            First {f.key === 'blood' ? 'blood' : f.key}{' '}
            {f.owner !== null || f.games === 0
              ? <b className={f.owner === 'us' ? 'text-hextech-gold' : f.owner === 'them' ? 'text-hextech-red' : 'text-hextech-text-dim'}>{f.games === 0 ? '—' : t(f.owner === 'us' ? 'teamCollective.us' : 'teamCollective.them')}</b>
              : <b className="text-hextech-gold">{t('teamCollective.usCount', { us: f.us, games: f.games })}</b>}
          </span>
        ))}
      </div>
    </>
  )
}

type Rec = Record<string, string | null>

function GoldSection({ gold, single, t, signed, rec }: { gold: ReturnType<typeof goldOf>; single: boolean; t: Tr; signed: (n: number) => string; rec: Rec }) {
  const list = useLimited(gold.perGame)
  const vals = [['10', gold.at10], ['15', gold.at15], ['20', gold.at20]] as const
  const max = Math.max(1, ...vals.map(([, v]) => Math.abs(v ?? 0)))
  const tone = (v: number | null) => (v == null || v === 0 ? 'text-hextech-text-dim' : v > 0 ? 'text-hextech-green' : 'text-hextech-red')
  return (
    <>
      <div className="grid grid-cols-3 gap-2">
        {vals.map(([m, v]) => (
          <div key={m} className="rounded-md border border-hextech-border-dim bg-hextech-black/40 px-3 py-2">
            <p className="font-mono text-[10px] uppercase tracking-wider text-hextech-text-dim">@{m}</p>
            <p className={cn('font-mono text-lg font-bold tabular-nums', tone(v))}>{v == null ? '—' : signed(v)}</p>
            <div className="mt-1 flex h-1.5 items-center" aria-hidden>
              <span className="flex h-full flex-1 justify-end">{v != null && v < 0 && <i className="block h-full rounded-sm bg-hextech-red" style={{ width: `${(Math.abs(v) / max) * 100}%` }} />}</span>
              <span className="h-3 w-px bg-hextech-border" />
              <span className="flex h-full flex-1">{v != null && v > 0 && <i className="block h-full rounded-sm bg-hextech-green" style={{ width: `${(v / max) * 100}%` }} />}</span>
            </div>
          </div>
        ))}
      </div>
      {single
        ? gold.perGame[0]?.lostWhileAhead && <Pill tone="red">{t('teamCollective.lostPill')}</Pill>
        : (
          <>
            <ul className="divide-y divide-hextech-border-dim/60" aria-label={t('teamCollective.sec.gold')}>
              {list.shown.map((g) => (
                <li key={g.gameId} className="flex min-h-[34px] flex-wrap items-center gap-x-4 gap-y-1 py-1 text-xs">
                  <span className="w-8 font-mono text-[11px] text-hextech-gold">G{g.gameIndex}</span>
                  {([['10', g.at10], ['15', g.at15], ['20', g.at20]] as const).map(([m, v]) => (
                    <span key={m} className={cn('font-mono tabular-nums', tone(v))}>{v == null ? '—' : signed(v)} <span className="text-hextech-text-dim">@{m}</span></span>
                  ))}
                  <Pill tone={g.win ? 'green' : 'red'}>{t(g.win ? 'teamSessions.winShort' : 'teamSessions.lossShort')}</Pill>
                  {g.lostWhileAhead && <Pill tone="red">{t('teamCollective.lostPill')}</Pill>}
                  {g.lostWhileAhead && <span className="ml-auto"><ReviewButton recordingId={rec[g.gameId]} seekSec={890} clock="15:00" game={g.gameIndex} /></span>}
                </li>
              ))}
            </ul>
            <ShowAll total={gold.perGame.length} shown={list.shown.length} expanded={list.all} onClick={list.toggle} />
          </>
        )}
    </>
  )
}

function ConversionSection({ conv, t, rec }: { conv: ReturnType<typeof conversionOf>; t: Tr; rec: Rec }) {
  const list = useLimited(conv.items)
  const by = new Map<string, number>()
  for (const i of conv.items) if (i.objective) by.set(i.objective, (by.get(i.objective) ?? 0) + 1)
  return (
    <>
      {by.size > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-wider text-hextech-text-dim">{t('teamCollective.followedBy')}</span>
          {[...by.entries()].map(([k, n]) => <span key={k} className="rounded border border-hextech-border-dim px-2 py-0.5 font-mono text-[11px] text-hextech-text">{t(`playerSheet.obj.${k}`)} <b className="text-hextech-gold">{n}</b></span>)}
        </div>
      )}
      {conv.items.length === 0 ? <p className="text-xs text-hextech-text-dim">{t('teamCollective.noFights')}</p> : (
        <ul className="divide-y divide-hextech-border-dim/60" aria-label={t('teamCollective.sec.conversion')}>
          {list.shown.map((f, i) => (
            <li key={`${f.gameId}-${f.atSec}-${i}`} className="flex min-h-[34px] flex-wrap items-center gap-x-3 gap-y-1 py-1 text-xs">
              <span className="w-12 font-mono tabular-nums text-hextech-text-bright">{mmss(f.atSec)}</span>
              <span className="font-mono text-[11px] text-hextech-gold">G{f.gameIndex}</span>
              <span className="text-hextech-text">{t('teamCollective.netKills', { count: f.kills })}</span>
              {f.objective
                ? <span className="text-hextech-green">→ {t(`playerSheet.obj.${f.objective}`)} {t('teamCollective.inSeconds', { s: f.delaySec ?? 0 })}</span>
                : <span className="text-hextech-red">{t('teamCollective.nothingTaken')}</span>}
              <span className="ml-auto"><ReviewButton recordingId={rec[f.gameId]} seekSec={f.atSec - 10} clock={mmss(f.atSec)} game={f.gameIndex} /></span>
            </li>
          ))}
        </ul>
      )}
      <ShowAll total={conv.items.length} shown={list.shown.length} expanded={list.all} onClick={list.toggle} />
    </>
  )
}

function SetupSection({ setup, t, rec }: { setup: ReturnType<typeof setupOf>; t: Tr; rec: Rec }) {
  const list = useLimited(setup.rows)
  const tone = { taken: 'green', lost: 'red', contested: 'gold' } as const
  const x = (s: { taken: number; total: number }) => `${s.taken} / ${s.total}`
  return (
    <>
      {setup.missing.length > 0 && <WhyEmpty text={t('teamCollective.setupMissing', { count: setup.missing.length, list: setup.missing.map((n) => `G${n}`).join(', ') })} />}
      <ul className="divide-y divide-hextech-border-dim/60" aria-label={t('teamCollective.sec.setup')}>
        {list.shown.map((r, i) => (
          <li key={`${r.gameId}-${r.atSec}-${i}`} className="flex min-h-[40px] flex-wrap items-center gap-x-3 gap-y-1 py-1 text-xs">
            <span className="w-12 font-mono tabular-nums text-hextech-text-bright">{mmss(r.atSec)}</span>
            <span className="font-mono text-[11px] text-hextech-gold">G{r.gameIndex}</span>
            <span className="w-14 text-hextech-text">{t(r.kind === 'dragon' ? 'teamCollective.drake' : `playerSheet.obj.${r.kind}`)}</span>
            <span className="inline-flex items-center gap-1.5" title={t('teamCollective.wardsBefore')}>
              <b className="w-3 font-mono tabular-nums text-hextech-text-bright">{r.wardsPlaced}</b>
              <span className="flex gap-0.5" aria-hidden>{Array.from({ length: 6 }, (_, k) => <i key={k} className={cn('block h-2 w-2 rounded-[1px]', k < r.wardsPlaced ? 'bg-hextech-gold' : 'bg-hextech-gold/20')} />)}</span>
              <span className="sr-only">{t('teamCollective.wardsBefore')}</span>
            </span>
            <Pill tone={tone[r.outcome]}>{t(`teamCollective.outcome.${r.outcome}`)}</Pill>
            <span className="ml-auto"><ReviewButton recordingId={rec[r.gameId]} seekSec={r.atSec - 30} clock={mmss(r.atSec)} game={r.gameIndex} /></span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ShowAll total={setup.rows.length} shown={list.shown.length} expanded={list.all} onClick={list.toggle} />
        <p className="font-mono text-[11px] text-hextech-text-dim">
          {t('teamCollective.withWards', { n: WARDS_THRESHOLD })} : <b className="text-hextech-green">{x(setup.withWards)}</b> · {t('teamCollective.withoutWards', { n: WARDS_THRESHOLD })} : <b className="text-hextech-red">{x(setup.withoutWards)}</b>
        </p>
      </div>
    </>
  )
}

function DeathsSection({ deaths, t }: { deaths: NonNullable<ReturnType<typeof deathsOf>>; t: Tr }) {
  const phases = [['early', '0 – 14′'], ['mid', '14 – 25′'], ['late', '25′ +']] as const
  const rows = [['isolated', t('teamCollective.isolated')], ['grouped', t('teamCollective.grouped')], ['unknown', t('teamCollective.unknownPos')]] as const
  const max = Math.max(1, ...phases.flatMap(([p]) => rows.map(([r]) => deaths[p][r])))
  const weight = (n: number) => (n === 0 ? '' : n / max > 0.66 ? 'bg-hextech-red/30' : n / max > 0.33 ? 'bg-hextech-red/20' : 'bg-hextech-red/10')
  return (
    <div role="table" aria-label={t('teamCollective.sec.deaths')} className="text-xs">
      <div role="row" className="grid grid-cols-[5.5rem_repeat(3,1fr)_2.5rem] items-center gap-2 pb-1 font-mono text-[10px] uppercase tracking-wider text-hextech-text-dim sm:grid-cols-[8rem_repeat(3,1fr)_3rem]">
        <span role="columnheader" />{phases.map(([, l]) => <span key={l} role="columnheader" className="text-center">{l}</span>)}<span role="columnheader" className="text-right">{t('teamCollective.total')}</span>
      </div>
      {rows.map(([r, label]) => (
        <div role="row" key={r} className="grid grid-cols-[5.5rem_repeat(3,1fr)_2.5rem] items-center gap-2 py-0.5 sm:grid-cols-[8rem_repeat(3,1fr)_3rem]">
          <span role="rowheader" className={cn(r === 'unknown' ? 'text-hextech-text-dim' : 'text-hextech-text')}>{label}</span>
          {phases.map(([p]) => (
            <span key={p} role="cell" className={cn('flex h-9 min-w-[3rem] items-center justify-center rounded border font-mono text-sm font-bold tabular-nums', r === 'unknown' ? 'border-hextech-border-dim text-hextech-text-dim' : cn('border-hextech-red/30 text-hextech-text-bright', weight(deaths[p][r])))}>{deaths[p][r]}</span>
          ))}
          <span role="cell" className="text-right font-mono tabular-nums text-hextech-text-bright">{phases.reduce((n, [p]) => n + deaths[p][r], 0)}</span>
        </div>
      ))}
    </div>
  )
}

function KpSection({ kp, roleOf, t, signed }: { kp: ReturnType<typeof kpOf>; roleOf?: (id: string) => string | undefined; t: Tr; signed: (n: number) => string }) {
  const ORDER = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT']
  const rows = [...kp].sort((a, c) => ORDER.indexOf(roleOf?.(a.memberId) ?? '') - ORDER.indexOf(roleOf?.(c.memberId) ?? ''))
  return (
    <ul className="space-y-1.5" aria-label={t('teamCollective.sec.kp')}>
      {rows.map((p) => (
        <li key={p.memberId} className="grid grid-cols-[4rem_1fr] items-center gap-x-3 gap-y-1 text-xs sm:grid-cols-[4.5rem_9rem_1fr_3rem_4.5rem]">
          <span className="font-mono text-[10px] uppercase text-hextech-text-dim">{roleOf?.(p.memberId) ?? ''}</span>
          <span className="truncate text-hextech-text">{p.displayName}</span>
          <span className="col-span-2 h-1.5 rounded-sm bg-hextech-black/60 sm:col-span-1" aria-hidden><i className="block h-full rounded-sm bg-hextech-gold" style={{ width: `${Math.min(100, p.kpPct)}%` }} /></span>
          <span className="font-mono tabular-nums text-hextech-text-bright sm:text-right">{Math.round(p.kpPct)} %</span>
          <span className={cn('font-mono tabular-nums sm:text-right', p.gapPct > 0 ? 'text-hextech-green' : p.gapPct < 0 ? 'text-hextech-red' : 'text-hextech-text-dim')} title={t('teamCollective.gapToTeam')}>{signed(p.gapPct)} pts</span>
        </li>
      ))}
    </ul>
  )
}

function WinrateSection({ scope, t, sideWord, pct }: { scope: Extract<CollectiveScope, { kind: 'session' }>; t: Tr; sideWord: (s: 'blue' | 'red') => string; pct: (p: number | null) => string }) {
  const groups: Array<{ title: string; rows: Array<{ key: string; label: ReactNode; w: WinRow }> }> = [
    { title: t('teamCollective.bySide'), rows: (['blue', 'red'] as const).map((s) => ({ key: s, label: <><SideDot side={s} />{sideWord(s)}</>, w: scope.c.bySide[s] })) },
    { title: t('teamCollective.byDuration'), rows: [['short', '< 25′'], ['medium', '25 – 35′'], ['long', '> 35′']].map(([k, l]) => ({ key: k, label: l, w: scope.c.byDuration[k as 'short'] })) },
  ]
  return (
    <div className="space-y-3 text-xs">
      {groups.map((g) => (
        <div key={g.title} role="table" aria-label={g.title}>
          <div role="row" className="grid grid-cols-[1fr_3rem_4rem_4rem] gap-2 border-b border-hextech-border-dim pb-1 font-mono text-[10px] uppercase tracking-wider text-hextech-text-dim">
            <span role="columnheader">{g.title}</span><span role="columnheader" className="text-right">Games</span><span role="columnheader" className="text-right">{t('teamCollective.wl')}</span><span role="columnheader" className="text-right">Winrate</span>
          </div>
          {g.rows.map((r) => {
            const p = winPct(r.w)
            return (
              <div role="row" key={r.key} className="grid min-h-[30px] grid-cols-[1fr_3rem_4rem_4rem] items-center gap-2 border-b border-hextech-border-dim/50">
                <span role="rowheader" className="text-hextech-text">{r.label}</span>
                <span role="cell" className="text-right font-mono tabular-nums">{r.w.games}</span>
                <span role="cell" className="text-right font-mono tabular-nums">{r.w.wins}–{r.w.games - r.w.wins}</span>
                <span role="cell" className={cn('text-right font-mono font-bold tabular-nums', p == null ? 'text-hextech-text-dim' : wrText(p, r.w.games))}>{pct(p)}</span>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
