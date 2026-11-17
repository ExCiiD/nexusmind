import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Swords, Scale, Timer, Sun, Brain, Lightbulb, Shield } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useChampionIconUrl } from '@/hooks/useChampionIconUrl'
import {
  championPool,
  winLossSplit,
  biggestLever,
  winrateByDuration,
  winrateByDaypart,
  tiltReport,
  championLabel,
  MIN_SAMPLE,
  type InsightGame,
  type Bucket,
  type SplitMetric,
} from '@/lib/statsInsights'
import { LowEnergyPrompt } from '@/components/MicroReview/LowEnergyPrompt'

const panel = 'rounded-2xl border border-hextech-border-dim/70 panel-surface p-5 shadow-lg backdrop-blur-sm'

/**
 * Stats → "Analyse" tab: turns the last 50 games into answers instead of
 * averages — which champions actually win, what changes in a loss, when
 * the user plays best, and whether they tilt. All client-side (see
 * src/lib/statsInsights.ts).
 */
export function StatsInsightsTab() {
  const { t } = useTranslation()
  const [games, setGames] = useState<InsightGame[] | null>(null)

  useEffect(() => {
    window.api.getMatchHistoryWithStatus(50)
      .then((rows: any[]) => setGames(rows ?? []))
      .catch(() => setGames([]))
  }, [])

  if (games === null) {
    return (
      <div className="flex items-center justify-center gap-3 py-16 text-hextech-text-dim">
        <Loader2 className="h-5 w-5 animate-spin" /> {t('statsInsights.loading')}
      </div>
    )
  }
  if (games.length < MIN_SAMPLE * 2) {
    return <div className={cn(panel, 'py-16 text-center text-hextech-text-dim')}>{t('statsInsights.notEnough')}</div>
  }

  const pool = championPool(games)
  const split = winLossSplit(games)
  const lever = biggestLever(split)
  const tilt = tiltReport(games)

  return (
    <div className="space-y-4">
      <p className="text-xs text-hextech-text-dim">{t('statsInsights.basis', { count: games.length })}</p>

      <KeyTakeaways lever={lever} tilt={tilt} pool={pool} />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <section className={cn(panel, 'xl:col-span-3')}>
          <Header icon={Swords} title={t('statsInsights.pool.title')} desc={t('statsInsights.pool.desc')} />
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-hextech-text-dim">
                  <th className="pb-2 font-semibold">{t('statsInsights.pool.champion')}</th>
                  <th className="pb-2 text-right font-semibold">{t('statsInsights.pool.games')}</th>
                  <th className="pb-2 pl-4 font-semibold">{t('statsInsights.pool.winrate')}</th>
                  <th className="pb-2 text-right font-semibold">KDA</th>
                  <th className="pb-2 text-right font-semibold">CS/min</th>
                  <th className="pb-2 text-right font-semibold">{t('statsInsights.pool.deaths')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hextech-border-dim/40">
                {pool.slice(0, 8).map((row) => (
                  <tr key={row.champion} className="hover:bg-hextech-elevated/40">
                    <td className="py-2">
                      <span className="flex items-center gap-2">
                        <ChampIcon name={row.champion} />
                        <span className="font-medium text-hextech-text-bright">{championLabel(row.champion)}</span>
                      </span>
                    </td>
                    <td className="py-2 text-right font-mono text-hextech-text">{row.games}</td>
                    <td className="py-2 pl-4">
                      <WinrateBar winrate={row.winrate} dim={row.games < MIN_SAMPLE} />
                    </td>
                    <td className="py-2 text-right font-mono text-hextech-text-bright">{row.kda.toFixed(2)}</td>
                    <td className="py-2 text-right font-mono text-hextech-text">{row.csPerMin.toFixed(1)}</td>
                    <td className="py-2 text-right font-mono text-hextech-text">{row.avgDeaths.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className={cn(panel, 'xl:col-span-2')}>
          <Header icon={Scale} title={t('statsInsights.split.title')} desc={t('statsInsights.split.desc')} />
          {split ? (
            <div className="mt-3 space-y-2.5">
              <div className="grid grid-cols-[1fr_4.5rem_4.5rem] text-[10px] font-semibold uppercase tracking-wider text-hextech-text-dim">
                <span />
                <span className="text-right text-hextech-green">{t('statsInsights.split.wins')}</span>
                <span className="text-right text-hextech-red">{t('statsInsights.split.losses')}</span>
              </div>
              {split.map((m) => <SplitRow key={m.key} m={m} highlight={lever?.key === m.key} />)}
            </div>
          ) : (
            <p className="mt-6 text-center text-xs text-hextech-text-dim">{t('statsInsights.notEnoughSide')}</p>
          )}
        </section>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section className={panel}>
          <Header icon={Timer} title={t('statsInsights.duration.title')} desc={t('statsInsights.duration.desc')} />
          <BucketList buckets={winrateByDuration(games)} labelKey="statsInsights.duration" />
        </section>
        <section className={panel}>
          <Header icon={Sun} title={t('statsInsights.daypart.title')} desc={t('statsInsights.daypart.desc')} />
          <BucketList buckets={winrateByDaypart(games)} labelKey="statsInsights.daypart" />
          <LowEnergyPrompt context="daypart" history={games} />
        </section>
        <section className={panel}>
          <Header icon={Brain} title={t('statsInsights.tilt.title')} desc={t('statsInsights.tilt.desc')} />
          <BucketList buckets={[tilt.afterWin, tilt.afterLoss]} labelKey="statsInsights.tilt" />
          <p className="mt-3 text-[11px] text-hextech-text-dim">
            {t('statsInsights.tilt.streak', { count: tilt.longestLossStreak })}
          </p>
          <LowEnergyPrompt context="tilt" history={games} />
        </section>
      </div>
    </div>
  )
}

/** The 1–3 sentences worth reading even if the user skips the rest. */
function KeyTakeaways({ lever, tilt, pool }: { lever: SplitMetric | null; tilt: ReturnType<typeof tiltReport>; pool: ReturnType<typeof championPool> }) {
  const { t } = useTranslation()
  const lines: string[] = []
  if (lever) {
    lines.push(t(`statsInsights.takeaway.lever.${lever.key}`, { wins: fmt(lever.wins), losses: fmt(lever.losses) }))
  }
  if (tilt.afterLoss.enough && tilt.afterWin.enough && tilt.afterWin.winrate - tilt.afterLoss.winrate >= 15) {
    lines.push(t('statsInsights.takeaway.tilt', { afterLoss: tilt.afterLoss.winrate, afterWin: tilt.afterWin.winrate }))
  }
  // A "best pick" claim needs more than the generic minimum sample.
  const best = pool.filter((r) => r.games >= 5).sort((a, b) => b.winrate - a.winrate)[0]
  if (best && best.winrate >= 55) lines.push(t('statsInsights.takeaway.best', { champion: championLabel(best.champion), wr: best.winrate, count: best.games }))
  if (lines.length === 0) return null

  return (
    <section className="rounded-2xl border border-hextech-gold/30 bg-gradient-to-r from-hextech-gold/10 via-hextech-dark/85 to-hextech-dark/85 p-4 backdrop-blur-sm">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-hextech-gold-bright">
        <Lightbulb className="h-4 w-4" /> {t('statsInsights.takeaway.title')}
      </h3>
      <ul className="space-y-1.5">
        {lines.map((l) => (
          <li key={l} className="flex gap-2 text-sm text-hextech-text-bright">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-hextech-gold" />
            {l}
          </li>
        ))}
      </ul>
    </section>
  )
}

function fmt(v: number) {
  return v.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}

function Header({ icon: Icon, title, desc }: { icon: any; title: string; desc: string }) {
  return (
    <div>
      <h3 className="flex items-center gap-2 text-sm font-bold text-hextech-text-bright">
        <Icon className="h-4 w-4 text-hextech-gold" /> {title}
      </h3>
      <p className="mt-0.5 text-[11px] text-hextech-text-dim">{desc}</p>
    </div>
  )
}

function WinrateBar({ winrate, dim }: { winrate: number; dim?: boolean }) {
  return (
    <div className={cn('flex items-center gap-2', dim && 'opacity-50')}>
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-hextech-red/30">
        <div className="h-full rounded-full bg-hextech-green" style={{ width: `${winrate}%` }} />
      </div>
      <span className={cn('w-9 font-mono font-semibold', winrate >= 50 ? 'text-hextech-green' : 'text-hextech-red')}>{winrate}%</span>
    </div>
  )
}

function SplitRow({ m, highlight }: { m: SplitMetric; highlight: boolean }) {
  const { t } = useTranslation()
  // Compare what is displayed (1 decimal) so an on-screen tie is never red.
  const w = Number(m.wins.toFixed(1))
  const l = Number(m.losses.toFixed(1))
  const lossWorse = m.higherIsBetter ? l < w : l > w
  return (
    <div className={cn('grid grid-cols-[1fr_4.5rem_4.5rem] items-center rounded-lg px-2 py-1.5 text-xs', highlight && 'border border-hextech-gold/40 bg-hextech-gold/10')}>
      <span className="text-hextech-text">{t(`statsInsights.split.metric.${m.key}`)}</span>
      <span className="text-right font-mono text-hextech-text-bright">{fmt(m.wins)}</span>
      <span className={cn('text-right font-mono', lossWorse && m.key !== 'duration' ? 'text-hextech-red' : 'text-hextech-text-bright')}>{fmt(m.losses)}</span>
    </div>
  )
}

function BucketList({ buckets, labelKey }: { buckets: Bucket[]; labelKey: string }) {
  const { t } = useTranslation()
  return (
    <div className="mt-3 space-y-2">
      {buckets.map((b) => (
        <div key={b.key} className={cn('flex items-center justify-between gap-2 text-xs', !b.enough && 'opacity-45')}>
          <span className="min-w-0 truncate text-hextech-text">
            {t(`${labelKey}.${b.key}`)}
            <span className="ml-1.5 text-[10px] text-hextech-text-dim">({t('statsInsights.gamesShort', { count: b.games })})</span>
          </span>
          {b.games > 0 ? <WinrateBar winrate={b.winrate} /> : <span className="text-hextech-text-dim">—</span>}
        </div>
      ))}
    </div>
  )
}

function ChampIcon({ name }: { name: string }) {
  const url = useChampionIconUrl(name)
  const [err, setErr] = useState(false)
  if (!url || err) {
    return <span className="flex h-6 w-6 items-center justify-center rounded-full bg-hextech-elevated"><Shield className="h-3 w-3 text-hextech-text-dim" /></span>
  }
  return <img src={url} alt="" onError={() => setErr(true)} className="h-6 w-6 rounded-full border border-hextech-border-dim object-cover" />
}
