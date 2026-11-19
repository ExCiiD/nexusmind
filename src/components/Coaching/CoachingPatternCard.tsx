import { useEffect, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { AlertTriangle, Repeat, BarChart2, CheckCircle2 } from 'lucide-react'
import { useLocalizedFundamentalList } from '@/lib/constants/useFundamentals'
import { findFundamentalLabel, findKpiLabel } from '@/lib/fundamentals'
import type { CoachingPatterns } from '@/lib/ipc'
import { cn } from '@/lib/utils'

/**
 * Displays deterministic coaching patterns derived from the last 10 sessions.
 * Shown on the Dashboard as a persistent coaching insight widget.
 */
export function CoachingPatternCard() {
  const { t } = useTranslation()
  const allFundamentals = useLocalizedFundamentalList()
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
    <Card className="border-hextech-gold/20 bg-gradient-to-b from-hextech-gold/5 to-hextech-gold/5">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <BarChart2 className="h-4 w-4 text-hextech-gold" aria-hidden />
          {t('coaching.patterns.title')}
        </CardTitle>
        <p className="text-xs text-hextech-text-dim">
          {t('coaching.patterns.subtitle', { count: patterns.totalSessionsAnalyzed })}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Recurring weak KPIs */}
        {hasWeakKpis && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-hextech-gold flex items-center gap-1.5">
              <AlertTriangle className="h-3 w-3" aria-hidden />
              {t('coaching.patterns.weakKpis')}
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
                    {t('coaching.patterns.via', { objective: findFundamentalLabel(kpi.objectiveId, allFundamentals) })}
                  </span>
                </div>
                <span
                  className={cn(
                    'text-xs font-semibold tabular-nums shrink-0 ml-2',
                    kpi.avgScore < 4 ? 'text-hextech-red' : 'text-hextech-gold',
                  )}
                >
                  {t('coaching.patterns.kpiScore', { score: kpi.avgScore, count: kpi.sessionCount })}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Most repeated objective */}
        {hasRepeatedObjective && patterns.mostRepeatedObjective && (
          <div className="flex items-start gap-2">
            <Repeat className="h-4 w-4 text-hextech-cyan shrink-0 mt-0.5" aria-hidden />
            <p className="text-sm text-hextech-text">
              <Trans
                i18nKey="coaching.patterns.mostRepeated"
                values={{
                  objective: findFundamentalLabel(patterns.mostRepeatedObjective.objectiveId, allFundamentals),
                  count: patterns.mostRepeatedObjective.count,
                }}
                components={{ b: <span className="font-semibold text-hextech-text-bright" />, dim: <span className="text-hextech-text-dim" /> }}
              />
            </p>
          </div>
        )}

        {/* High deaths warning */}
        {hasHighDeaths && (
          <div className="flex items-start gap-2 rounded-md border border-hextech-red/30 bg-hextech-red/5 px-3 py-2">
            <AlertTriangle className="h-4 w-4 text-hextech-red shrink-0 mt-0.5" aria-hidden />
            <p className="text-sm text-hextech-text">
              <Trans
                i18nKey="coaching.patterns.highDeaths"
                values={{ deaths: patterns.avgDeathsRecent }}
                components={{ red: <span className="font-semibold text-hextech-red" />, gold: <span className="font-semibold text-hextech-gold" /> }}
              />
            </p>
          </div>
        )}

        {/* Low review completion rate */}
        {lowCompletionRate ? (
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-hextech-gold shrink-0 mt-0.5" aria-hidden />
            <p className="text-sm text-hextech-text">
              <Trans
                i18nKey="coaching.patterns.reviewRateLow"
                values={{ rate: patterns.reviewCompletionRate }}
                components={{ red: <span className="font-semibold text-hextech-red" /> }}
              />
            </p>
          </div>
        ) : (
          <div className="flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 text-hextech-green shrink-0 mt-0.5" aria-hidden />
            <p className="text-sm text-hextech-text">
              <Trans
                i18nKey="coaching.patterns.reviewRate"
                values={{ rate: patterns.reviewCompletionRate }}
                components={{ green: <span className="font-semibold text-hextech-green" /> }}
              />
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
