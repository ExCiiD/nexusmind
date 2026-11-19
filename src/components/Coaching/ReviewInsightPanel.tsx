import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { CheckCircle2, XCircle, TrendingUp, TrendingDown, MessageSquare, AlertCircle } from 'lucide-react'
import { useLocalizedFundamentalList } from '@/lib/constants/useFundamentals'
import { findKpiLabel } from '@/lib/fundamentals'
import type { Fundamental } from '@/lib/constants/fundamentals'
import { cn } from '@/lib/utils'

interface TimelineNote {
  time: string
  note: string
}

interface ReviewInsightPanelProps {
  objectiveRespected: boolean | null
  kpiScores: Record<string, number>
  timelineNotes: TimelineNote[]
  freeText: string
  objectiveLabel: string
  selectedKpiIds: string[]
}

interface InsightLine {
  icon: React.ComponentType<{ className?: string }>
  text: string
  variant: 'positive' | 'negative' | 'neutral' | 'warning'
}

/**
 * Generates deterministic review insight lines from structured review data.
 * No AI involved — all logic is rule-based and reproducible.
 */
function buildInsights(
  objectiveRespected: boolean | null,
  kpiScores: Record<string, number>,
  timelineNotes: TimelineNote[],
  freeText: string,
  objectiveLabel: string,
  selectedKpiIds: string[],
  allFundamentals: Fundamental[],
  t: TFunction,
): InsightLine[] {
  const lines: InsightLine[] = []

  // 1. Objective result
  if (objectiveRespected === true) {
    lines.push({
      icon: CheckCircle2,
      text: t('coaching.reviewInsight.objectiveMet', { objective: objectiveLabel }),
      variant: 'positive',
    })
  } else if (objectiveRespected === false) {
    lines.push({
      icon: XCircle,
      text: t('coaching.reviewInsight.objectiveMissed', { objective: objectiveLabel }),
      variant: 'negative',
    })
  }

  // 2. KPI analysis
  const filledKpis = Object.entries(kpiScores).filter(
    ([kpiId, score]) => selectedKpiIds.includes(kpiId) && typeof score === 'number' && score > 0,
  )

  if (filledKpis.length > 0) {
    const avg = filledKpis.reduce((sum, [, v]) => sum + v, 0) / filledKpis.length
    const avgRounded = Math.round(avg * 10) / 10

    const avgVariant: InsightLine['variant'] =
      avg >= 7 ? 'positive' : avg >= 5 ? 'neutral' : 'negative'

    lines.push({
      icon: avgVariant === 'positive' ? TrendingUp : avgVariant === 'negative' ? TrendingDown : MessageSquare,
      text: t('coaching.reviewInsight.kpiAverage', { avg: avgRounded, count: filledKpis.length }),
      variant: avgVariant,
    })

    // Best KPI(s)
    const sorted = [...filledKpis].sort(([, a], [, b]) => b - a)
    const best = sorted.filter(([, s]) => s >= 7).slice(0, 2)
    for (const [kpiId, score] of best) {
      lines.push({
        icon: TrendingUp,
        text: t('coaching.reviewInsight.strength', { kpi: findKpiLabel(kpiId, allFundamentals), score }),
        variant: 'positive',
      })
    }

    // Worst KPI(s)
    const worst = sorted.filter(([, s]) => s < 6).slice(-2).reverse()
    for (const [kpiId, score] of worst) {
      lines.push({
        icon: TrendingDown,
        text: t('coaching.reviewInsight.toImprove', { kpi: findKpiLabel(kpiId, allFundamentals), score }),
        variant: 'warning',
      })
    }
  } else if (selectedKpiIds.length > 0) {
    lines.push({
      icon: AlertCircle,
      text: t('coaching.reviewInsight.noKpi'),
      variant: 'warning',
    })
  }

  // 3. Timeline notes
  if (timelineNotes.length >= 3) {
    lines.push({
      icon: MessageSquare,
      text: t('coaching.reviewInsight.manyNotes', { count: timelineNotes.length }),
      variant: 'positive',
    })
  } else if (timelineNotes.length === 0) {
    lines.push({
      icon: AlertCircle,
      text: t('coaching.reviewInsight.noNotes'),
      variant: 'neutral',
    })
  }

  // 4. Free text presence
  if (freeText.trim().length > 20) {
    lines.push({
      icon: CheckCircle2,
      text: t('coaching.reviewInsight.conclusionWritten'),
      variant: 'positive',
    })
  }

  return lines
}

const variantStyles: Record<InsightLine['variant'], string> = {
  positive: 'text-hextech-green',
  negative: 'text-hextech-red',
  neutral: 'text-hextech-text-dim',
  warning: 'text-hextech-gold',
}

export function ReviewInsightPanel({
  objectiveRespected,
  kpiScores,
  timelineNotes,
  freeText,
  objectiveLabel,
  selectedKpiIds,
}: ReviewInsightPanelProps) {
  const { t } = useTranslation()
  const allFundamentals = useLocalizedFundamentalList()

  const insights = useMemo(
    () =>
      buildInsights(
        objectiveRespected,
        kpiScores,
        timelineNotes,
        freeText,
        objectiveLabel,
        selectedKpiIds,
        allFundamentals,
        t,
      ),
    [objectiveRespected, kpiScores, timelineNotes, freeText, objectiveLabel, selectedKpiIds, allFundamentals, t],
  )

  if (insights.length === 0) return null

  return (
    <Card className="border-hextech-cyan/20 bg-gradient-to-b from-hextech-blue/10 to-hextech-blue/10">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-hextech-cyan" aria-hidden />
          {t('coaching.reviewInsight.title')}
        </CardTitle>
        <p className="text-xs text-hextech-text-dim">{t('coaching.reviewInsight.subtitle')}</p>
      </CardHeader>
      <CardContent className="space-y-2">
        {insights.map((line, i) => {
          const Icon = line.icon
          return (
            <div key={i} className="flex items-start gap-2">
              <Icon className={cn('h-4 w-4 mt-0.5 shrink-0', variantStyles[line.variant])} aria-hidden />
              <p className={cn('text-sm', variantStyles[line.variant])}>{line.text}</p>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
