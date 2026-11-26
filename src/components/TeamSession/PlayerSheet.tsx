import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { PlayerStatsSheet, SheetGamePoint } from '@/lib/playerStatsSheetCore'
import type { SynergyPlayerStats } from '@/lib/synergyStats'
import { formatClock } from '@/lib/teamSessionHistoryView'
import { IsolationBlock, RadarBlock, VsOpponentBlock, VsTeamBlock, WhyEmpty, type IndivState } from './PlayerIndivBlocks'
import { EventsBlock, ExtrasBlock, HighlightsBlock, LaneDiffBlock, ObjectivesBlock } from './PlayerTimelineBlocks'
import type { Baseline30d, LaneSummary } from '@/lib/playerSessionStatsCore'
import type { PlayerSessionStats } from '@/pages/TeamSessions/historyContract'

type Averages = SynergyPlayerStats['averages']
type Missing = PlayerStatsSheet['missing'][number]

const panel = 'rounded-lg border border-hextech-border-dim bg-hextech-dark/50 p-4'
const num = (v: number | null | undefined, d = 0) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(d))
const gname = (p: SheetGamePoint) => `G${p.index}`
const signedNum = (v: number, d = 0) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(d)}`
const tone = (good: boolean | null) => (good == null ? 'text-hextech-text-dim' : good ? 'text-hextech-green' : 'text-hextech-red')
/** Better = higher, except for deaths. `null` when equal or unknown. */
const better = (diff: number | null, lowerIsBetter = false): boolean | null => (diff == null || diff === 0 ? null : lowerIsBetter ? diff < 0 : diff > 0)

interface TileDef {
  key: string
  label: string
  /** Hidden when the sheet's `missing` has it (solo). */
  needs?: Missing
  value: (a: Averages, s: SynergyPlayerStats) => number
  digits: number
  suffix?: string
  /** Footer: against the lane opponent, or against the team's mean. */
  vs?: 'lane' | 'team'
  lowerIsBetter?: boolean
  /** The same figure in the 30-day average (Baseline30d). */
  avg30?: keyof Baseline30d
}

/**
 * The player sheet body (docs/DESIGN_STATE.md § 24): state banners, the KPI tiles, the lane matchup and the
 * « game by game » / « this game » panel. Pure display of a PlayerStatsSheet (src/lib/playerStatsSheetCore.ts, team and solo):
 * nothing is recomputed, a null stays « — » and is never drawn as 0. The breadcrumb, header and game filter belong to the page.
 */
export function PlayerSheet({ sheet, name, role, teamPlayers, indiv, indivState, onExtract, extracting, onPickGame, onFetch, fetching, gameMatchIds }: {
  sheet: PlayerStatsSheet
  name: string
  role: string
  /** Team sessions: every player of the picked scope, for the « vs team » footers. Empty for solo. */
  teamPlayers: SynergyPlayerStats[]
  /** Timeline-based figures (isolation, gaps, radar…) of this player; null while unknown. */
  indiv: PlayerSessionStats | null
  indivState: IndivState
  /** Extracts the missing timelines (Riot calls), then reloads. */
  onExtract?: () => void
  extracting?: boolean
  onPickGame: (index: number) => void
  /** Offers to fetch the games whose match is not cached (team sessions). */
  onFetch?: () => void
  fetching?: boolean
  /** Team sessions: team game id → Riot match id (for the « Review » buttons). */
  gameMatchIds?: Record<string, string>
}) {
  const { t } = useTranslation()
  const single = sheet.gameIndex != null
  const line = sheet.line
  const hidden = (k?: Missing) => !!k && sheet.missing.includes(k)

  if (sheet.status === 'no-data' || sheet.status === 'unknown-game' || (sheet.status === 'ready' && !sheet.playerFound)) {
    const absent = single && sheet.status === 'ready'
    return (
      <div role="status" className={cn(panel, 'flex flex-wrap items-center justify-between gap-3')}>
        <div className="flex items-center gap-3">
          <span aria-hidden className="flex h-8 w-8 items-center justify-center rounded-full border border-hextech-gold/60 font-mono text-hextech-gold">∅</span>
          <div>
            <p className="text-sm font-semibold text-hextech-text-bright">{absent ? t('playerSheet.absentGame', { name, n: sheet.gameIndex }) : t('playerSheet.emptyTitle', { name })}</p>
            <p className="text-xs text-hextech-text-dim">{sheet.source === 'solo' && indiv?.unavailableGames.length ? indiv.unavailableGames.map((u) => t(`playerSheet.unavail.${u.reason}`, { n: u.gameIndex })).join(' ') : t('playerSheet.emptyBody')}</p>
          </div>
        </div>
      </div>
    )
  }

  const notReady = sheet.series.filter((p) => p.status !== 'ready' && (!single || p.index === sheet.gameIndex))
  const fetchable = notReady.filter((p) => p.status === 'not-fetched')
  const games = (list: SheetGamePoint[]) => list.map(gname).join(', ')

  const enemy = sheet.duel?.enemy ?? null
  const others = teamPlayers
  const mean = (pick: (p: SynergyPlayerStats) => number) => (others.length ? others.reduce((n, p) => n + pick(p), 0) / others.length : null)
  const baseTiles: TileDef[] = [
    { key: 'kda', avg30: 'kda', label: t('playerSheet.kda'), value: (x) => x.kda, digits: 2, vs: 'team' },
    { key: 'cs', avg30: 'csPerMin', label: t('playerSheet.csMin'), value: (x) => x.csPerMin, digits: 1, vs: 'lane' },
    { key: 'gold', avg30: 'goldPerMin', label: t('playerSheet.goldMin'), needs: 'goldPerMin', value: (x) => x.goldPerMin, digits: 0, vs: 'lane' },
    { key: 'dmg', avg30: 'damagePerMin', label: t('playerSheet.dmgMin'), needs: 'damagePerMin', value: (x) => x.damagePerMin, digits: 0, vs: 'lane' },
    { key: 'vision', avg30: 'visionScore', label: t('playerSheet.vision'), value: (x) => x.visionScore, digits: 1, vs: 'lane' },
    { key: 'share', avg30: 'damagePct', label: t('playerSheet.dmgShare'), needs: 'shares', value: (_x, s) => s.shares.damagePct, digits: 0, suffix: ' %', vs: 'team' },
    { key: 'kp', avg30: 'kpPct', label: t('playerSheet.kp'), needs: 'shares', value: (_x, s) => s.shares.kpPct, digits: 0, suffix: ' %', vs: 'team' },
    // Solo sessions have no team to compare to: deaths per game stands in for the share / KP tiles.
    ...(sheet.partial ? [{ key: 'deaths', avg30: 'deaths', label: t(single ? 'playerSheet.deaths' : 'playerSheet.deathsPerGame'), value: (x: Averages) => x.deaths, digits: 1, lowerIsBetter: true } satisfies TileDef] : []),
  ]
  const TILES = baseTiles.filter((d) => !hidden(d.needs))

  const footer = (d: TileDef): { text: string; good: boolean | null } | null => {
    if (!line || !d.vs) return null
    const mine = d.value(line.averages, line)
    const ref = d.vs === 'lane' ? (enemy ? d.value(enemy.averages, enemy) : null) : mean((p) => d.value(p.averages, p))
    if (ref == null) return null
    const diff = mine - ref
    const isSupportVision = d.key === 'vision' && role === 'SUPPORT'
    const text = t(d.vs === 'lane' ? 'playerSheet.vsLane' : d.suffix ? 'playerSheet.vsTeamPts' : 'playerSheet.vsTeam', { v: signedNum(diff, d.digits) })
    return { text, good: isSupportVision ? null : better(Math.abs(diff) < 10 ** -(d.digits + 1) ? 0 : diff, d.lowerIsBetter) }
  }

  const avg30d = indiv?.avg30d ?? null
  const footer30 = (d: TileDef): { text: string; good: boolean | null } | null => {
    if (!line || !avg30d || !d.avg30) return null
    const ref = avg30d[d.avg30]
    if (typeof ref !== 'number') return null
    const mine = d.value(line.averages, line)
    const diff = mine - ref
    const text = t('playerSheet.vs30d', { v: signedNum(diff, d.digits) + (d.suffix ? ' pts' : '') })
    return { text, good: better(Math.abs(diff) < 10 ** -(d.digits + 1) ? 0 : diff, d.lowerIsBetter) }
  }
  const unavailable = sheet.source === 'solo' ? indiv?.unavailableGames ?? [] : []

  return (
    <div className="space-y-4">
      {notReady.length > 0 && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-hextech-gold/30 bg-hextech-gold/10 p-3">
          <div className="flex items-start gap-2.5">
            <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-hextech-gold" />
            <div>
              <p className="text-sm font-semibold text-hextech-text-bright">{t('playerSheet.partialTitle', { games: games(notReady) })}</p>
              <p className="text-xs text-hextech-text-dim">
                {sheet.source === 'solo' ? unavailable.filter((u) => !single || u.gameIndex === sheet.gameIndex).map((u) => t(`playerSheet.unavail.${u.reason}`, { n: u.gameIndex })).join(' ') : fetchable.length > 0 ? t('playerSheet.notFetched') : notReady.some((p) => p.status === 'no-side') ? t('playerSheet.noSide') : t('playerSheet.notFound')}{' '}
                {!single && t('playerSheet.othersOk')}
              </p>
            </div>
          </div>
          {fetchable.length > 0 && onFetch && (
            <Button size="sm" variant="outline" disabled={fetching} onClick={onFetch}>
              {fetching && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}{t(fetching ? 'playerSheet.fetching' : 'playerSheet.fetch')}
            </Button>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-7" aria-label={t('playerSheet.title')}>
        {TILES.map((d) => {
          const f = footer(d)
          const f30 = footer30(d)
          return (
            <div key={d.key} className="rounded-md border border-hextech-border-dim bg-hextech-black/40 px-3 py-2">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-hextech-text-dim">{d.label}</p>
              <p className="mt-0.5 font-mono text-2xl font-bold tabular-nums text-hextech-text-bright">{line ? `${num(d.value(line.averages, line), d.digits)}${d.suffix ?? ''}` : '—'}</p>
              <p className={cn('min-h-[1rem] font-mono text-[11px] tabular-nums', tone(f?.good ?? null))}>{f?.text ?? ''}</p>
              {f30 && <p className={cn('font-mono text-[11px] tabular-nums', tone(f30.good))}>{f30.text}</p>}
            </div>
          )
        })}
      </div>

      {(() => {
        const ctx = { sheet, role, indiv, state: indivState, onExtract, extracting, gameMatchIds }
        return (
          <>
            <HighlightsBlock {...ctx} />
            <div className="grid gap-4 xl:grid-cols-2">
              {!hidden('duel') && <DuelPanel sheet={sheet} name={name} lane={single ? indiv?.games.find((x) => x.gameIndex === sheet.gameIndex)?.laneSummary ?? null : indiv?.total.laneSummary ?? null} />}
              <RadarBlock {...ctx} />
            </div>
            <div className="grid gap-4 xl:grid-cols-2">
              <div className="space-y-4"><IsolationBlock {...ctx} /><EventsBlock {...ctx} /></div>
              <div className="space-y-4"><LaneDiffBlock {...ctx} /><VsOpponentBlock {...ctx} /><VsTeamBlock {...ctx} /></div>
            </div>
            <div className="grid gap-4 xl:grid-cols-2">
              <ObjectivesBlock {...ctx} />
              <ExtrasBlock {...ctx} />
            </div>
          </>
        )
      })()}

      <UsualStats sheet={sheet} />

      <div className="grid gap-4 xl:grid-cols-2">
        {single ? <ThisGamePanel sheet={sheet} indiv={indiv} /> : <GameByGamePanel sheet={sheet} onPickGame={onPickGame} />}
        {!single && <BestWorst sheet={sheet} onPickGame={onPickGame} />}
      </div>
    </div>
  )
}

/* ── Lane matchup ── */

function DuelPanel({ sheet, name, lane }: { sheet: PlayerStatsSheet; name: string; lane: LaneSummary | null }) {
  const { t } = useTranslation()
  const duel = sheet.duel
  const us = duel?.our ?? sheet.line, them = duel?.enemy ?? null
  const unavailable = sheet.gameIndex != null && sheet.status !== 'ready'
  const pair = (a: number | null, b: number | null): [number | null, number | null] => [a, b]
  const rows: Array<{ key: string; label: string; pick: (p: SynergyPlayerStats) => number | null; d: number; lower?: boolean; pair?: [number | null, number | null] }> = [
    { key: 'kda', label: t('playerSheet.kda'), pick: (p) => p.averages.kda, d: 2 },
    { key: 'cs', label: t('playerSheet.csMin'), pick: (p) => p.averages.csPerMin, d: 1 },
    { key: 'gold', label: t('playerSheet.goldMin'), pick: (p) => p.averages.goldPerMin, d: 0 },
    { key: 'dmg', label: t('playerSheet.dmgMin'), pick: (p) => p.averages.damagePerMin, d: 0 },
    { key: 'deaths', label: t('playerSheet.deaths'), pick: (p) => p.averages.deaths, d: 1, lower: true },
    { key: 'vision', label: t('playerSheet.vision'), pick: (p) => p.averages.visionScore, d: 1 },
    // @15 from the timeline (or the lane report): both sides' absolute values, « — » when a side is unknown.
    ...(lane?.at15.opponent ? [
      { key: 'cs15', label: t('playerSheet.duelCs15'), pick: () => null, pair: pair(lane.at15.player.cs, lane.at15.opponent.cs), d: 0 },
      { key: 'gold15', label: t('playerSheet.duelGold15'), pick: () => null, pair: pair(lane.at15.player.gold, lane.at15.opponent.gold), d: 0 },
      { key: 'xp15', label: t('playerSheet.duelXp15'), pick: () => null, pair: pair(lane.at15.player.xp, lane.at15.opponent.xp), d: 0 },
    ] : []),
  ]
  const champ = them?.byChampion[0]?.championKey
  return (
    <section className={panel} aria-label={t('playerSheet.duel')}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-hextech-gold">{them ? (them.displayName ? t('playerSheet.duelVs', { name: them.displayName }) : t('playerSheet.duelOpponents')) : t('playerSheet.duel')}</h3>
        {them && <span className="font-mono text-[11px] text-hextech-text-dim">{[champ, them.role].filter(Boolean).join(' · ')}</span>}
      </div>
      {unavailable
        ? <p className="text-xs text-hextech-text-dim">{t('playerSheet.duelUnavailable', { n: sheet.gameIndex })}</p>
        : !them || !us
          ? <p className="text-xs text-hextech-text-dim">{t('playerSheet.duelNone')}</p>
          : (
            <table className="w-full text-xs text-hextech-text">
              <thead className="text-[10px] uppercase tracking-wider text-hextech-text-dim">
                <tr>
                  <th scope="col" className="px-2 py-1.5 text-left font-semibold">{t('playerSheet.metric')}</th>
                  <th scope="col" className="px-2 py-1.5 text-right font-semibold text-hextech-gold">{name}</th>
                  <th scope="col" className="px-2 py-1.5 text-right font-semibold">{them.displayName || t('playerSheet.laneOpp')}</th>
                  <th scope="col" className="px-2 py-1.5 text-right font-semibold">{t('playerSheet.gap')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hextech-border-dim">
                {rows.map((r) => {
                  const mine = r.pair ? r.pair[0] : r.pick(us), theirs = r.pair ? r.pair[1] : r.pick(them)
                  const diff = mine == null || theirs == null ? null : mine - theirs
                  return (
                    <tr key={r.key} className="h-9">
                      <th scope="row" className="px-2 text-left font-medium">{r.label}</th>
                      <td className="px-2 text-right font-mono tabular-nums text-hextech-text-bright">{num(mine, r.d)}</td>
                      <td className="px-2 text-right font-mono tabular-nums">{num(theirs, r.d)}</td>
                      <td className={cn('px-2 text-right font-mono tabular-nums', tone(diff == null ? null : better(Math.abs(diff) < 10 ** -(r.d + 1) ? 0 : diff, r.lower)))}>{diff == null ? '—' : signedNum(diff, r.d)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
    </section>
  )
}

/* ── One game: facts ── */

function ThisGamePanel({ sheet, indiv }: { sheet: PlayerStatsSheet; indiv: PlayerSessionStats | null }) {
  const { t } = useTranslation()
  const p = sheet.series.find((x) => x.index === sheet.gameIndex)
  const g = indiv?.games.find((x) => x.gameIndex === sheet.gameIndex) ?? null
  const int = (v: number | null | undefined) => (v == null ? '—' : String(v))
  const pct = (v: number | null | undefined) => (v == null ? '—' : `${signedNum(v, 1)} %`)
  const rows: Array<[string, string]> = [
    [t('playerSheet.champion'), p?.championKey ?? '—'],
    [t('playerSheet.result'), p?.win == null ? '—' : t(p.win ? 'teamSessions.winShort' : 'teamSessions.lossShort')],
    [t('playerSheet.duration'), p?.durationSec ? formatClock(p.durationSec) ?? '—' : '—'],
    // Timeline figures: a field without timeline stays « — », never 0.
    [t('playerSheet.deathsBefore14'), int(g?.deathsBefore14)],
    [t('playerSheet.isolatedDeaths'), int(g?.isolatedDeathsAfter14)],
    [t('playerSheet.isolatedKills'), int(g?.isolatedKills)],
    [t('playerSheet.goldVsTeam'), pct(g?.goldVsTeamAvgPct)],
    [t('playerSheet.xpVsTeam'), pct(g?.xpVsTeamAvgPct)],
  ]
  return (
    <section className={panel} aria-label={t('playerSheet.thisGame')}>
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-hextech-gold">{t('playerSheet.thisGameN', { n: sheet.gameIndex })}</h3>
      <dl className="divide-y divide-hextech-border-dim text-xs">
        {rows.map(([k, v]) => (
          <div key={k} className="flex h-9 items-center justify-between gap-3">
            <dt className="text-hextech-text-dim">{k}</dt>
            <dd className="font-mono tabular-nums text-hextech-text-bright">{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

/* ── Whole session: one bar per game ── */

type Metric = 'kda' | 'csPerMin' | 'damagePerMin'
const METRICS: Array<{ key: Metric; label: string; d: number; needs?: Missing }> = [
  { key: 'kda', label: 'KDA', d: 1 }, { key: 'csPerMin', label: 'CS/min', d: 1 }, { key: 'damagePerMin', label: 'DMG/min', d: 0, needs: 'damagePerMin' },
]

function GameByGamePanel({ sheet, onPickGame }: { sheet: PlayerStatsSheet; onPickGame: (index: number) => void }) {
  const { t } = useTranslation()
  const [metric, setMetric] = useState<Metric>('kda')
  const metrics = METRICS.filter((m) => !m.needs || !sheet.missing.includes(m.needs))
  const m = metrics.find((x) => x.key === metric) ?? metrics[0]
  const values = sheet.series.map((p) => p[m.key])
  const known = values.filter((v): v is number => v != null)
  const max = Math.max(...known, 0.0001)
  const avg = sheet.averages ? sheet.averages[m.key] : null
  const H = 120
  return (
    <section className={panel} aria-label={t('playerSheet.byGame')}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-hextech-gold">{t('playerSheet.byGame')}</h3>
        <div role="radiogroup" aria-label={t('playerSheet.metric')} className="inline-flex gap-1 rounded-md border border-hextech-border-dim bg-hextech-dark p-0.5">
          {metrics.map((x) => (
            <button key={x.key} type="button" role="radio" aria-checked={x.key === m.key} onClick={() => setMetric(x.key)}
              className={cn('rounded px-2 py-0.5 font-mono text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hextech-gold', x.key === m.key ? 'bg-hextech-gold text-hextech-black' : 'text-hextech-text hover:bg-hextech-elevated')}>{x.label}</button>
          ))}
        </div>
      </div>
      <p className="sr-only">{t('playerSheet.chartSummary', { metric: m.label, values: values.map((v) => num(v, m.d)).join(', '), avg: num(avg, m.d), count: sheet.gamesCounted })}</p>
      <div className="relative flex items-end gap-2 overflow-x-auto pb-1" style={{ height: H + 56 }}>
        {avg != null && known.length > 0 && (
          <div aria-hidden className="pointer-events-none absolute inset-x-0 border-t border-dashed border-hextech-gold/70" style={{ bottom: 36 + (Math.min(avg, max) / max) * H }} />
        )}
        {sheet.series.map((p, i) => {
          const v = values[i]
          const label = `${gname(p)}${p.championKey ? ` · ${p.championKey}` : ''}${p.win == null ? '' : ` · ${t(p.win ? 'teamSessions.winShort' : 'teamSessions.lossShort')}`}`
          return (
            <button key={p.gameId} type="button" onClick={() => onPickGame(p.index)} aria-label={t('playerSheet.pickGame', { n: p.index })}
              className="flex h-full min-w-[56px] flex-1 flex-col items-center justify-end gap-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hextech-gold">
              <span className="font-mono text-[11px] tabular-nums text-hextech-text-bright">{num(v, m.d)}</span>
              <span className={cn('w-full max-w-[44px] rounded-t border', v == null ? 'border-dashed border-hextech-border-dim' : p.win === false ? 'border-hextech-red bg-hextech-red/55' : p.win ? 'border-hextech-green bg-hextech-green/55' : 'border-hextech-text-dim bg-hextech-text-dim/40')}
                style={{ height: v == null ? 4 : Math.max(4, (v / max) * H) }} />
              <span className="h-7 text-center font-mono text-[10px] leading-tight text-hextech-text-dim">{label}</span>
            </button>
          )
        })}
      </div>
      {avg != null && <p className="mt-1 font-mono text-[11px] text-hextech-gold">{t('playerSheet.avg', { v: num(avg, m.d), count: sheet.gamesCounted })}</p>}
    </section>
  )
}

/* ── Usual stats (the team-stats columns, for one player) ── */

function UsualStats({ sheet }: { sheet: PlayerStatsSheet }) {
  const { t } = useTranslation()
  const line = sheet.line
  const hidden = (k: Missing) => sheet.missing.includes(k)
  if (!line) return null
  const a = line.averages
  const kfmt = (n: number) => (Math.abs(n) >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)))
  const items: Array<[string, string, Missing?]> = [
    [t('teamSessions.detail.indiv.kda'), num(a.kda, 2)], ['K / D / A', `${num(a.kills, 1)} / ${num(a.deaths, 1)} / ${num(a.assists, 1)}`],
    [t('teamSessions.detail.indiv.csMin'), num(a.csPerMin, 1)], ['CS', num(a.cs)],
    [t('teamSessions.detail.indiv.goldMin'), num(a.goldPerMin), 'goldPerMin'], [t('playerSheet.gold'), kfmt(a.gold), 'gold'],
    [t('teamSessions.detail.indiv.damage'), kfmt(a.damage), 'damage'], [t('teamSessions.detail.indiv.dmgMin'), num(a.damagePerMin), 'damagePerMin'],
    [t('teamSessions.detail.indiv.dmgShare'), `${num(line.shares.damagePct)} %`, 'shares'], [t('teamSessions.detail.indiv.dmgPerGold'), num(a.damagePerGold, 2), 'damagePerGold'],
    [t('teamSessions.detail.indiv.vision'), num(a.visionScore, 1)], [t('playerSheet.wards'), `${num(a.wardsPlaced, 1)} / ${num(a.wardsKilled, 1)} / ${num(a.controlWards, 1)}`, 'wardsPlaced'],
    [t('teamSessions.detail.indiv.kp'), `${num(line.shares.kpPct)} %`, 'shares'], [t('teamSessions.detail.indiv.taken'), kfmt(a.damageTaken), 'damageTaken'],
    [t('teamSessions.detail.indiv.cc'), num(a.ccTime, 1), 'ccTime'], [t('playerSheet.xpMin'), num(a.xpPerMin), 'xpPerMin'],
  ]
  return (
    <section className={cn(panel, 'space-y-3')} aria-label={t('teamSessions.detail.indiv.usual')}>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-hextech-gold">{t('teamSessions.detail.indiv.usual')}</h3>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-6">
        {items.filter(([, , need]) => !need || !hidden(need)).map(([k, v]) => (
          <div key={k} className="rounded-md border border-hextech-border-dim bg-hextech-black/40 px-3 py-2">
            <dt className="text-[10px] font-semibold uppercase tracking-wider text-hextech-text-dim">{k}</dt>
            <dd className="mt-0.5 font-mono text-base tabular-nums text-hextech-text-bright">{v}</dd>
          </div>
        ))}
      </dl>
      {sheet.gamesCounted > 1 && <p className="text-[11px] text-hextech-text-dim">{t('playerSheet.perGameAvg', { count: sheet.gamesCounted })}</p>}
    </section>
  )
}

/* ── Best / worst game of the session (by KDA) and trend ── */

function BestWorst({ sheet, onPickGame }: { sheet: PlayerStatsSheet; onPickGame: (index: number) => void }) {
  const { t } = useTranslation()
  const played = sheet.series.filter((p) => p.played && p.kda != null)
  if (played.length < 2) {
    return (
      <section className={panel} aria-label={t('playerSheet.bestWorst')}>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-hextech-gold">{t('playerSheet.bestWorst')}</h3>
        <WhyEmpty text={t('playerSheet.needTwoGames')} />
      </section>
    )
  }
  const best = played.reduce((m, p) => (p.kda! > m.kda! ? p : m)), worst = played.reduce((m, p) => (p.kda! < m.kda! ? p : m))
  const first = played[0], last = played[played.length - 1]
  const trend = last.kda! - first.kda!
  const row = (label: string, p: SheetGamePoint, good: boolean) => (
    <button type="button" onClick={() => onPickGame(p.index)} className="flex w-full items-center justify-between gap-3 rounded-md border border-hextech-border-dim bg-hextech-black/40 px-3 py-2 text-left hover:bg-hextech-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hextech-gold">
      <span>
        <span className="block text-[10px] font-semibold uppercase tracking-wider text-hextech-text-dim">{label}</span>
        <span className="text-xs text-hextech-text">{`G${p.index}${p.championKey ? ` · ${p.championKey}` : ''}`}</span>
      </span>
      <span className={cn('font-mono text-lg tabular-nums', good ? 'text-hextech-green' : 'text-hextech-red')}>{p.kda!.toFixed(2)}</span>
    </button>
  )
  return (
    <section className={cn(panel, 'space-y-2')} aria-label={t('playerSheet.bestWorst')}>
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-hextech-gold">{t('playerSheet.bestWorst')}</h3>
      {row(t('playerSheet.bestGame'), best, true)}
      {row(t('playerSheet.worstGame'), worst, false)}
      <p className={cn('font-mono text-xs', trend > 0 ? 'text-hextech-green' : trend < 0 ? 'text-hextech-red' : 'text-hextech-text-dim')}>
        {t('playerSheet.trend', { from: `G${first.index}`, to: `G${last.index}`, v: `${trend > 0 ? '+' : trend < 0 ? '−' : '±'}${Math.abs(trend).toFixed(2)}` })}
      </p>
    </section>
  )
}
