import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Castle, Crown, Droplet, Eye, Flame, Bug, Target, CalendarDays } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { EmptyState, ErrorState, SkeletonKpiTiles } from '@/components/ui/data-state'
import { wrText } from '@/lib/winrate'
import type { ObjectiveKind, TeamGameTimeline, TeamObjectivesSummary, TeamTimelineEvent } from '@/lib/analyst'
import { clock, friezeTicks, pct, signedClockDiff, signedGold, type ObjectivesFilterState } from '@/lib/analystViews'
import { AnalystTile, FilterChip, NoticeBanner, ProgressBanner, ResultBadge, Segmented, SidePill, analystPanel } from './shared'

/**
 * #40 · 1/3, Stats collectives → « Objectifs » (docs/DESIGN_STATE.md § 10), on the Back-end contract
 * (TeamObjectivesSummary from summarizeTeamObjectives, src/lib/teamTimelineCore.ts). Shares are 0-1.
 */

// ── Filters ──────────────────────────────────────────────────────────────────

export function ObjectivesFilters({ value, onChange, games, patch }: {
  value: ObjectivesFilterState
  onChange: (v: ObjectivesFilterState) => void
  games: number | null
  patch: string | null
}) {
  const { t } = useTranslation()
  const toggleSource = (s: ObjectivesFilterState['sources'][number]) => {
    const on = value.sources.includes(s)
    if (on && value.sources.length === 1) return // at least one source stays on
    onChange({ ...value, sources: on ? value.sources.filter((x) => x !== s) : [...value.sources, s] })
  }
  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 rounded-lg border border-hextech-border-dim bg-hextech-dark/95 p-2 backdrop-blur">
      <Segmented
        label={t('analyst.filters.period')}
        value={value.period}
        onChange={(period) => onChange({ ...value, period })}
        options={(['7d', '30d', 'season', 'custom'] as const).map((id) => ({ id, label: t(`analyst.filters.periods.${id}`) }))}
      />
      {value.period === 'custom' && (
        <span className="flex items-center gap-1">
          <Input type="date" aria-label={t('analyst.filters.from')} value={value.from ?? ''} onChange={(e) => onChange({ ...value, from: e.target.value })} className="h-7 w-36 text-xs" />
          <Input type="date" aria-label={t('analyst.filters.to')} value={value.to ?? ''} onChange={(e) => onChange({ ...value, to: e.target.value })} className="h-7 w-36 text-xs" />
        </span>
      )}
      <span role="group" aria-label={t('analyst.filters.source')} className="flex items-center gap-1">
        {(['flex', 'scrim', 'tournament'] as const).map((s) => (
          <FilterChip key={s} on={value.sources.includes(s)} onToggle={() => toggleSource(s)}>{t(`analyst.common.source.${s}`)}</FilterChip>
        ))}
      </span>
      <Segmented
        label={t('analyst.filters.side')}
        value={value.side}
        onChange={(side) => onChange({ ...value, side })}
        options={(['both', 'blue', 'red'] as const).map((id) => ({ id, label: t(`analyst.filters.sides.${id}`) }))}
      />
      {games != null && (
        <span className="ml-auto font-mono text-xs text-hextech-text-dim">
          {t('analyst.objectives.count', { count: games })}{patch ? ` · ${t('analyst.objectives.patch', { patch })}` : ''}
        </span>
      )}
    </div>
  )
}

// ── 1. Control tiles ─────────────────────────────────────────────────────────

type Tiles = TeamObjectivesSummary['tiles']

const round = (v: number | null) => (v == null ? null : Math.round(v))

