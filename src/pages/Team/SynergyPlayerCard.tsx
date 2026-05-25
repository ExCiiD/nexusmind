/**
 * Shared player synergy card used by StatsTab (flex), ScrimStatsTab,
 * TournamentStatsTab, and any future per-source stats view.
 *
 * Renders averages, shares, and by-champion breakdown for one
 * `SynergyPlayerStats` payload. Extracted from StatsTab so all consumers
 * stay visually consistent.
 */

import { useTranslation } from 'react-i18next'
import { Card } from '@/components/ui/card'
import { useChampionIconUrl } from '@/hooks/useChampionIconUrl'
import { Sword, Shield, Eye, Coins, Zap, Activity } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SynergyPlayerStats } from '@/lib/ipc'

export function SynergyPlayerCard({ player, matchCount }: { player: SynergyPlayerStats; matchCount: number }) {
  const { t } = useTranslation()
  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <h3 className="text-base font-bold text-hextech-text-bright">{player.displayName}</h3>
          <p className="text-[10px] uppercase tracking-wider text-hextech-text-dim font-semibold">{player.role}</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-hextech-gold-bright tabular-nums leading-tight">{player.winRate}%</p>
          <p className="text-[10px] text-hextech-text-dim">
            {player.wins}W / {player.gamesPlayed - player.wins}L · {player.gamesPlayed}/{matchCount} {t('team.stats.played', { defaultValue: 'played' })}
          </p>
        </div>
      </div>

      <Section title={t('team.stats.averages', { defaultValue: 'Averages' })}>
        <div className="grid grid-cols-3 gap-1.5">
          <StatTile
            icon={<Sword className="h-3 w-3" />}
            label={t('team.stats.kda', { defaultValue: 'KDA' })}
            value={player.averages.kda.toFixed(2)}
            hint={`${player.averages.kills.toFixed(1)} / ${player.averages.deaths.toFixed(1)} / ${player.averages.assists.toFixed(1)}`}
          />
          <StatTile
            icon={<Activity className="h-3 w-3" />}
            label={t('team.stats.csPerMin', { defaultValue: 'CS/min' })}
            value={player.averages.csPerMin.toFixed(1)}
          />
          <StatTile
            icon={<Coins className="h-3 w-3" />}
            label={t('team.stats.goldPerMin', { defaultValue: 'Gold/min' })}
            value={Math.round(player.averages.goldPerMin).toLocaleString()}
          />
          <StatTile
            icon={<Sword className="h-3 w-3 text-red-300" />}
            label={t('team.stats.damage', { defaultValue: 'Damage' })}
            value={formatThousands(player.averages.damage)}
          />
          <StatTile
            icon={<Shield className="h-3 w-3 text-blue-300" />}
            label={t('team.stats.damageTaken', { defaultValue: 'Tanked' })}
            value={formatThousands(player.averages.damageTaken)}
          />
          <StatTile
            icon={<Zap className="h-3 w-3 text-purple-300" />}
            label={t('team.stats.ccScore', { defaultValue: 'CC score' })}
            value={Math.round(player.averages.ccTime).toString()}
          />
          <StatTile
            icon={<Eye className="h-3 w-3 text-cyan-300" />}
            label={t('team.stats.visionScore', { defaultValue: 'Vision' })}
            value={player.averages.visionScore.toFixed(1)}
            hint={t('team.stats.visionBreakdown', {
              defaultValue: '{{w}} placed · {{k}} killed · {{c}} control',
              w: player.averages.wardsPlaced.toFixed(1),
              k: player.averages.wardsKilled.toFixed(1),
              c: player.averages.controlWards.toFixed(1),
            })}
          />
          <StatTile
            icon={<Eye className="h-3 w-3" />}
            label={t('team.stats.wards', { defaultValue: 'Wards' })}
            value={`${player.averages.wardsPlaced.toFixed(1)}/${player.averages.wardsKilled.toFixed(1)}`}
            hint={t('team.stats.placedKilled', { defaultValue: 'placed / killed' })}
          />
          <StatTile
            icon={<Eye className="h-3 w-3 text-pink-300" />}
            label={t('team.stats.pinks', { defaultValue: 'Pinks' })}
            value={player.averages.controlWards.toFixed(1)}
          />
        </div>
      </Section>

      <Section title={t('team.stats.shares', { defaultValue: 'Team share' })} hint={t('team.stats.sharesHint', { defaultValue: 'Your % of the team total per match (averaged)' })}>
        <div className="space-y-1">
          <ShareBar label={t('team.stats.damagePct', { defaultValue: 'Damage' })} pct={player.shares.damagePct} color="bg-red-500" />
          <ShareBar label={t('team.stats.damageTakenPct', { defaultValue: 'Damage taken' })} pct={player.shares.damageTakenPct} color="bg-blue-500" />
          <ShareBar label={t('team.stats.goldPct', { defaultValue: 'Gold' })} pct={player.shares.goldPct} color="bg-yellow-500" />
          <ShareBar label={t('team.stats.visionPct', { defaultValue: 'Vision' })} pct={player.shares.visionPct} color="bg-cyan-500" />
          <ShareBar label={t('team.stats.ccPct', { defaultValue: 'CC' })} pct={player.shares.ccPct} color="bg-purple-500" />
        </div>
      </Section>

      <Section title={t('team.stats.byChampion', { defaultValue: 'By champion' })}>
        {player.byChampion.length === 0 ? (
          <p className="text-[10px] text-hextech-text-dim italic">No champion data.</p>
        ) : (
          // Column-first flow keeps top-played champions stacked together
          // (1→5 on the left, 6→10 on the right) rather than interleaved
          // row-by-row, matching the user-requested layout in the StatsTab.
          <div className="grid grid-cols-1 sm:grid-cols-2 sm:grid-flow-col sm:grid-rows-5 gap-1">
            {player.byChampion.slice(0, 10).map((c) => (
              <ChampRow key={c.championKey} championKey={c.championKey} games={c.games} wins={c.wins} winRate={c.winRate} />
            ))}
          </div>
        )}
      </Section>
    </Card>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <h4 className="text-[10px] uppercase tracking-wider text-hextech-text-dim font-semibold">{title}</h4>
        {hint && <span className="text-[9px] text-hextech-text-dim italic">{hint}</span>}
      </div>
      {children}
    </div>
  )
}

