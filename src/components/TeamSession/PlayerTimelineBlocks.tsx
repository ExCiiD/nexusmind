import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { ChevronDown, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { Highlight, HighlightId, LaneSide, LaneSnap, ObjectiveEvent, ObjectiveLine, PlayerEvent, PlayerExtras, SessionExtras } from '@/lib/playerSessionStatsCore'
import { localGameIdOf, localGamesByMatch, needsMatchLookup } from '@/lib/vodResolve'
import { groupEvents, groupKills, mmss, participationPct, seriesRuns, summarizeEvents, vodHref, zonesOf } from '@/lib/playerSheetView'
import { eventPills } from '@/lib/ruleView'
import { RulePills } from './RuleParts'
import { Section, WhyEmpty, num, signed, tone, kfmt, useIndivView, useReason, type IndivCtx } from './PlayerIndivBlocks'

/* ── VOD: « Revoir » ── */

/** Local history (Game.matchId → Game.id), read once and kept for a minute: only needed to find a team game's recording. */
let historyCache: { at: number; map: Promise<Map<string, string>> } | null = null
function localHistoryByMatch(): Promise<Map<string, string>> {
  if (!historyCache || Date.now() - historyCache.at > 60_000) {
    const get = window.api?.getGameHistory
    historyCache = { at: Date.now(), map: (get ? get(5000) : Promise.resolve([])).then((rows) => localGamesByMatch(rows ?? [])).catch(() => new Map<string, string>()) }
  }
  return historyCache.map
}

/**
 * Recording id of each sheet game (local library), null when the game has no recording on this PC: the button then says why.
 * Team games go through their Riot match id (src/lib/vodResolve.ts), solo games are already local games.
 */
export function useRecordings(gameIds: string[], matchIdOf?: Record<string, string>): Record<string, string | null> {
  const key = [...new Set(gameIds)].sort().join('|')
  const [map, setMap] = useState<Record<string, string | null>>({})
  useEffect(() => {
    let alive = true
    const ids = key ? key.split('|') : []
    const get = window.api?.getRecording
    if (!get) { setMap(Object.fromEntries(ids.map((id) => [id, null]))); return }
    void (async () => {
      const byMatch = needsMatchLookup(ids, matchIdOf) ? await localHistoryByMatch() : null
      const rows = await Promise.all(ids.map(async (id) => {
        const local = localGameIdOf(id, matchIdOf, byMatch)
        return [id, local ? (await get(local).catch(() => null))?.id ?? null : null] as const
      }))
      if (alive) setMap(Object.fromEntries(rows))
    })()
    return () => { alive = false }
  }, [key, matchIdOf])
  return map
}

export function ReviewButton({ recordingId, seekSec, clock, game }: { recordingId: string | null | undefined; seekSec: number; clock: string; game: number }) {
  const { t } = useTranslation()
  const label = t('playerSheet.reviewAria', { clock, n: game })
  if (!recordingId) {
    return <Button size="sm" variant="outline" disabled title={t('playerSheet.noVod')} aria-label={`${label} — ${t('playerSheet.noVod')}`} className="h-6 px-2 text-[11px]">{t('playerSheet.review')}</Button>
  }
  return (
    <Button asChild size="sm" variant="outline" className="h-6 px-2 text-[11px]">
      <Link to={vodHref(recordingId, seekSec)} aria-label={label}>{t('playerSheet.review')}</Link>
    </Button>
  )
}

/* ── Deaths and kills of the timeline ── */

function EventRow({ e, kind, recordingId, showGame }: { e: PlayerEvent; kind: 'death' | 'kill'; recordingId: string | null | undefined; showGame: boolean }) {
  const { t } = useTranslation()
  const who = e.otherChampion
    ? t(kind === 'death' ? 'playerSheet.killedBy' : 'playerSheet.victim', { champion: e.otherChampion })
    : t('playerSheet.executed')
  return (
    <li className="flex min-h-[34px] flex-wrap items-center gap-x-3 gap-y-1 py-1 text-xs">
      <span className="w-12 font-mono tabular-nums text-hextech-text-bright">{e.clock}</span>
      {showGame && <span className="font-mono text-[11px] text-hextech-gold">G{e.gameIndex}</span>}
      <span className="text-hextech-text">{e.zone ? t(`playerSheet.zone.${e.zone}`) : t('playerSheet.zoneUnknown')}</span>
      <span className="text-hextech-text-dim">{who}{e.assisters > 0 ? ` · ${t('playerSheet.assisters', { count: e.assisters })}` : ''}</span>
      {e.isolated === true && <span className="rounded bg-hextech-red/15 px-1.5 font-mono text-[10px] font-bold uppercase text-hextech-red">{t('playerSheet.isolatedBadge')}</span>}
      {e.isolated === null && <span className="rounded bg-hextech-elevated px-1.5 font-mono text-[10px] uppercase text-hextech-text-dim">{t('playerSheet.positionUnknown')}</span>}
      <span className="ml-auto"><ReviewButton recordingId={recordingId} seekSec={e.vodSeekSec} clock={e.clock} game={e.gameIndex} /></span>
    </li>
  )
}

function EventList({ title, events, kind, rec, showGame, note }: { title: string; events: PlayerEvent[]; kind: 'death' | 'kill'; rec: Record<string, string | null>; showGame: boolean; note?: string }) {
  const { t } = useTranslation()
  return (
    <div className="space-y-1">
      <h4 className="flex items-baseline gap-2 text-[11px] font-semibold uppercase tracking-wider text-hextech-text-dim">
        {title}<span className="font-mono text-hextech-text-bright">{events.length}</span>
      </h4>
      {events.length === 0
        ? <p className="text-xs text-hextech-text-dim">{t('playerSheet.noneListed')}</p>
        : <ul className="divide-y divide-hextech-border-dim/60" aria-label={title}>{events.map((e) => <EventRow key={`${e.gameId}-${e.atSec}`} e={e} kind={kind} recordingId={rec[e.gameId]} showGame={showGame} />)}</ul>}
      {note && <p className="text-[11px] text-hextech-text-dim">{note}</p>}
    </div>
  )
}

/** Deaths before 14:00, isolated deaths after, isolated kills — each with its clock, zone, killer and a « Review » button. */
export function EventsBlock(ctx: IndivCtx) {
  const { t } = useTranslation()
  const { single, g, tot } = useIndivView(ctx)
  const reason = useReason(ctx)
  const deathEvents = (single ? g?.deathEvents : ctx.indiv?.deathEvents) ?? null
  const killEvents = (single ? g?.killEvents : ctx.indiv?.killEvents) ?? null
  const deaths = useMemo(() => groupEvents(deathEvents), [deathEvents])
  const kills = useMemo(() => groupKills(killEvents), [killEvents])
  const rec = useRecordings([...(deathEvents ?? []), ...(killEvents ?? [])].map((e) => e.gameId), ctx.gameMatchIds)
  const summary = single ? summarizeEvents(deathEvents) : tot?.deaths ?? summarizeEvents(deathEvents)
  const zones = zonesOf(summary)
  return (
    <Section title={t('playerSheet.eventsTitle')}>
      {!deaths || !kills ? (
        <WhyEmpty text={reason?.text ?? t('playerSheet.noEvents')} />
      ) : (
        <div className="space-y-4">
          <EventList title={t('playerSheet.deathsEarlyTitle')} events={deaths.early} kind="death" rec={rec} showGame={!single} />
          <EventList title={t('playerSheet.deathsLateTitle')} events={deaths.isolatedLate} kind="death" rec={rec} showGame={!single}
            note={deaths.unknownLate.length > 0 ? t('playerSheet.unknownLate', { count: deaths.unknownLate.length }) : undefined} />
          <EventList title={t('playerSheet.killsIsolatedTitle')} events={kills.isolated} kind="kill" rec={rec} showGame={!single}
            note={kills.unknown.length > 0 ? t('playerSheet.unknownKills', { count: kills.unknown.length }) : undefined} />
          {zones.length > 0 && (
            <p className="text-[11px] text-hextech-text-dim">
              <span className="font-semibold uppercase tracking-wider">{t('playerSheet.deathZones')}</span>{' '}
              {zones.map(([z, n]) => `${t(`playerSheet.zone.${z}`)} ×${n}`).join(' · ')}
            </p>
          )}
        </div>
      )}
    </Section>
  )
}

/* ── Gaps against the lane opponent: per-minute curve and @10 / @15 ── */

type DiffKey = 'gold' | 'xp' | 'cs'
const DIFF_KEYS: DiffKey[] = ['gold', 'xp', 'cs']
const W = 520, H = 170, PAD = { l: 44, r: 10, t: 12, b: 24 }

function DiffChart({ values, label }: { values: Array<number | null>; label: string }) {
  const { t } = useTranslation()
  const runs = seriesRuns(values)
  const known = runs.flat()
  if (known.length === 0) return <p className="text-xs text-hextech-text-dim">{t('playerSheet.diffNoData')}</p>
  const maxAbs = Math.max(...known.map((p) => Math.abs(p.value)), 1)
  const last = Math.max(values.length - 1, 1)
  const x = (m: number) => PAD.l + (m / last) * (W - PAD.l - PAD.r)
  const y = (v: number) => PAD.t + (1 - (v + maxAbs) / (2 * maxAbs)) * (H - PAD.t - PAD.b)
  const at = (m: number) => (m < values.length ? values[m] : null)
  const summary = t('playerSheet.diffChartAria', { metric: label, count: known.length, min: Math.min(...known.map((p) => p.value)).toFixed(0), max: Math.max(...known.map((p) => p.value)).toFixed(0), at10: num(at(10)), at15: num(at(15)) })
  const ticks = Array.from({ length: Math.floor(last / 5) + 1 }, (_, i) => i * 5)
  return (
    <div className="space-y-2">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary} tabIndex={0}
        className="w-full rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hextech-gold">
        <line x1={PAD.l} x2={W - PAD.r} y1={y(0)} y2={y(0)} stroke="rgba(255,255,255,0.35)" />
        <text x={PAD.l - 6} y={y(0)} textAnchor="end" dominantBaseline="middle" className="fill-hextech-text-dim font-mono text-[9px]">0</text>
        <text x={PAD.l - 6} y={y(maxAbs)} textAnchor="end" dominantBaseline="middle" className="fill-hextech-text-dim font-mono text-[9px]">+{Math.round(maxAbs)}</text>
        <text x={PAD.l - 6} y={y(-maxAbs)} textAnchor="end" dominantBaseline="middle" className="fill-hextech-text-dim font-mono text-[9px]">−{Math.round(maxAbs)}</text>
        {[10, 15].filter((m) => m <= last).map((m) => <line key={m} x1={x(m)} x2={x(m)} y1={PAD.t} y2={H - PAD.b} stroke="rgba(212,162,76,0.5)" strokeDasharray="3 3" />)}
        {ticks.map((m) => <text key={m} x={x(m)} y={H - 8} textAnchor="middle" className="fill-hextech-text-dim font-mono text-[9px]">{m}′</text>)}
        {runs.map((run, i) => run.length === 1
          ? <circle key={i} cx={x(run[0].minute)} cy={y(run[0].value)} r={2.5} fill="#D4A24C" />
          : <polyline key={i} fill="none" stroke="#D4A24C" strokeWidth={2} strokeLinejoin="round" points={run.map((p) => `${x(p.minute).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')} />)}
      </svg>
      <details className="text-xs">
        <summary className="cursor-pointer rounded text-hextech-text-dim hover:text-hextech-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hextech-gold">{t('playerSheet.diffTable')}</summary>
        <div className="mt-2">
          <table className="w-full">
            <thead className="text-[10px] uppercase tracking-wider text-hextech-text-dim">
              <tr><th scope="col" className="px-2 py-1 text-left font-semibold">{t('playerSheet.minute')}</th><th scope="col" className="px-2 py-1 text-right font-semibold">{label}</th></tr>
            </thead>
            <tbody className="divide-y divide-hextech-border-dim/40">
              {values.map((v, m) => (
                <tr key={m}><th scope="row" className="px-2 py-1 text-left font-mono font-normal text-hextech-text">{m}′</th><td className={cn('px-2 py-1 text-right font-mono tabular-nums', tone(v))}>{signed(v, (n) => String(Math.round(n)))}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}

function LaneTable({ at10, at15 }: { at10: LaneSnap; at15: LaneSnap }) {
  const { t } = useTranslation()
  const rows: Array<{ k: keyof LaneSide; label: string }> = [
    { k: 'cs', label: 'CS' }, { k: 'gold', label: t('playerSheet.diff.gold') }, { k: 'xp', label: 'XP' }, { k: 'level', label: t('playerSheet.level') },
  ]
  const cells = (s: LaneSnap, k: keyof LaneSide, key: string) => [
    <td key={`${key}p`} className="px-2 text-right font-mono tabular-nums text-hextech-text-bright">{k === 'gold' ? kfmt(s.player[k]) : num(s.player[k])}</td>,
    <td key={`${key}o`} className="px-2 text-right font-mono tabular-nums">{s.opponent ? (k === 'gold' ? kfmt(s.opponent[k]) : num(s.opponent[k])) : '—'}</td>,
    <td key={`${key}d`} className={cn('px-2 text-right font-mono tabular-nums', tone(s.diff?.[k] ?? null))}>{signed(s.diff?.[k] ?? null, (n) => String(Math.round(n)))}</td>,
  ]
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs text-hextech-text">
        <thead className="text-[10px] uppercase tracking-wider text-hextech-text-dim">
          <tr>
            <th scope="col" rowSpan={2} className="px-2 py-1.5 text-left font-semibold">{t('playerSheet.metric')}</th>
            <th scope="colgroup" colSpan={3} className="px-2 py-1 text-center font-semibold text-hextech-gold">@10</th>
            <th scope="colgroup" colSpan={3} className="px-2 py-1 text-center font-semibold text-hextech-gold">@15</th>
          </tr>
          <tr>
            {['10', '15'].flatMap((m) => [t('playerSheet.laneYou'), t('playerSheet.laneOpp'), t('playerSheet.gap')].map((h, i) => <th key={`${m}${i}`} scope="col" className="px-2 py-1 text-right font-semibold">{h}</th>))}
          </tr>
        </thead>
        <tbody className="divide-y divide-hextech-border-dim">
          {rows.map((r) => (
            <tr key={r.k} className="h-8"><th scope="row" className="px-2 text-left font-medium">{r.label}</th>{cells(at10, r.k, '10')}{cells(at15, r.k, '15')}</tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function LaneDiffBlock(ctx: IndivCtx) {
  const { t } = useTranslation()
  const { single, g, tot } = useIndivView(ctx)
  const reason = useReason(ctx)
  const [key, setKey] = useState<DiffKey>('gold')
  const series = (single ? g?.diffSeries : tot?.diffSeries) ?? null
  const lane = (single ? g?.laneSummary : tot?.laneSummary) ?? null
  const label = t(`playerSheet.diff.${key}`)
  return (
    <Section title={t('playerSheet.diffTitle')}
      right={series && (
        <div role="radiogroup" aria-label={t('playerSheet.metric')} className="inline-flex gap-1 rounded-md border border-hextech-border-dim bg-hextech-dark p-0.5">
          {DIFF_KEYS.map((k) => (
            <button key={k} type="button" role="radio" aria-checked={k === key} onClick={() => setKey(k)}
              className={cn('rounded px-2 py-0.5 font-mono text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hextech-gold', k === key ? 'bg-hextech-gold text-hextech-black' : 'text-hextech-text hover:bg-hextech-elevated')}>{t(`playerSheet.diff.${k}`)}</button>
          ))}
        </div>
      )}>
      {series ? <DiffChart values={series[key]} label={label} />
        : <WhyEmpty text={reason?.text ?? t('playerSheet.diffNoSeries')} />}
      {lane
        ? (
          <>
            <LaneTable at10={lane.at10} at15={lane.at15} />
            <p className="text-[11px] text-hextech-text-dim">{t(`playerSheet.laneSource.${lane.source}`)}{!single && ` · ${t('playerSheet.meanNote')}`}</p>
          </>
        )
        : series ? <WhyEmpty text={t('playerSheet.noLane')} /> : null}
    </Section>
  )
}

/* ── Objectives ── */

function ObjectiveRow({ line, active, onToggle }: { line: ObjectiveLine; active: boolean; onToggle: () => void }) {
  const { t } = useTranslation()
  const pct = participationPct(line)
  return (
    <tr className={cn('h-8', active && 'bg-hextech-gold/10')}>
      <th scope="row" className="px-1 text-left font-medium">
        <button type="button" onClick={onToggle} aria-pressed={active} title={t(active ? 'playerSheet.objFilterClear' : 'playerSheet.objFilterHint')}
          className={cn('w-full rounded px-1 py-1 text-left hover:text-hextech-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hextech-gold', active && 'text-hextech-gold')}>
          {t(`playerSheet.obj.${line.kind}`)}
        </button>
      </th>
      <td className="border-l border-hextech-border-dim px-2 text-right font-mono tabular-nums text-hextech-text-bright">{line.participated}{pct != null && <span className="ml-1 text-hextech-text-dim">({pct} %)</span>}</td>
      <td className="px-2 text-right font-mono tabular-nums">{line.ours - line.participated}</td>
      {line.theirsPresent == null
        ? <td colSpan={2} className="border-l border-hextech-border-dim px-2 text-right font-mono tabular-nums text-hextech-text-dim" title={t('playerSheet.objNoPit')}>{line.theirs}<span className="ml-1 text-[10px]">· {t('playerSheet.objNoPitShort')}</span></td>
        : (
          <>
            <td className="border-l border-hextech-border-dim px-2 text-right font-mono tabular-nums text-hextech-text-dim">{line.theirsPresent}</td>
            <td className="px-2 text-right font-mono tabular-nums text-hextech-text-dim">{line.theirs - line.theirsPresent}</td>
          </>
        )}
    </tr>
  )
}

const OBJECTIVE_EVENTS_COLLAPSED = 5

export function ObjectivesBlock(ctx: IndivCtx) {
  const { t } = useTranslation()
  const { single, g, tot } = useIndivView(ctx)
  const reason = useReason(ctx)
  const lines = (single ? g?.objectives?.byKind : tot?.objectives) ?? null
  const events = useMemo(() => {
    const games = single ? (g ? [g] : []) : ctx.indiv?.games ?? []
    return games.flatMap((x) => (x.objectives?.events ?? []).map((e) => ({ e, gameId: x.gameId, gameIndex: x.gameIndex })))
  }, [single, g, ctx.indiv])
  const rec = useRecordings(events.map((x) => x.gameId), ctx.gameMatchIds)
  const taken = lines?.some((l) => l.ours + l.theirs > 0)
  // The event list can run to dozens of lines over a session: a few rows by default, a button for the rest.
  const [showAll, setShowAll] = useState(false)
  // Clicking a row of the table filters the list to that objective; clicking it again (or the chip's ×) clears it.
  const [kindFilter, setKindFilter] = useState<ObjectiveLine['kind'] | null>(null)
  const visible = useMemo(() => (kindFilter ? events.filter((x) => x.e.kind === kindFilter) : events), [events, kindFilter])
  const shown = showAll ? visible : visible.slice(0, OBJECTIVE_EVENTS_COLLAPSED)
  return (
    <Section title={t('playerSheet.objectivesTitle')}>
      {!lines ? <WhyEmpty text={reason?.text ?? t('playerSheet.noObjectives')} />
        : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-hextech-text">
                <thead className="text-[10px] uppercase tracking-wider text-hextech-text-dim">
                  <tr>
                    <th scope="col" rowSpan={2} className="px-2 py-1.5 text-left font-semibold">{t('playerSheet.metric')}</th>
                    <th scope="colgroup" colSpan={2} className="border-l border-hextech-border-dim px-2 py-1 text-center font-semibold text-hextech-green">{t('playerSheet.objOursGroup')}</th>
                    <th scope="colgroup" colSpan={2} className="border-l border-hextech-border-dim px-2 py-1 text-center font-semibold text-hextech-red">{t('playerSheet.objTheirsGroup')}</th>
                  </tr>
                  <tr>
                    <th scope="col" className="border-l border-hextech-border-dim px-2 py-1 text-right font-semibold">{t('playerSheet.objWithYou')}</th>
                    <th scope="col" className="px-2 py-1 text-right font-semibold">{t('playerSheet.objWithoutYou')}</th>
                    <th scope="col" className="border-l border-hextech-border-dim px-2 py-1 text-right font-semibold">{t('playerSheet.objYouAround')}</th>
                    <th scope="col" className="px-2 py-1 text-right font-semibold">{t('playerSheet.objYouAbsent')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-hextech-border-dim">{lines.map((l) => <ObjectiveRow key={l.kind} line={l} active={kindFilter === l.kind} onToggle={() => { setKindFilter((k) => (k === l.kind ? null : l.kind)); setShowAll(false) }} />)}</tbody>
              </table>
            </div>
            {!single && <p className="text-[11px] text-hextech-text-dim">{t('playerSheet.objDenom', { count: tot?.gamesWithObjectives ?? 0 })}</p>}
            {!taken && <p className="text-xs text-hextech-text-dim">{t('playerSheet.objNone')}</p>}
            {kindFilter && (
              <button type="button" onClick={() => setKindFilter(null)} aria-label={t('playerSheet.objFilterClear')}
                className="inline-flex items-center gap-1 rounded-full border border-hextech-gold/50 bg-hextech-gold/10 px-2.5 py-0.5 text-[11px] text-hextech-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hextech-gold">
                {t(`playerSheet.obj.${kindFilter}`)} · {visible.length}<X className="h-3 w-3" aria-hidden />
              </button>
            )}
            {kindFilter && visible.length === 0 && <p className="text-xs text-hextech-text-dim">{t('playerSheet.objFilterNone')}</p>}
            {visible.length > 0 && (
              <ul className="divide-y divide-hextech-border-dim/60" aria-label={t('playerSheet.objEvents')}>
                {shown.map(({ e, gameId, gameIndex }) => <ObjectiveEventRow key={`${gameId}-${e.kind}-${e.atSec}`} e={e} role={ctx.role} gameIndex={gameIndex} recordingId={rec[gameId]} showGame={!single} />)}
              </ul>
            )}
            {visible.length > OBJECTIVE_EVENTS_COLLAPSED && (
              <Button type="button" size="sm" variant="outline" className="w-full gap-1.5" aria-expanded={showAll} onClick={() => setShowAll((v) => !v)}>
                <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', showAll && 'rotate-180')} aria-hidden />
                {showAll ? t('playerSheet.objShowLess') : t('playerSheet.objShowAll', { count: visible.length })}
              </Button>
            )}
          </>
        )}
    </Section>
  )
}

function ObjectiveEventRow({ e, role, gameIndex, recordingId, showGame }: { e: ObjectiveEvent; role: string; gameIndex: number; recordingId: string | null | undefined; showGame: boolean }) {
  const { t } = useTranslation()
  const why = e.reason ? ` (${t(`playerSheet.objReason.${e.reason}`)})` : ''
  const noPit = e.kind === 'tower'
  const who = e.ours
    ? (e.involved ? `${t('playerSheet.objOursWith')}${why}` : t('playerSheet.objOursNotIn'))
    : noPit ? t('playerSheet.objTheirsTook') : e.involved ? `${t('playerSheet.objTheirsAround')}${why}` : t('playerSheet.objTheirsAbsent')
  return (
    <li className="flex min-h-[34px] flex-wrap items-center gap-x-3 gap-y-1 py-1 text-xs">
      <span className="w-12 font-mono tabular-nums text-hextech-text-bright">{e.clock}</span>
      {showGame && <span className="font-mono text-[11px] text-hextech-gold">G{gameIndex}</span>}
      <span className="text-hextech-text">{t(`playerSheet.obj.${e.kind}`)}{e.subType ? ` · ${e.subType}` : ''}{e.lane ? ` · ${e.lane}` : ''}</span>
      <span className={cn(e.ours && e.involved ? 'text-hextech-green' : e.ours ? 'text-hextech-text-dim' : 'text-hextech-red/80')}>{who}</span>
      <span className="ml-auto flex items-center gap-2"><RulePills {...eventPills(e, role)} /><ReviewButton recordingId={recordingId} seekSec={e.vodSeekSec} clock={e.clock} game={gameIndex} /></span>
    </li>
  )
}

/* ── Strengths / to work on ── */

const HL_DIGITS: Record<HighlightId, number> = {
  csPerMin: 1, goldPerMin: 0, damagePerMin: 0, xpPerMin: 0, kda: 2, deaths: 1, kpPct: 0, visionScore: 1,
  goldDiff15: 0, csDiff15: 0, deathsBefore14: 0, isolatedDeaths: 0,
}
const HL_SIGNED: ReadonlySet<HighlightId> = new Set<HighlightId>(['goldDiff15', 'csDiff15'])

function HighlightItem({ h, good }: { h: Highlight; good: boolean }) {
  const { t } = useTranslation()
  const d = HL_DIGITS[h.id]
  const value = HL_SIGNED.has(h.id) ? signed(h.value, (n) => n.toFixed(d)) : `${h.value.toFixed(d)}${h.id === 'kpPct' ? ' %' : ''}`
  const delta = h.deltaPct == null ? null : `${h.deltaPct > 0 ? '+' : h.deltaPct < 0 ? '−' : '±'}${Math.abs(h.deltaPct).toFixed(0)} %`
  return (
    <li className="flex items-baseline justify-between gap-3 rounded-md border border-hextech-border-dim bg-hextech-black/40 px-3 py-2 text-xs">
      <span className="text-hextech-text">{t(`playerSheet.highlight.${h.id}`)}</span>
      <span className="text-right font-mono tabular-nums">
        <span className={good ? 'text-hextech-green' : 'text-hextech-red'}>{value}</span>
        {delta && <span className="ml-2 text-hextech-text-dim">{delta} {t(`playerSheet.refSource.${h.referenceSource}`)}</span>}
      </span>
    </li>
  )
}

export function HighlightsBlock(ctx: IndivCtx) {
  const { t } = useTranslation()
  const { single, g } = useIndivView(ctx)
  const reason = useReason(ctx)
  const hl = (single ? g?.highlights : ctx.indiv?.highlights) ?? null
  const ref = hl && [...hl.strengths, ...hl.weaknesses].some((h) => h.referenceSource === '30d')
  return (
    <Section title={t('playerSheet.highlightsTitle')}>
      {!hl ? <WhyEmpty text={reason?.text ?? t('playerSheet.noHighlights')} />
        : (
          <>
            <div className="grid gap-3 md:grid-cols-2">
              {([['strengths', hl.strengths, true], ['weaknesses', hl.weaknesses, false]] as const).map(([k, list, good]) => (
                <div key={k} className="space-y-1.5">
                  <h4 className={cn('text-[11px] font-semibold uppercase tracking-wider', good ? 'text-hextech-green' : 'text-hextech-red')}>{t(`playerSheet.${k}`)}</h4>
                  {list.length === 0 ? <p className="text-xs text-hextech-text-dim">{t('playerSheet.nothingMarked')}</p> : <ul className="space-y-1.5">{list.map((h) => <HighlightItem key={h.id} h={h} good={good} />)}</ul>}
                </div>
              ))}
            </div>
            <p className="text-[11px] text-hextech-text-dim">{t(ref ? 'playerSheet.highlightsNote30d' : 'playerSheet.highlightsNoteLane')}</p>
          </>
        )}
    </Section>
  )
}

/* ── Other match figures ── */

type ExtraKey = Exclude<keyof PlayerExtras, 'firstBloodInvolved'> | 'firstBloodShare'

export function ExtrasBlock(ctx: IndivCtx & { note?: string }) {
  const { t } = useTranslation()
  const { single, g, tot } = useIndivView(ctx)
  const reason = useReason(ctx)
  const ex: (PlayerExtras | SessionExtras) | null = (single ? g?.extras : tot?.extras) ?? null
  const get = (k: ExtraKey): number | null => {
    if (!ex) return null
    if (k === 'firstBloodShare') return 'firstBloodShare' in ex ? ex.firstBloodShare : null
    return ex[k]
  }
  const fmtInt = (n: number | null) => (n == null ? null : String(Math.round(n)))
  const items: Array<[ExtraKey, string | null]> = [
    ['soloKills', fmtInt(get('soloKills'))],
    single ? ['firstBloodShare', ex && 'firstBloodInvolved' in ex && ex.firstBloodInvolved != null ? t(ex.firstBloodInvolved ? 'playerSheet.yes' : 'playerSheet.no') : null]
      : ['firstBloodShare', get('firstBloodShare') == null ? null : `${Math.round(get('firstBloodShare')! * 100)} %`],
    ['largestMultiKill', fmtInt(get('largestMultiKill'))], ['doubleKills', fmtInt(get('doubleKills'))], ['tripleKills', fmtInt(get('tripleKills'))],
    ['quadraKills', fmtInt(get('quadraKills'))], ['pentaKills', fmtInt(get('pentaKills'))], ['killingSprees', fmtInt(get('killingSprees'))],
    ['timeDeadSec', get('timeDeadSec') == null ? null : `${mmss(get('timeDeadSec'))}${get('timeDeadPct') == null ? '' : ` (${get('timeDeadPct')!.toFixed(0)} %)`}`],
    ['damageToObjectives', get('damageToObjectives') == null ? null : kfmt(get('damageToObjectives'))],
    ['damageToTurrets', get('damageToTurrets') == null ? null : kfmt(get('damageToTurrets'))],
    ['damageMitigated', get('damageMitigated') == null ? null : kfmt(get('damageMitigated'))],
    ['healAndShield', get('healAndShield') == null ? null : kfmt(get('healAndShield'))],
    ['objectivesStolen', fmtInt(get('objectivesStolen'))], ['visionPerMin', get('visionPerMin') == null ? null : get('visionPerMin')!.toFixed(2)],
  ]
  const shown = items.filter(([, v]) => v != null) as Array<[ExtraKey, string]>
  return (
    <Section title={t('playerSheet.extrasTitle')}>
      {shown.length === 0
        ? <WhyEmpty text={ex ? t('playerSheet.noExtras') : reason?.text ?? t('playerSheet.noExtras')} />
        : (
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
            {shown.map(([k, v]) => (
              <div key={k} className="rounded-md border border-hextech-border-dim bg-hextech-black/40 px-3 py-2">
                <dt className="text-[10px] font-semibold uppercase tracking-wider text-hextech-text-dim">{t(`playerSheet.extra.${k}`)}</dt>
                <dd className="mt-0.5 font-mono text-base tabular-nums text-hextech-text-bright">{v}</dd>
              </div>
            ))}
          </dl>
        )}
      {!single && shown.length > 0 && <p className="text-[11px] text-hextech-text-dim">{ctx.note ?? t('playerSheet.extrasNote')}</p>}
    </Section>
  )
}
