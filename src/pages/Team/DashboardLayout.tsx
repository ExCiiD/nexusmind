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
        <ShareDonut titleKey="team.dashboard.dmgShare" defaultTitle="Damage share" players={players} valueFn={(p) => p.averages.damage} />
        <ShareDonut titleKey="team.dashboard.dmgTakenShare" defaultTitle="Damage taken share" players={players} valueFn={(p) => p.averages.damageTaken} />
        <ShareDonut titleKey="team.dashboard.goldShare" defaultTitle="Gold share" players={players} valueFn={(p) => p.averages.gold} />
        <ShareDonut
          titleKey="team.dashboard.kpShare"
          defaultTitle="Kill participation share"
          players={players}
          valueFn={(p) => p.averages.kills + p.averages.assists}
        />
      </div>
    </div>
  )
}

function StatsTable({ players, matchCount, basedOnLabel }: { players: SynergyPlayerStats[]; matchCount: number; basedOnLabel?: string }) {
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
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-hextech-dark/50 text-hextech-text-dim sticky top-0">
            <tr>
              {([
                ['player', 'Joueur', 'text-left pl-3'],
                ['games', 'Games', 'text-right'],
                ['wr', 'WR%', 'text-right'],
                ['k', 'K', 'text-right'],
                ['d', 'D', 'text-right'],
                ['a', 'A', 'text-right'],
                ['kda', 'KDA', 'text-right text-hextech-gold-bright'],
                ['cs', 'CS', 'text-right'],
                ['csm', 'CS/M', 'text-right'],
                ['gold', 'Gold', 'text-right'],
                ['gm', 'G/M', 'text-right'],
                ['dmg', 'Dmg', 'text-right'],
                ['dmgm', 'Dmg/M', 'text-right'],
                ['tank', 'Tank', 'text-right'],
                ['tankpct', '%Tank', 'text-right text-blue-300'],
                ['kp', 'KP%', 'text-right text-emerald-300'],
                ['goldpct', '%Gold', 'text-right text-yellow-300'],
                ['dmgpct', '%Dmg', 'text-right text-red-300'],
                ['eff', 'Eff.', 'text-right'],
                ['xpm', 'XP/M', 'text-right'],
                ['vs', 'VS', 'text-right'],
                ['wp', 'WP', 'text-right'],
                ['wk', 'WK', 'text-right'],
                ['pink', 'Pink', 'text-right pr-3'],
              ] as const).map(([k, label, cls]) => (
                <th key={k} className={cn('px-1.5 py-1.5 font-semibold uppercase text-[9px] tracking-wider whitespace-nowrap', cls)}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-hextech-border-dim/40">
            {players.map((p) => {
              const a = p.averages
              const s = p.shares
              return (
                <tr key={p.memberId} className="hover:bg-hextech-dark/30 transition-colors">
                  <td className="px-1.5 py-1.5 pl-3 whitespace-nowrap">
                    <span className="font-semibold text-hextech-text-bright">{p.displayName}</span>
                    <span className="ml-1.5 text-[9px] text-hextech-text-dim">{p.role}</span>
                  </td>
                  <td className="px-1.5 py-1.5 text-right tabular-nums">{p.gamesPlayed}</td>
                  <td className={cn('px-1.5 py-1.5 text-right tabular-nums font-semibold', wrColor(p.winRate))}>{p.winRate}%</td>
                  <td className="px-1.5 py-1.5 text-right tabular-nums">{a.kills.toFixed(1)}</td>
                  <td className="px-1.5 py-1.5 text-right tabular-nums">{a.deaths.toFixed(1)}</td>
                  <td className="px-1.5 py-1.5 text-right tabular-nums">{a.assists.toFixed(1)}</td>
                  <td className="px-1.5 py-1.5 text-right tabular-nums font-semibold text-hextech-gold-bright">{a.kda.toFixed(2)}</td>
                  <td className="px-1.5 py-1.5 text-right tabular-nums">{Math.round(a.cs)}</td>
                  <td className="px-1.5 py-1.5 text-right tabular-nums">{a.csPerMin.toFixed(1)}</td>
                  <td className="px-1.5 py-1.5 text-right tabular-nums">{Math.round(a.gold).toLocaleString()}</td>
                  <td className="px-1.5 py-1.5 text-right tabular-nums">{Math.round(a.goldPerMin)}</td>
                  <td className="px-1.5 py-1.5 text-right tabular-nums">{formatK(a.damage)}</td>
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
                  <td className="px-1.5 py-1.5 text-right tabular-nums">{a.visionScore.toFixed(1)}</td>
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

function ShareDonut({ titleKey, defaultTitle, players, valueFn }: {
  titleKey: string
  defaultTitle: string
  players: SynergyPlayerStats[]
  valueFn: (p: SynergyPlayerStats) => number
}) {
  const { t } = useTranslation()
  const data = players.map((p, i) => ({
    name: p.displayName,
    value: Math.max(0, valueFn(p)),
    color: PLAYER_COLORS[i % PLAYER_COLORS.length],
  }))
  const total = data.reduce((s, d) => s + d.value, 0)

  return (
    <Card className="p-4">
      <h3 className="text-sm font-bold text-hextech-text-bright mb-2">{t(titleKey, { defaultValue: defaultTitle })}</h3>
      {total === 0 ? (
        <p className="text-xs text-hextech-text-dim italic text-center py-8">No data</p>
      ) : (
        <div className="flex items-center gap-4">
          <div className="h-56 flex-1 min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius="55%"
                  outerRadius="90%"
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
                    return [`${Math.round(v).toLocaleString()} (${pct}%)`, ctx?.payload?.name ?? '']
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="flex flex-col gap-1.5 text-xs min-w-[120px] shrink-0">
            {[...data]
              .map((d) => ({ ...d, pct: total > 0 ? (d.value / total) * 100 : 0 }))
              .sort((a, b) => b.pct - a.pct)
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

function formatK(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return Math.round(n).toString()
}

function wrColor(wr: number): string {
  if (wr >= 60) return 'text-emerald-300'
  if (wr >= 50) return 'text-yellow-200'
  if (wr >= 40) return 'text-orange-300'
  return 'text-red-300'
}
