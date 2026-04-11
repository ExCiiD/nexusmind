import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { AlertTriangle, Repeat, BarChart2, CheckCircle2 } from 'lucide-react'
import { useLocalizedFundamentals } from '@/lib/constants/useFundamentals'
import type { CoachingPatterns } from '@/lib/ipc'
import type { Fundamental } from '@/lib/constants/fundamentals'
import { cn } from '@/lib/utils'

function findKpiLabel(kpiId: string, allFundamentals: Fundamental[]): string {
  for (const f of allFundamentals) {
    const match = f.kpis.find((k) => k.id === kpiId)
    if (match) return match.label
  }
  return kpiId
}

function findFundamentalLabel(id: string, allFundamentals: Fundamental[]): string {
  return allFundamentals.find((f) => f.id === id)?.label ?? id
}

/**
 * Displays deterministic coaching patterns derived from the last 10 sessions.
 * Shown on the Dashboard as a persistent coaching insight widget.
 */
export function CoachingPatternCard() {
  const allFundamentals = useLocalizedFundamentals().flatMap((c) => c.fundamentals)
  const [patterns, setPatterns] = useState<CoachingPatterns | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    window.api.getCoachingPatterns()
      .then(setPatterns)
      .catch(() => setPatterns(null))
      .finally(() => setLoading(false))
  }, [])

  if (loading || !patterns || patterns.totalSessionsAnalyzed < 2) return null

  const hasWeakKpis = patterns.weakKpis.length > 0
  const hasRepeatedObjective =
    patterns.mostRepeatedObjective && patterns.mostRepeatedObjective.count >= 3
  const lowCompletionRate = patterns.reviewCompletionRate < 60
  const hasHighDeaths = patterns.highDeathsWarning

  if (!hasWeakKpis && !hasRepeatedObjective && !lowCompletionRate && !hasHighDeaths) return null

  return (
    <Card className="border-hextech-gold/20 bg-hextech-gold/5">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <BarChart2 className="h-4 w-4 text-hextech-gold" />
          Patterns détectés
        </CardTitle>
        <p className="text-xs text-hextech-text-dim">
          Analyse des {patterns.totalSessionsAnalyzed} dernières sessions
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Recurring weak KPIs */}
        {hasWeakKpis && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-hextech-gold flex items-center gap-1.5">
              <AlertTriangle className="h-3 w-3" />
              KPIs faibles récurrents
            </p>
            {patterns.weakKpis.map((kpi) => (
              <div
                key={kpi.kpiId}
                className="flex items-center justify-between rounded-md bg-hextech-elevated px-3 py-1.5"
              >
                <div className="min-w-0">
                  <span className="text-sm text-hextech-text-bright">
                    {findKpiLabel(kpi.kpiId, allFundamentals)}
                  </span>
                  <span className="ml-2 text-xs text-hextech-text-dim">
                    via {findFundamentalLabel(kpi.objectiveId, allFundamentals)}
                  </span>
                </div>
                <span
                  className={cn(
                    'text-xs font-semibold tabular-nums shrink-0 ml-2',
                    kpi.avgScore < 4 ? 'text-[#FF4655]' : 'text-hextech-gold',
                  )}
                >
                  {kpi.avgScore}/10 · {kpi.sessionCount} sess.
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Most repeated objective */}
        {hasRepeatedObjective && patterns.mostRepeatedObjective && (
          <div className="flex items-start gap-2">
            <Repeat className="h-4 w-4 text-hextech-cyan shrink-0 mt-0.5" />
            <p className="text-sm text-hextech-text">
              Objectif le plus travaillé :{' '}
              <span className="font-semibold text-hextech-text-bright">
                {findFundamentalLabel(patterns.mostRepeatedObjective.objectiveId, allFundamentals)}
              </span>{' '}
              <span className="text-hextech-text-dim">
                ({patterns.mostRepeatedObjective.count} sessions)
              </span>
            </p>
          </div>
        )}

        {/* High deaths warning */}
        {hasHighDeaths && (
          <div className="flex items-start gap-2 rounded-md border border-[#FF4655]/30 bg-[#FF4655]/5 px-3 py-2">
            <AlertTriangle className="h-4 w-4 text-[#FF4655] shrink-0 mt-0.5" />
            <p className="text-sm text-hextech-text">
              Moy.{' '}
              <span className="font-semibold text-[#FF4655]">
                {patterns.avgDeathsRecent} morts/partie
              </span>
              {' '}sur tes 20 dernières games — travaille{' '}
              <span className="font-semibold text-hextech-gold">Régulation des morts</span>
              {' '}(objectif Tempo)
            </p>
          </div>
        )}

        {/* Low review completion rate */}
        {lowCompletionRate ? (
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-hextech-gold shrink-0 mt-0.5" />
            <p className="text-sm text-hextech-text">
              Taux de review :{' '}
              <span className="font-semibold text-[#FF4655]">
                {patterns.reviewCompletionRate}%
              </span>
              {' '}— pense à reviewer plus de parties pour des données précises
            </p>
          </div>
        ) : (
          <div className="flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 text-hextech-green shrink-0 mt-0.5" />
            <p className="text-sm text-hextech-text">
              Taux de review :{' '}
              <span className="font-semibold text-hextech-green">
                {patterns.reviewCompletionRate}%
              </span>
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