function StatTile({ icon, label, value, hint }: {
  icon: React.ReactNode
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className="bg-hextech-dark/60 border border-hextech-border-dim rounded px-2 py-1.5" title={hint}>
      <div className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-hextech-text-dim">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <p className="text-sm font-bold text-hextech-text-bright tabular-nums leading-tight">{value}</p>
      {hint && <p className="text-[8px] text-hextech-text-dim truncate" title={hint}>{hint}</p>}
    </div>
  )
}

function ShareBar({ label, pct, color }: { label: string; pct: number; color: string }) {
  const clamped = Math.max(0, Math.min(100, pct))
  return (
    <div>
      <div className="flex items-center justify-between text-[10px] mb-0.5">
        <span className="text-hextech-text-dim">{label}</span>
        <span className="font-semibold text-hextech-text-bright tabular-nums">{pct.toFixed(1)}%</span>
      </div>
      <div className="h-1.5 bg-hextech-dark rounded overflow-hidden">
        <div className={cn('h-full transition-all', color)} style={{ width: `${clamped}%` }} />
      </div>
    </div>
  )
}

function ChampRow({ championKey, games, wins, winRate }: {
  championKey: string
  games: number
  wins: number
  winRate: number
}) {
  const iconUrl = useChampionIconUrl(championKey)
  // Color the WR pill from red (<40) → amber → green (>60) for quick scanning
  const wrColor =
    winRate >= 60 ? 'text-emerald-300 bg-emerald-500/15' :
    winRate >= 50 ? 'text-yellow-200 bg-yellow-500/15' :
    winRate >= 40 ? 'text-orange-300 bg-orange-500/15' :
    'text-red-300 bg-red-500/15'
  return (
    <div className="flex items-center gap-1.5 px-1.5 py-1 bg-hextech-dark/40 rounded">
      {iconUrl && <img src={iconUrl} alt={championKey} className="h-5 w-5 rounded" />}
      <span className="text-xs text-hextech-text-bright truncate flex-1">{championKey}</span>
      <span className="text-[9px] text-hextech-text-dim tabular-nums">{wins}/{games - wins}</span>
      <span className={cn('text-[10px] font-bold tabular-nums px-1.5 rounded', wrColor)}>{winRate}%</span>
    </div>
  )
}

function formatThousands(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return Math.round(n).toString()
}
