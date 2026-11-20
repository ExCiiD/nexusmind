/**
 * DashboardLayout — pure presentational component shared between the
 * active-team Dashboard tab and the Scouting tab. Takes a pre-computed
 * player list + match count and renders the dense stats table + the
 * 4 donut charts in the same visual layout.
 *
 * Keeping it presentation-only means the two callers can fetch from
 * different backends (compute-combined-stats vs compute-opponent-dashboard)
 * and own their own caching/refresh logic.
 */

import { useTranslation } from 'react-i18next'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { SynergyPlayerStats } from '@/lib/ipc'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'
import { wrText } from '@/lib/winrate'

const PLAYER_COLORS = ['#fbbf24', '#60a5fa', '#34d399', '#f472b6', '#a78bfa', '#fb923c', '#f87171', '#22d3ee']

interface Props {
  players: SynergyPlayerStats[]
  matchCount: number
  /** Custom label for the "Averages from N games" hint (e.g. "scouted games"). */
  basedOnLabel?: string
}

export function DashboardLayout({ players, matchCount, basedOnLabel }: Props) {
  return (
    <div className="space-y-3">
      <StatsTable players={players} matchCount={matchCount} basedOnLabel={basedOnLabel} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* 20/11/2026: the shares of the WHOLE team (as in the table), not re-split among the players shown. */}
        <ShareDonut titleKey="team.dashboard.dmgShare" defaultTitle="Damage share" players={players} shareFn={(p) => p.shares.damagePct} />
        <ShareDonut titleKey="team.dashboard.dmgTakenShare" defaultTitle="Damage taken share" players={players} shareFn={(p) => p.shares.damageTakenPct} />
        <ShareDonut titleKey="team.dashboard.goldShare" defaultTitle="Gold share" players={players} shareFn={(p) => p.shares.goldPct} />
        <KpBars players={players} />
      </div>
    </div>
  )
}

// Column groups (E17: readability pass). Short column labels are LoL stat
// abbreviations, kept as they are in every language; each column's tooltip
// is the i18n key team.statsTable.hint.<key>. Same 24 columns, same order as
// before — this only adds a labeled group header row above them (so
// "which cluster of stats am I looking at" doesn't require memorizing
// abbreviations) and a legend of what each abbreviation means. `span`
// must add up to the exact column count in each group below.
// `label` is an i18n key (team.statsTable.group.*), '' = no label.
const COLUMN_GROUPS: Array<{ label: string; span: number; cls?: string }> = [
  { label: '', span: 1 }, // player (sticky, no group label needed)
  { label: 'team.statsTable.group.record', span: 2 },
  { label: 'team.statsTable.group.combat', span: 4 },
  { label: 'team.statsTable.group.economy', span: 4 },
  { label: 'team.statsTable.group.impact', span: 9, cls: 'text-hextech-gold-bright/80' },
  { label: 'team.statsTable.group.vision', span: 4 },
]

const COLUMNS = [
  ['player', '', 'text-left pl-3', undefined],
  ['games', 'Games', 'text-right', 'Games played'],
  ['wr', 'WR%', 'text-right', 'Win rate'],
  ['k', 'K', 'text-right', 'Kills per game'],
  ['d', 'D', 'text-right', 'Deaths per game'],
  ['a', 'A', 'text-right', 'Assists per game'],
  ['kda', 'KDA', 'text-right text-hextech-gold-bright', '(Kills + Assists) / Deaths'],
  ['cs', 'CS', 'text-right', 'Creep score per game'],
  ['csm', 'CS/M', 'text-right', 'Creep score per minute'],
  ['gold', 'Gold', 'text-right', 'Gold earned per game'],
  ['gm', 'G/M', 'text-right', 'Gold per minute'],
  ['dmg', 'Dmg', 'text-right', 'Damage to champions per game'],
  ['dmgm', 'Dmg/M', 'text-right', 'Damage to champions per minute'],
  ['tank', 'Tank', 'text-right', 'Damage taken per game'],
  ['tankpct', '%Tank', 'text-right text-blue-300', 'Share of the team\'s total damage taken'],
  ['kp', 'KP%', 'text-right text-emerald-300', 'Kill participation — share of the team\'s kills you got a kill or assist on'],
  ['goldpct', '%Gold', 'text-right text-yellow-300', 'Share of the team\'s total gold'],
  ['dmgpct', '%Dmg', 'text-right text-red-300', 'Share of the team\'s total damage to champions'],
  ['eff', 'Eff.', 'text-right', 'Damage per gold — higher = more cost-efficient'],
  ['xpm', 'XP/M', 'text-right', 'Experience per minute'],
  ['vs', 'VS', 'text-right', 'Vision score per game'],
  ['wp', 'WP', 'text-right', 'Wards placed per game'],
  ['wk', 'WK', 'text-right', 'Wards killed per game'],
  ['pink', 'Pink', 'text-right pr-3', 'Control wards bought per game'],
] as const