export function ControlTiles({ tiles, lowSample, compact = false }: { tiles: Tiles; lowSample: boolean; compact?: boolean }) {
  const { t } = useTranslation()
  const pctText = (share: number | null) => (share == null ? '—' : `${Math.round(share * 100)} %`)
  const tone = (share: number | null) => (share == null ? 'text-hextech-text-dim' : wrText(share * 100, null, lowSample))
  const timing = (sec: number | null) => (sec == null ? undefined : clock(sec))
  const note = lowSample ? t('analyst.common.lowSample') : undefined
  const grubShare = tiles.grubs.avgTaken != null && tiles.grubs.available > 0 ? tiles.grubs.avgTaken / tiles.grubs.available : null
  const items: Array<{ key: string; icon: ReactNode; value: string; valueClass: string; foot?: string }> = [
    {
      key: 'dragons', icon: <Flame className="h-4 w-4" />, value: pctText(tiles.dragons.share), valueClass: tone(tiles.dragons.share),
      foot: [
        tiles.dragons.firstDragonShare != null && t('analyst.objectives.tiles.firstDrake', { pct: round(pct(tiles.dragons.firstDragonShare)) }),
        tiles.dragons.soulGames > 0 && t('analyst.objectives.tiles.soul', { ours: tiles.dragons.soulsOurs, games: tiles.dragons.soulGames }),
      ].filter(Boolean).join(' · ') || undefined,
    },
    {
      // « x / 3 » since patch 25.09, « x / 6 » before (grubs.available).
      key: 'grubs', icon: <Bug className="h-4 w-4" />,
      value: tiles.grubs.avgTaken != null ? `${tiles.grubs.avgTaken.toFixed(1)} / ${tiles.grubs.available}` : '—',
      valueClass: tone(grubShare),
      foot: tiles.grubs.firstCampShare != null ? t('analyst.objectives.tiles.firstCamp', { pct: round(pct(tiles.grubs.firstCampShare)) }) : undefined,
    },
    { key: 'herald', icon: <Eye className="h-4 w-4" />, value: pctText(tiles.herald.share), valueClass: tone(tiles.herald.share), foot: timing(tiles.herald.avgAtSec) },
    {
      key: 'baron', icon: <Crown className="h-4 w-4" />, value: pctText(tiles.baron.share), valueClass: tone(tiles.baron.share),
      foot: tiles.baron.baronToWinShare != null ? t('analyst.objectives.tiles.baronToWin', { pct: round(pct(tiles.baron.baronToWinShare)) }) : undefined,
    },
    { key: 'firstBlood', icon: <Droplet className="h-4 w-4" />, value: pctText(tiles.firstBlood.share), valueClass: tone(tiles.firstBlood.share), foot: timing(tiles.firstBlood.avgAtSec) },
    {
      key: 'firstTower', icon: <Castle className="h-4 w-4" />, value: pctText(tiles.firstTower.share), valueClass: tone(tiles.firstTower.share),
      foot: [timing(tiles.firstTower.avgAtSec), tiles.firstTower.mostLane && t(`analyst.objectives.lanes.${tiles.firstTower.mostLane}`)].filter(Boolean).join(' · ') || undefined,
    },
  ]
  return (
    <div className={cn('grid gap-3', compact ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-2 md:grid-cols-3 xl:grid-cols-6')}>
      {(compact ? items.slice(0, 3) : items).map((it) => (
        <AnalystTile key={it.key} label={t(`analyst.objectives.tiles.${it.key}`)} icon={compact ? undefined : it.icon}
          value={it.value} valueClass={it.valueClass} note={note} foot={compact ? undefined : it.foot} />
      ))}
    </div>
  )
}

// ── 2. Gold difference curve ─────────────────────────────────────────────────

const W = 600
const H = 180
const PAD = 8

/** SVG path of a per-minute series; a gap (null: no game lasted that long) starts a new segment. */
function pathOf(series: Array<number | null>, maxAbs: number): string {
  const n = Math.max(1, series.length - 1)
  let d = ''
  let pen = false
  series.forEach((v, i) => {
    if (v == null) { pen = false; return }
    const x = PAD + (i / n) * (W - 2 * PAD)
    const y = H / 2 - (v / maxAbs) * (H / 2 - PAD)
    d += `${pen ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)} `
    pen = true
  })
  return d.trim()
}

export function GoldDiffChart({ curve, side }: { curve: TeamObjectivesSummary['goldCurve']; side: ObjectivesFilterState['side'] }) {
  const { t } = useTranslation()
  const [hover, setHover] = useState<number | null>(null)
  const showSides = side === 'both' && curve.blue.some((v) => v != null) && curve.red.some((v) => v != null)
  const values = [...curve.all, ...(showSides ? [...curve.blue, ...curve.red] : [])].filter((v): v is number => v != null)
  const maxAbs = Math.max(500, ...values.map(Math.abs))
  const last = Math.max(1, curve.all.length - 1)
  const marks = [10, 15, 20].filter((m) => curve.all[m] != null)
  const xPct = (m: number) => (m / last) * 100
  return (
    <section className={cn(analystPanel, 'p-4')} aria-labelledby="gold-diff-title">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 id="gold-diff-title" className="text-sm font-semibold text-hextech-text-bright">{t('analyst.objectives.gold.title')}</h3>
        {showSides && (
          <span className="flex items-center gap-3 text-[11px] text-hextech-text-dim">
            <span className="flex items-center gap-1"><span aria-hidden className="h-0.5 w-4 bg-hextech-gold" />{t('analyst.objectives.gold.all')}</span>
            <span className="flex items-center gap-1"><span aria-hidden className="h-px w-4 bg-sky-400" />{t('analyst.common.side.blue')}</span>
            <span className="flex items-center gap-1"><span aria-hidden className="h-px w-4 bg-rose-400" />{t('analyst.common.side.red')}</span>
          </span>
        )}
      </div>
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-44 w-full"
          role="img"
          aria-label={t('analyst.objectives.gold.aria', { values: marks.map((m) => `${m} min ${signedGold(curve.all[m]!)}`).join(', ') })}
          onMouseMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            const m = Math.round(((e.clientX - r.left) / r.width) * last)
            setHover(Math.max(0, Math.min(last, m)))
          }}
          onMouseLeave={() => setHover(null)}
        >
          <line x1={PAD} x2={W - PAD} y1={H / 2} y2={H / 2} className="stroke-hextech-border" strokeWidth={1} />
          {showSides && <path d={pathOf(curve.blue, maxAbs)} fill="none" className="stroke-sky-400" strokeWidth={1} />}
          {showSides && <path d={pathOf(curve.red, maxAbs)} fill="none" className="stroke-rose-400" strokeWidth={1} />}
          <path d={pathOf(curve.all, maxAbs)} fill="none" className="stroke-hextech-gold" strokeWidth={2} />
          {hover != null && (
            <line x1={PAD + (hover / last) * (W - 2 * PAD)} x2={PAD + (hover / last) * (W - 2 * PAD)} y1={PAD} y2={H - PAD} className="stroke-hextech-text-dim" strokeDasharray="3 3" />
          )}
        </svg>
        {hover != null && curve.all[hover] != null && (
          <div className="pointer-events-none absolute top-1 rounded border border-hextech-border bg-hextech-black/90 px-2 py-1 font-mono text-[11px] text-hextech-text-bright"
            style={{ left: `${xPct(hover)}%`, transform: 'translateX(-50%)' }}>
            {t('analyst.objectives.gold.tooltip', { min: hover, value: signedGold(curve.all[hover]!) })}
          </div>
        )}
      </div>
      <div className="mt-2 flex justify-end gap-5 font-mono text-xs">
        {marks.map((m) => (
          <span key={m} className="text-hextech-text-dim">
            {m} min <span className={curve.all[m]! >= 0 ? 'text-hextech-green' : 'text-hextech-red'}>{signedGold(curve.all[m]!)}</span>
          </span>
        ))}
      </div>
    </section>
  )
}

