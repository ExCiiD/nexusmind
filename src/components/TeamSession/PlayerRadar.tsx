import { useTranslation } from 'react-i18next'
import type { RadarAxis, RadarAxisKey } from '@/pages/TeamSessions/historyContract'

const UNIT: Partial<Record<RadarAxisKey, string>> = { kpPct: ' %' }
const fmt = (v: number | null | undefined, key: RadarAxisKey) => {
  if (v == null || !Number.isFinite(v)) return '—'
  const d = key === 'survival' ? 2 : Math.abs(v) >= 100 ? 0 : 1
  return `${v.toFixed(d)}${UNIT[key] ?? ''}`
}

/**
 * Player vs direct opponent radar (gold = player, dashed red = opponent). Hand-rolled SVG like FundamentalsRadarChart.
 * Scores are 0-100 relative to the better of the two on each axis (Back contract), the raw values are in the tooltip
 * and in the table under the chart, which is the accessible alternative (the SVG itself is aria-hidden).
 */
export function PlayerRadar({ axes, size = 260 }: { axes: RadarAxis[]; size?: number }) {
  const { t } = useTranslation()
  const n = axes.length
  if (n < 3) return <p className="text-xs text-hextech-text-dim">{t('teamSessions.detail.indiv.radarNoData')}</p>
  const label = (k: RadarAxisKey) => t(`teamSessions.detail.indiv.axis.${k}`)

  const c = size / 2
  const r = size * 0.34
  const pt = (i: number, score: number) => {
    const ang = (Math.PI * 2 * i) / n - Math.PI / 2
    const d = r * (Math.max(0, Math.min(100, score)) / 100)
    return [c + d * Math.cos(ang), c + d * Math.sin(ang)] as const
  }
  const poly = (key: 'player' | 'opponent') => axes.map((a, i) => pt(i, a[key]).map((v) => v.toFixed(1)).join(',')).join(' ')

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-4 text-[11px] text-hextech-text">
        <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 bg-hextech-gold" aria-hidden />{t('teamSessions.detail.indiv.radarPlayer')}</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed border-hextech-red" aria-hidden />{t('teamSessions.detail.indiv.radarOpponent')}</span>
      </div>
      <svg viewBox={`0 0 ${size} ${size}`} className="mx-auto w-full max-w-[320px] overflow-visible" aria-hidden>
        {[0.33, 0.66, 1].map((s, i) => <circle key={s} cx={c} cy={c} r={r * s} fill="none" stroke="rgba(255,255,255,0.09)" strokeDasharray={i === 2 ? undefined : '2 2'} />)}
        {axes.map((a, i) => {
          const ang = (Math.PI * 2 * i) / n - Math.PI / 2
          return (
            <g key={a.key}>
              <line x1={c} y1={c} x2={c + r * Math.cos(ang)} y2={c + r * Math.sin(ang)} stroke="rgba(255,255,255,0.1)" />
              <text x={c + (r + 18) * Math.cos(ang)} y={c + (r + 14) * Math.sin(ang)} textAnchor="middle" dominantBaseline="middle" className="fill-hextech-text-dim text-[9px] font-medium">{label(a.key)}</text>
            </g>
          )
        })}
        <polygon points={poly('opponent')} fill="rgba(200, 70, 70, 0.10)" stroke="rgb(200, 70, 70)" strokeWidth={1.5} strokeDasharray="4 3" />
        <polygon points={poly('player')} fill="rgba(212, 162, 76, 0.22)" stroke="#D4A24C" strokeWidth={2} />
        {axes.map((a, i) => {
          const [x, y] = pt(i, a.player)
          return <circle key={a.key} cx={x} cy={y} r={3.5} fill="#D4A24C"><title>{`${label(a.key)} — ${t('teamSessions.detail.indiv.radarPlayer')} ${fmt(a.playerRaw, a.key)} · ${t('teamSessions.detail.indiv.radarOpponent')} ${fmt(a.opponentRaw, a.key)}`}</title></circle>
        })}
      </svg>
      <details className="text-xs">
        <summary className="cursor-pointer rounded text-hextech-text-dim hover:text-hextech-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hextech-gold">{t('teamSessions.detail.indiv.radarTable')}</summary>
        <table className="mt-2 w-full">
          <thead className="text-[10px] uppercase tracking-wider text-hextech-text-dim">
            <tr>
              <th scope="col" className="px-2 py-1 text-left font-semibold">{t('teamSessions.detail.indiv.radarAxis')}</th>
              <th scope="col" className="px-2 py-1 text-right font-semibold text-hextech-gold">{t('teamSessions.detail.indiv.radarPlayer')}</th>
              <th scope="col" className="px-2 py-1 text-right font-semibold">{t('teamSessions.detail.indiv.radarOpponent')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hextech-border-dim/40">
            {axes.map((a) => (
              <tr key={a.key}>
                <th scope="row" className="px-2 py-1 text-left font-medium text-hextech-text">{label(a.key)}</th>
                <td className="px-2 py-1 text-right font-mono tabular-nums text-hextech-text-bright">{fmt(a.playerRaw, a.key)}</td>
                <td className="px-2 py-1 text-right font-mono tabular-nums text-hextech-text">{fmt(a.opponentRaw, a.key)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  )
}
