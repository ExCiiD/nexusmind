/**
 * DashboardTab — wide stats table + 4 donut charts.
 *
 * Visual layout mirrors the spreadsheet used by competitive players:
 *   - One row per roster member
 *   - 20+ columns of averaged stats (K/D/A, CS, damage, vision, etc.)
 *   - Below: pie/donut charts breaking down team contribution
 *     (damage dealt, damage taken, gold, kill participation)
 *
 * Shares the same `team:compute-synergy-stats` backend and `localStorage`
 * cache as StatsTab — computing in either tab auto-populates the other on
 * next mount.
 */

import { useState, useMemo, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/useToast'
import { Loader2, RefreshCw, Users, BarChart3 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { compareByRole } from '@/lib/championRoles'
import type { Team, TeamSynergyStats, SynergyPlayerStats } from '@/lib/ipc'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts'

interface Props {
  team: Team | null
}

// Distinct cache key from StatsTab — Dashboard stores **combined** stats
// (flex + scrim + tournament) while StatsTab stores **flex-only** stats.
// They have the same shape so they look alike, but mixing them would
// misrepresent the source mix.
const CACHE_KEY_PREFIX = 'nexusmind:combinedStats:'
function loadCache(teamId: string): Record<string, TeamSynergyStats> {
  try {
    const raw = localStorage.getItem(CACHE_KEY_PREFIX + teamId)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return typeof parsed === 'object' && parsed ? parsed : {}
  } catch { return {} }
}
function saveCacheEntry(teamId: string, minTogether: number, stats: TeamSynergyStats) {
  try {
    const cache = loadCache(teamId)
    cache[String(minTogether)] = stats
    localStorage.setItem(CACHE_KEY_PREFIX + teamId, JSON.stringify(cache))
  } catch (err) { console.warn('[DashboardTab] cache write failed', err) }
}

// Stable per-player colors for the donut charts. Picked from Tailwind's
// 400-tier so they stay readable against the dark hextech background but
// remain distinct from each other.
const PLAYER_COLORS = ['#fbbf24', '#60a5fa', '#34d399', '#f472b6', '#a78bfa', '#fb923c', '#f87171', '#22d3ee']

export function DashboardTab({ team }: Props) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [stats, setStats] = useState<TeamSynergyStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [minTogether, setMinTogether] = useState(3)
  const hydratedTeamRef = useRef<string | null>(null)

  // Lane-ordered so the table reads TOP → JG → MID → ADC → SUP, matching
  // the rest of the Team Management UI.
  const sortedPlayers = useMemo(() => {
    if (!stats) return []
    return [...stats.players].sort(compareByRole)
  }, [stats])

  // Hydrate from cache when team changes, falling back to any cached entry
  // if the selected `minTogether` doesn't have one yet.
  useEffect(() => {
    if (!team) {
      setStats(null)
      hydratedTeamRef.current = null
      return
    }
    if (hydratedTeamRef.current === team.id) return
    const cache = loadCache(team.id)
    const match = cache[String(minTogether)]
    if (match) {
      setStats(match)
    } else {
      const fallbackKey = Object.keys(cache)[0]
      if (fallbackKey) {
        setStats(cache[fallbackKey])
        setMinTogether(Number(fallbackKey))
      } else {
        setStats(null)
      }
    }
    hydratedTeamRef.current = team.id
  }, [team, minTogether])

  // Auto-recompute when changing minTogether and the new value has no cache.
  // Skipped on first visit (no stats present yet) so we don't surprise the
  // user with a long fetch.
  useEffect(() => {
    if (!team || loading) return
    if (hydratedTeamRef.current !== team.id) return
    const cache = loadCache(team.id)
    const cached = cache[String(minTogether)]
    if (cached) {
      if (!stats || stats.fetchedAt !== cached.fetchedAt) setStats(cached)
      return
    }
    if (stats) {
      setStats(null)
      void handleCompute()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minTogether, team])

  const handleCompute = async () => {
    if (!team) return
    setLoading(true)
    try {
      // Dashboard uses the combined endpoint so flex + scrim + tournament
      // are all aggregated together. The individual StatsTab / Scrim /
      // Tournament tabs use their dedicated endpoints for source-specific
      // breakdowns. Cache key stays the same as StatsTab on the renderer
      // (synergyStats:<teamId>) but holds a different payload — this is
      // fine because each tab reads/writes its own minTogether slot and
      // the keys never collide; visually they look identical.
      const res = await window.api.computeCombinedStats(team.id, { minTogether })
      setStats(res)
      saveCacheEntry(team.id, minTogether, res)
      if (res.matchCount === 0) {
        toast({
          title: t('team.stats.noMatches', { defaultValue: 'No synergy matches found' }),
          description: t('team.stats.noMatchesDesc', {
            defaultValue: 'No recent flex games where ≥{{n}} of your roster played together.',
            n: minTogether,
          }),
        })
      }
    } catch (err) {
      toast({
        title: t('team.stats.failed', { defaultValue: 'Failed to compute stats' }),
        description: (err as Error).message,
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  if (!team) {
    return (
      <Card className="p-6 text-center text-hextech-text-dim">
        {t('team.dashboard.noTeam', { defaultValue: 'Select or create a team first.' })}
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <Card className="p-4 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-hextech-gold" />
          <span className="text-sm text-hextech-text">
            {t('team.dashboard.subtitleCombined', {
              defaultValue: 'Combined stats: flex (≥{{n}} together) + all imported scrim & tournament games',
              n: minTogether,
            })}
          </span>
        </div>

        <div className="flex items-center gap-2 ml-auto">
          <label className="flex items-center gap-1.5 text-xs text-hextech-text-dim">
            {t('team.stats.minTogether', { defaultValue: 'Min players together:' })}
            <select
              value={minTogether}
              onChange={(e) => setMinTogether(Number(e.target.value))}
              disabled={loading}
              className="bg-hextech-dark border border-hextech-border rounded px-2 py-1 text-xs"
            >
              <option value={2}>2</option>
              <option value={3}>3</option>
              <option value={4}>4</option>
              <option value={5}>5</option>
            </select>
          </label>

          <Button
            size="sm"
            onClick={handleCompute}
            disabled={loading || !team || (team.members ?? []).length < minTogether}
          >
            {loading
              ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
            {loading
              ? t('team.stats.computing', { defaultValue: 'Computing…' })
              : stats
                ? t('team.stats.refresh', { defaultValue: 'Refresh' })
                : t('team.stats.compute', { defaultValue: 'Compute synergy stats' })}
          </Button>
        </div>
      </Card>

      {!stats && !loading && (
        <Card className="p-8 text-center text-hextech-text-dim">
          <BarChart3 className="h-8 w-8 mx-auto opacity-40" />
          <p className="mt-3 text-sm">
            {t('team.dashboard.emptyHint', {
              defaultValue: 'Click "Compute synergy stats" to populate the dashboard.',
            })}
          </p>
          <p className="mt-1 text-[10px] text-hextech-text-dim/70">
            {t('team.stats.cacheHint', {
              defaultValue: 'Results are cached locally and re-loaded next time you open this tab.',
            })}
          </p>
        </Card>
      )}

      {!stats && loading && (
        <Card className="p-8 text-center text-hextech-text-dim">
          <Loader2 className="h-8 w-8 mx-auto animate-spin text-hextech-gold" />
          <p className="mt-3 text-sm">
            {t('team.stats.computingDesc', {
              defaultValue: 'Fetching match history and computing synergy stats — may take up to a minute on first run.',
            })}
          </p>
        </Card>
      )}

      {stats && stats.matchCount > 0 && (
        <>
          <StatsTable players={sortedPlayers} matchCount={stats.matchCount} />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <ShareDonut
              title={t('team.dashboard.dmgShare', { defaultValue: 'Damage share' })}
              players={sortedPlayers}
              valueFn={(p) => p.averages.damage}
            />
            <ShareDonut
              title={t('team.dashboard.dmgTakenShare', { defaultValue: 'Damage taken share' })}
              players={sortedPlayers}
              valueFn={(p) => p.averages.damageTaken}
            />
            <ShareDonut
              title={t('team.dashboard.goldShare', { defaultValue: 'Gold share' })}
              players={sortedPlayers}
              valueFn={(p) => p.averages.gold}
            />
            <ShareDonut
              title={t('team.dashboard.kpShare', { defaultValue: 'Kill participation share' })}
              players={sortedPlayers}
              // KP is (kills + assists) — closer to "contribution to kills" than
              // pure kill count, matches the user's spreadsheet definition.
              valueFn={(p) => p.averages.kills + p.averages.assists}
            />
          </div>
        </>
      )}

      {stats && stats.matchCount === 0 && (
        <Card className="p-6 text-center text-hextech-text-dim">
          {t('team.stats.noMatchesDesc', {
            defaultValue: 'No recent flex games where ≥{{n}} of your roster played together.',
            n: minTogether,
          })}
        </Card>
      )}
    </div>
  )
}

function StatsTable({ players, matchCount }: { players: SynergyPlayerStats[]; matchCount: number }) {
  const { t } = useTranslation()
  return (
    <Card className="p-0 overflow-hidden">
      <div className="px-4 py-2 border-b border-hextech-border-dim flex items-center justify-between">
        <h3 className="text-sm font-bold text-hextech-text-bright">
          {t('team.dashboard.statsTable', { defaultValue: 'Player stats' })}
        </h3>
        <span className="text-[10px] text-hextech-text-dim italic">
          {t('team.dashboard.basedOn', { defaultValue: 'Averages from {{n}} flex games', n: matchCount })}
        </span>
      </div>
      {/* Horizontal scroll for the dense 24-column layout — desktop usually
          fits all columns at >1400px, smaller screens scroll. */}
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

function ShareDonut({ title, players, valueFn }: {
  title: string
  players: SynergyPlayerStats[]
  valueFn: (p: SynergyPlayerStats) => number
}) {
  // We feed raw averaged values to recharts and let it compute the visual
  // percentages. That keeps the chart proportional even when a player skipped
  // some matches (sums won't be exactly 100% if minTogether < 5).
  const data = players.map((p, i) => ({
    name: p.displayName,
    value: Math.max(0, valueFn(p)),
    color: PLAYER_COLORS[i % PLAYER_COLORS.length],
  }))
  const total = data.reduce((s, d) => s + d.value, 0)

  return (
    <Card className="p-4">
      <h3 className="text-sm font-bold text-hextech-text-bright mb-2">{title}</h3>
      {total === 0 ? (
        <p className="text-xs text-hextech-text-dim italic text-center py-8">No data</p>
      ) : (
        // Two-column layout: donut on the left, legend on the right.
        // Avoids the previous mess where recharts crammed full player
        // names + percentages onto each slice AND a wrapping legend below,
        // causing overlapping labels (see user feedback).
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
                  // In-slice label = percentage only, no name (names go in the
                  // side legend). Hide tiny slices (<8%) to avoid clutter on
                  // unbalanced charts (e.g. ADC carrying damage).
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
          {/* Custom legend — sorted by share desc so the highest contributor
              reads first. Keeps player names out of the chart entirely. */}
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