// ── 3. Games frieze ──────────────────────────────────────────────────────────

/** One marker shape per objective; ours filled gold, theirs outlined wr-bad (never colour alone). */
function Marker({ kind, ours }: { kind: ObjectiveKind; ours: boolean }) {
  const fill = ours ? 'fill-hextech-gold stroke-hextech-gold' : 'fill-transparent stroke-wr-bad'
  const shape = (() => {
    switch (kind) {
      case 'dragon': return <path d="M6 1 L11 6 L6 11 L1 6 Z" />
      case 'elder': return <><path d="M6 0.5 L11.5 6 L6 11.5 L0.5 6 Z" /><circle cx="6" cy="6" r="1.6" className="fill-hextech-black" /></>
      case 'grubs': return <circle cx="6" cy="6" r="3" />
      case 'herald': return <path d="M6 1.5 L11 10.5 L1 10.5 Z" />
      case 'baron': return <rect x="1.5" y="1.5" width="9" height="9" />
      case 'atakhan': return <circle cx="6" cy="6" r="4.8" />
      case 'tower': return <rect x="5" y="0.5" width="2" height="11" />
      case 'firstBlood': return <path d="M6 0.8 L7.5 4.4 L11.3 4.6 L8.3 7 L9.3 10.8 L6 8.7 L2.7 10.8 L3.7 7 L0.7 4.6 L4.5 4.4 Z" />
    }
  })()
  return <svg viewBox="0 0 12 12" className={cn('h-3 w-3', fill)} strokeWidth={1.4} aria-hidden>{shape}</svg>
}

const DRAGON_TYPES = new Set(['FIRE', 'WATER', 'EARTH', 'AIR', 'HEXTECH', 'CHEMTECH'])

