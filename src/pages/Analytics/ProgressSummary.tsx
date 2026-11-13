import { useTranslation } from 'react-i18next'
import { ArrowDownRight, ArrowUpRight, Minus, Target, Trophy } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

interface Props {
  latest: Record<string, number>
  previous: Record<string, number>
  labelOf: (id: string) => string
  latestDate: string | null
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

/**
 * "Where I stand", read in 5 seconds: average level, change since the
 * previous assessment, strengths, areas to work on and biggest moves.
 * Built only from the assessment data the page already loads.
 */
export function ProgressSummary({ latest, previous, labelOf, latestDate }: Props) {
  const { t, i18n } = useTranslation()
  const ids = Object.keys(latest)
  if (ids.length === 0) return null

  const mean = avg(ids.map((id) => latest[id]))!
  const comparable = ids.filter((id) => previous[id] != null)
  const prevMean = avg(comparable.map((id) => previous[id]))
  const curMeanComparable = avg(comparable.map((id) => latest[id]))
  const delta = prevMean != null && curMeanComparable != null ? curMeanComparable - prevMean : null

  // Top and bottom of the ranking, never overlapping when few fundamentals are assessed.
  const sorted = [...ids].sort((a, b) => latest[b] - latest[a])
  const strengths = sorted.slice(0, Math.min(3, Math.ceil(sorted.length / 2)))
  const weaknesses = sorted.slice(sorted.length - Math.min(3, Math.floor(sorted.length / 2))).reverse()
  const moves = comparable
    .map((id) => ({ id, d: latest[id] - previous[id] }))
    .filter((m) => Math.abs(m.d) >= 0.25)
    .sort((a, b) => b.d - a.d)
  const up = moves.filter((m) => m.d > 0).slice(0, 2)
  const down = moves.filter((m) => m.d < 0).slice(-2).reverse()

  const fmt = (n: number) => n.toFixed(1)

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{t('analytics.summary.title')}</CardTitle>
        {latestDate && (
          <p className="text-xs text-hextech-text-dim">
            {t('analytics.summary.basedOn', { date: new Date(latestDate).toLocaleDateString(i18n.language) })}
          </p>
        )}
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-4">
        <div className="rounded-lg bg-hextech-elevated/40 p-3">
          <div className="text-xs text-hextech-text-dim">{t('analytics.summary.average')}</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-hextech-gold-bright">{fmt(mean)}</span>
            <span className="text-sm text-hextech-text-dim">/ 5</span>
          </div>
          {delta != null && (
            <div className={cn('mt-1 flex items-center gap-1 text-xs',
              delta > 0.05 ? 'text-hextech-green' : delta < -0.05 ? 'text-[#E24C3A]' : 'text-hextech-text-dim')}>
              {delta > 0.05 ? <ArrowUpRight className="h-3.5 w-3.5" /> : delta < -0.05 ? <ArrowDownRight className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
              {t('analytics.summary.sincePrevious', { delta: `${delta > 0 ? '+' : ''}${fmt(delta)}` })}
            </div>
          )}
        </div>

        <SummaryList icon={<Trophy className="h-3.5 w-3.5 text-hextech-gold" />} title={t('analytics.summary.strengths')}
          items={strengths.map((id) => ({ id, label: labelOf(id), value: fmt(latest[id]) }))} />
        <SummaryList icon={<Target className="h-3.5 w-3.5 text-hextech-cyan" />} title={t('analytics.summary.toWork')}
          items={weaknesses.map((id) => ({ id, label: labelOf(id), value: fmt(latest[id]) }))} />

        <div className="space-y-1.5">
          <div className="text-xs font-medium text-hextech-text-bright">{t('analytics.summary.moves')}</div>
          {up.length === 0 && down.length === 0 ? (
            <p className="text-xs text-hextech-text-dim">{comparable.length ? t('analytics.summary.stable') : t('analytics.summary.firstAssessment')}</p>
          ) : (
            <ul className="space-y-1 text-xs">
              {up.map((m) => (
                <li key={m.id} className="flex justify-between gap-2"><span className="truncate">{labelOf(m.id)}</span><span className="text-hextech-green">+{fmt(m.d)}</span></li>
              ))}
              {down.map((m) => (
                <li key={m.id} className="flex justify-between gap-2"><span className="truncate">{labelOf(m.id)}</span><span className="text-[#E24C3A]">{fmt(m.d)}</span></li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function SummaryList({ icon, title, items }: { icon: React.ReactNode; title: string; items: Array<{ id: string; label: string; value: string }> }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-xs font-medium text-hextech-text-bright">{icon}{title}</div>
      <ul className="space-y-1 text-xs">
        {items.map((i) => (
          <li key={i.id} className="flex justify-between gap-2"><span className="truncate">{i.label}</span><span className="text-hextech-text-dim">{i.value}</span></li>
        ))}
      </ul>
    </div>
  )
}