/** Exported for TeamSessionStatsTable.tsx (Phase 4, Planning rework) — the
 *  per-game team-vs-team stats table reuses this 24-column layout twice
 *  (our 5 rows, enemy 5 rows) instead of rebuilding it. */
export function StatsTable({ players, matchCount, basedOnLabel }: { players: SynergyPlayerStats[]; matchCount: number; basedOnLabel?: string }) {
  const { t } = useTranslation()
  return (
    <Card className="p-0 overflow-hidden">
      <div className="px-4 py-2 border-b border-hextech-border-dim flex items-center justify-between">
        <h3 className="text-sm font-bold text-hextech-text-bright">
          {t('team.dashboard.statsTable', { defaultValue: 'Player stats' })}
        </h3>
        <span className="text-[10px] text-hextech-text-dim italic">
          {basedOnLabel ?? t('team.dashboard.basedOn', { defaultValue: 'Averages from {{n}} games', n: matchCount })}
        </span>
      </div>
      {/* Horizontal scroll for the 24-column spreadsheet; the player column
          stays pinned (sticky left-0) so you never lose track of which row
          is whose while scrolling through the stat clusters. */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-separate border-spacing-0">
          <thead className="bg-hextech-dark/70 text-hextech-text-dim sticky top-0 z-20">
            {/* Group header row — purely organizational, tells you which
                cluster (Record/Combat/Economy/Impact/Vision) you're
                reading before you get lost in abbreviations below. */}
            <tr>
              {COLUMN_GROUPS.map((g, i) => (
                <th
                  key={i}
                  colSpan={g.span}
                  className={cn(
                    'px-1.5 py-1 text-[9px] font-bold uppercase tracking-wider text-center border-b border-hextech-border-dim/60',
                    i > 0 && 'border-l border-hextech-border-dim/40',
                    g.cls,
                  )}
                >
                  {g.label ? t(g.label) : ''}
                </th>
              ))}
            </tr>
            <tr>
              {COLUMNS.map(([k, label, cls], i) => (
                <th
                  key={k}
                  title={k === 'player' ? undefined : t(`team.statsTable.hint.${k}`)}
                  className={cn(
                    'px-1.5 py-1.5 font-semibold uppercase text-[9px] tracking-wider whitespace-nowrap',
                    cls,
                    k === 'player' && 'sticky left-0 z-10 bg-hextech-dark',
                    // Thin separators at the same boundaries as the group
                    // header above, so the grouping reads as one column
                    // block even without re-reading the header row.
                    isGroupStart(i) && i > 0 && 'border-l border-hextech-border-dim/40',
                  )}
                >
                  {k === 'player' ? t('team.statsTable.player') : label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-hextech-border-dim/40">
            {players.map((p, rowIdx) => {
              const a = p.averages
              const s = p.shares
              const zebra = rowIdx % 2 === 1 ? 'bg-white/[0.02]' : ''
              return (
                <tr key={p.memberId} className={cn('hover:bg-hextech-dark/30 transition-colors group', zebra)}>
                  <td className={cn('px-1.5 py-1.5 pl-3 whitespace-nowrap sticky left-0 z-10 bg-hextech-dark group-hover:bg-hextech-elevated', zebra)}>
                    <span className="font-semibold text-hextech-text-bright">{p.displayName}</span>
                    <span className="ml-1.5 text-[9px] text-hextech-text-dim">· {p.role}</span>
                  </td>
                  <td className="px-1.5 py-1.5 text-right tabular-nums border-l border-hextech-border-dim/30">{p.gamesPlayed}</td>
                  <td className={cn('px-1.5 py-1.5 text-right tabular-nums font-semibold', wrText(p.winRate, p.gamesPlayed))}>{p.winRate}%</td>
                  <td className="px-1.5 py-1.5 text-right tabular-nums border-l border-hextech-border-dim/30">{a.kills.toFixed(1)}</td>
                  <td className="px-1.5 py-1.5 text-right tabular-nums">{a.deaths.toFixed(1)}</td>
                  <td className="px-1.5 py-1.5 text-right tabular-nums">{a.assists.toFixed(1)}</td>
                  <td className="px-1.5 py-1.5 text-right tabular-nums font-semibold text-hextech-gold-bright">{a.kda.toFixed(2)}</td>
                  <td className="px-1.5 py-1.5 text-right tabular-nums border-l border-hextech-border-dim/30">{Math.round(a.cs)}</td>
                  <td className="px-1.5 py-1.5 text-right tabular-nums">{a.csPerMin.toFixed(1)}</td>
                  <td className="px-1.5 py-1.5 text-right tabular-nums">{Math.round(a.gold).toLocaleString()}</td>
                  <td className="px-1.5 py-1.5 text-right tabular-nums">{Math.round(a.goldPerMin)}</td>
                  <td className="px-1.5 py-1.5 text-right tabular-nums border-l border-hextech-border-dim/30">{formatK(a.damage)}</td>
                  <td className="px-1.5 py-1.5 text-right tabular-nums">{Math.round(a.damagePerMin)}</td>
                  <td className="px-1.5 py-1.5 text-right tabular-nums">{formatK(a.damageTaken)}</td>
                  <td className="px-1.5 py-1.5 text-right tabular-nums text-blue-300">{s.damageTakenPct.toFixed(1)}%</td>
                  <td className="px-1.5 py-1.5 text-right tabular-nums text-emerald-300 font-semibold">{Math.round(s.kpPct)}%</td>
                  <td className="px-1.5 py-1.5 text-right tabular-nums text-yellow-300">{s.goldPct.toFixed(1)}%</td>
                  <td className="px-1.5 py-1.5 text-right tabular-nums text-red-300 font-semibold">{s.damagePct.toFixed(1)}%</td>
                  <td className="px-1.5 py-1.5 text-right tabular-nums" title="Damage per gold — higher = more cost-efficient">
                    {a.damagePerGold.toFixed(1)}
                  </td>
                  <td className="px-1.5 py-1.5 text-right tabular-nums">{Math.round(a.xpPerMin)}</td>
                  <td className="px-1.5 py-1.5 text-right tabular-nums border-l border-hextech-border-dim/30">{a.visionScore.toFixed(1)}</td>
                  <td className="px-1.5 py-1.5 text-right tabular-nums">{a.wardsPlaced.toFixed(1)}</td>
                  <td className="px-1.5 py-1.5 text-right tabular-nums">{a.wardsKilled.toFixed(1)}</td>
                  <td className="px-1.5 py-1.5 pr-3 text-right tabular-nums">{a.controlWards.toFixed(1)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

/** True when column index `i` is the first column of a group (per
 *  COLUMN_GROUPS' spans) — used to draw the sub-header's separators at
 *  the same boundaries as the group header above it. */
function isGroupStart(i: number): boolean {
  let acc = 0
  for (const g of COLUMN_GROUPS) {
    if (i === acc) return true
    acc += g.span
  }
  return false
}

/** Grey slice: the team's share held by players not in the list (fewer than 5 group members in the game). */
const REST_COLOR = '#4b5563'

/**
 * A share of the whole team per player (percent, 0-100, the same figure as the table's % columns), and the rest
 * of the team as a grey slice when the players listed hold less than 100 %. Re-splitting the total among the
 * players shown made 3 players out of 5 look like 100 % of the team (20/11/2026).
 */
function ShareDonut({ titleKey, defaultTitle, players, shareFn }: {
  titleKey: string
  defaultTitle: string
  players: SynergyPlayerStats[]
  shareFn: (p: SynergyPlayerStats) => number
}) {
  const { t } = useTranslation()
  const shown = players.map((p, i) => ({
    name: p.displayName,
    value: Math.max(0, shareFn(p) || 0),
    color: PLAYER_COLORS[i % PLAYER_COLORS.length],
    rest: false,
  }))
  const shownTotal = shown.reduce((s, d) => s + d.value, 0)
  const rest = Math.max(0, 100 - shownTotal)
  const data = rest >= 0.5
    ? [...shown, { name: t('team.dashboard.restOfTeam'), value: rest, color: REST_COLOR, rest: true }]
    : shown
  const total = data.reduce((s, d) => s + d.value, 0)

  return (
    <Card className="p-4">
      <h3 className="text-sm font-bold text-hextech-text-bright mb-2">{t(titleKey, { defaultValue: defaultTitle })}</h3>
      {total === 0 ? (
        <p className="text-xs text-hextech-text-dim italic text-center py-8">{t('team.statsTable.noData')}</p>
      ) : (
        <div className="flex items-center gap-4">
          <div className="h-56 flex-1 min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart margin={{ top: 14, right: 8, bottom: 14, left: 8 }}>
                <Pie
                  rootTabIndex={-1}
                  data={data}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius="50%"
                  outerRadius="78%"
                  paddingAngle={2}
                  label={({ percent }) => {
                    const pct = (percent ?? 0) * 100
                    return pct >= 8 ? `${pct.toFixed(0)}%` : ''
                  }}
                  labelLine={false}
                  isAnimationActive={false}
                >
                  {data.map((entry) => (
                    <Cell key={entry.name} fill={entry.color} stroke="rgba(0,0,0,0.4)" />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ background: '#0a0e1a', border: '1px solid #2a3a55', borderRadius: 4, fontSize: 12 }}
                  formatter={(v: number, _name, ctx: any) => {
                    const pct = total > 0 ? ((v / total) * 100).toFixed(1) : '0.0'
                    return [`${pct}%`, ctx?.payload?.name ?? '']
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="flex flex-col gap-1.5 text-xs min-w-[120px] shrink-0">
            {[...data]
              .map((d) => ({ ...d, pct: total > 0 ? (d.value / total) * 100 : 0 }))
              .sort((a, b) => Number(a.rest) - Number(b.rest) || b.pct - a.pct)
              .map((d) => (
                <li key={d.name} className="flex items-center gap-2">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-sm shrink-0"
                    style={{ backgroundColor: d.color }}
                  />
                  <span className="text-hextech-text truncate flex-1" title={d.name}>{d.name}</span>
                  <span className="text-hextech-text-bright font-semibold tabular-nums">
                    {d.pct.toFixed(1)}%
                  </span>
                </li>
              ))}
          </ul>
        </div>
      )}
    </Card>
  )
}

/**
 * Kill participation per player: each one's share of the team's kills (kill or assist). These do not add up to
 * 100 % (several players share a kill), so bars, not a donut (20/11/2026).
 */
function KpBars({ players }: { players: SynergyPlayerStats[] }) {
  const { t } = useTranslation()
  const rows = players
    .map((p, i) => ({ name: p.displayName, kp: Math.max(0, Math.min(100, p.shares.kpPct || 0)), color: PLAYER_COLORS[i % PLAYER_COLORS.length] }))
    .sort((a, b) => b.kp - a.kp)
  return (
    <Card className="p-4">
      <h3 className="text-sm font-bold text-hextech-text-bright">{t('team.dashboard.kpShare')}</h3>
      <p className="mb-3 text-[11px] text-hextech-text-dim">{t('team.dashboard.kpHint')}</p>
      {rows.length === 0 ? (
        <p className="text-xs text-hextech-text-dim italic text-center py-8">{t('team.statsTable.noData')}</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.name} className="text-xs">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="truncate text-hextech-text" title={r.name}>{r.name}</span>
                <span className="font-semibold tabular-nums text-hextech-text-bright">{Math.round(r.kp)}%</span>
              </div>
              <div className="h-2.5 rounded-full bg-hextech-bg">
                <div className="h-2.5 rounded-full" style={{ width: `${r.kp}%`, backgroundColor: r.color }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function formatK(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return Math.round(n).toString()
}