function eventLabel(t: (k: string, o?: Record<string, unknown>) => string, e: TeamTimelineEvent): string {
  let name = t(`analyst.objectives.kinds.${e.kind}`)
  if (e.kind === 'dragon' && e.subType && DRAGON_TYPES.has(e.subType)) name = t(`analyst.objectives.dragonTypes.${e.subType}`)
  if (e.kind === 'tower' && e.lane) name = `${name} ${t(`analyst.objectives.lanes.${e.lane}`)}`
  if (e.kind === 'grubs' && e.count && e.count > 1) name = `${name} ×${e.count}`
  return t('analyst.objectives.frieze.event', { name, time: clock(e.atSec), who: t(e.ours ? 'analyst.objectives.frieze.byUs' : 'analyst.objectives.frieze.byThem') })
}

export function FriezeLegend() {
  const { t } = useTranslation()
  const kinds: ObjectiveKind[] = ['dragon', 'elder', 'grubs', 'herald', 'baron', 'atakhan', 'tower', 'firstBlood']
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-hextech-text-dim">
      {kinds.map((k) => <span key={k} className="flex items-center gap-1"><Marker kind={k} ours />{t(`analyst.objectives.kinds.${k}`)}</span>)}
      <span className="flex items-center gap-1"><Marker kind="dragon" ours />{t('analyst.objectives.frieze.us')}</span>
      <span className="flex items-center gap-1"><Marker kind="dragon" ours={false} />{t('analyst.objectives.frieze.them')}</span>
    </div>
  )
}

export function GamesFrieze({ games, onOpenGame, pageSize = 10 }: { games: TeamGameTimeline[]; onOpenGame?: (gameId: string) => void; pageSize?: number }) {
  const { t, i18n } = useTranslation()
  const [shown, setShown] = useState(pageSize)
  return (
    <section className={cn(analystPanel, 'space-y-3 p-4')} aria-labelledby="frieze-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="frieze-title" className="text-sm font-semibold text-hextech-text-bright">{t('analyst.objectives.frieze.title')}</h3>
        <FriezeLegend />
      </div>
      <ul className="space-y-1.5">
        {games.slice(0, shown).map((g) => (
          <li key={g.gameId}>
            <button
              type="button"
              onClick={() => onOpenGame?.(g.gameId)}
              disabled={!onOpenGame}
              className="flex w-full items-center gap-3 rounded-md p-1.5 text-left transition-colors hover:bg-hextech-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hextech-gold disabled:cursor-default"
            >
              <span className="flex w-[220px] shrink-0 flex-wrap items-center gap-1.5 text-xs">
                <span className="font-mono text-hextech-text-dim">{new Date(g.playedAt).toLocaleDateString(i18n.language, { day: '2-digit', month: 'short' })}</span>
                <span className="truncate font-medium text-hextech-text-bright">{g.opponentName ?? t('analyst.common.unknownOpponent')}</span>
                <SidePill side={g.side} />
                <ResultBadge win={g.win} />
                <span className="font-mono text-hextech-text-dim">{clock(g.durationSec)}</span>
              </span>
              <span className="relative h-6 min-w-0 flex-1 rounded bg-hextech-black/40" aria-hidden>
                {friezeTicks(g.durationSec).map((m) => (
                  <span key={m} className="absolute top-0 h-full w-px bg-hextech-border-dim" style={{ left: `${((m * 60) / g.durationSec) * 100}%` }} />
                ))}
                {g.events.map((e, i) => (
                  <span key={i} title={eventLabel(t, e)} className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ left: `${Math.min(100, (e.atSec / g.durationSec) * 100)}%` }}>
                    <Marker kind={e.kind} ours={e.ours} />
                  </span>
                ))}
              </span>
              {/* Text version of the frieze for screen readers. */}
              <span className="sr-only">{g.events.map((e) => eventLabel(t, e)).join('; ')}</span>
            </button>
          </li>
        ))}
      </ul>
      {games.length > shown && (
        <Button variant="outline" size="sm" onClick={() => setShown((n) => n + pageSize)}>{t('analyst.common.showMore')}</Button>
      )}
    </section>
  )
}

// ── 4. Mean timings ──────────────────────────────────────────────────────────

export function TimingsTable({ timings }: { timings: TeamObjectivesSummary['avgTimings'] }) {
  const { t } = useTranslation()
  return (
    <section className={cn(analystPanel, 'p-4')} aria-labelledby="timings-title">
      <h3 id="timings-title" className="mb-2 text-sm font-semibold text-hextech-text-bright">{t('analyst.objectives.timings.title')}</h3>
      <table className="w-full font-mono text-xs">
        <thead>
          <tr className="text-hextech-text-dim">
            <th scope="col" className="py-1 text-left font-normal">{t('analyst.objectives.timings.objective')}</th>
            <th scope="col" className="py-1 text-right font-normal">{t('analyst.objectives.timings.us')}</th>
            <th scope="col" className="py-1 text-right font-normal">{t('analyst.objectives.timings.them')}</th>
            <th scope="col" className="py-1 text-right font-normal">{t('analyst.objectives.timings.gap')}</th>
          </tr>
        </thead>
        <tbody>
          {timings.map((r) => (
            <tr key={r.kind} className="border-t border-hextech-border-dim/50">
              <th scope="row" className="py-1 text-left font-sans font-normal text-hextech-text">{t(`analyst.objectives.timings.kinds.${r.kind}`)}</th>
              <td className="py-1 text-right text-hextech-text-bright">{r.oursSec != null ? clock(r.oursSec) : '—'}</td>
              <td className="py-1 text-right text-hextech-text">{r.theirsSec != null ? clock(r.theirsSec) : '—'}</td>
              <td className={cn('py-1 text-right', r.oursSec != null && r.theirsSec != null && (r.oursSec <= r.theirsSec ? 'text-hextech-green' : 'text-hextech-red'))}>
                {r.oursSec != null && r.theirsSec != null ? signedClockDiff(r.oursSec, r.theirsSec) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

// ── The tab, with its states ─────────────────────────────────────────────────

export type ObjectivesState =
  | { kind: 'loading'; done: number; total: number }
  | { kind: 'error'; cause: string }
  /** `unavailable`: games left out (no timeline, no side, Riot error). An empty summary (0 games) shows the empty state. */
  | { kind: 'ready'; summary: TeamObjectivesSummary; unavailable: number }

export function ObjectivesView({ state, filters, onFiltersChange, onRetry, onWiden, onOpenPlanning, onOpenGame }: {
  state: ObjectivesState
  filters: ObjectivesFilterState
  onFiltersChange: (f: ObjectivesFilterState) => void
  onRetry?: () => void
  onWiden?: () => void
  onOpenPlanning?: () => void
  onOpenGame?: (gameId: string) => void
}) {
  const { t } = useTranslation()
  const summary = state.kind === 'ready' ? state.summary : null
  let body: ReactNode
  if (state.kind === 'loading') {
    body = (
      <div className="space-y-3">
        <SkeletonKpiTiles count={6} className="md:grid-cols-3 xl:grid-cols-6" />
        <ProgressBanner label={t('analyst.objectives.loading', { done: state.done, total: state.total })} done={state.done} total={state.total} />
      </div>
    )
  } else if (state.kind === 'error') {
    body = <ErrorState title={t('analyst.objectives.error')} cause={state.cause} onRetry={onRetry} />
  } else if (state.summary.games === 0) {
    const widen = filters.period === '7d' && onWiden
    body = (
      <EmptyState
        icon={Target}
        title={t('analyst.objectives.empty.title')}
        description={t('analyst.objectives.empty.desc')}
        // « Élargir à 30 jours » when the period is short, else « Ouvrir le Planning » (§ 10, empty state).
        action={widen ? { label: t('analyst.objectives.empty.widen'), onClick: onWiden }
          : onOpenPlanning ? { label: t('analyst.objectives.empty.planning'), onClick: onOpenPlanning, icon: CalendarDays } : undefined}
        secondaryAction={widen && onOpenPlanning ? { label: t('analyst.objectives.empty.planning'), onClick: onOpenPlanning, icon: CalendarDays } : undefined}
      />
    )
  } else {
    body = (
      <div className="space-y-4">
        {state.unavailable > 0 && <NoticeBanner tone="amber">{t('analyst.objectives.partial', { count: state.unavailable })}</NoticeBanner>}
        <ControlTiles tiles={state.summary.tiles} lowSample={state.summary.lowSample} />
        <GoldDiffChart curve={state.summary.goldCurve} side={filters.side} />
        <GamesFrieze games={state.summary.timeline} onOpenGame={onOpenGame} />
        {state.summary.avgTimings.length > 0 && <TimingsTable timings={state.summary.avgTimings} />}
      </div>
    )
  }
  return (
    <div className="space-y-4">
      <ObjectivesFilters value={filters} onChange={onFiltersChange} games={summary?.games ?? null} patch={summary?.patch ?? null} />
      {body}
    </div>
  )
}
