import { useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { CheckCircle2, XCircle, TrendingUp, TrendingDown, MessageSquare, AlertCircle } from 'lucide-react'
import { useLocalizedFundamentals } from '@/lib/constants/useFundamentals'
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

/** Finds the label of a KPI ID across all fundamentals */
function findKpiLabel(kpiId: string, allFundamentals: Fundamental[]): string {
  for (const f of allFundamentals) {
    const match = f.kpis.find((k) => k.id === kpiId)
    if (match) return match.label
  }
  return kpiId
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
): InsightLine[] {
  const lines: InsightLine[] = []

  // 1. Objective result
  if (objectiveRespected === true) {
    lines.push({
      icon: CheckCircle2,
      text: `Objectif "${objectiveLabel}" respecté`,
      variant: 'positive',
    })
  } else if (objectiveRespected === false) {
    lines.push({
      icon: XCircle,
      text: `Objectif "${objectiveLabel}" non respecté`,
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
      text: `Moyenne KPI : ${avgRounded}/10 sur ${filledKpis.length} KPI noté${filledKpis.length > 1 ? 's' : ''}`,
      variant: avgVariant,
    })

    // Best KPI(s)
    const sorted = [...filledKpis].sort(([, a], [, b]) => b - a)
    const best = sorted.filter(([, s]) => s >= 7).slice(0, 2)
    for (const [kpiId, score] of best) {
      lines.push({
        icon: TrendingUp,
        text: `Point fort : ${findKpiLabel(kpiId, allFundamentals)} (${score}/10)`,
        variant: 'positive',
      })
    }

    // Worst KPI(s)
    const worst = sorted.filter(([, s]) => s < 6).slice(-2).reverse()
    for (const [kpiId, score] of worst) {
      lines.push({
        icon: TrendingDown,
        text: `À améliorer : ${findKpiLabel(kpiId, allFundamentals)} (${score}/10)`,
        variant: 'warning',
      })
    }
  } else if (selectedKpiIds.length > 0) {
    lines.push({
      icon: AlertCircle,
      text: 'Aucun KPI noté — pense à remplir tes scores pour suivre ta progression',
      variant: 'warning',
    })
  }

  // 3. Timeline notes
  if (timelineNotes.length >= 3) {
    lines.push({
      icon: MessageSquare,
      text: `${timelineNotes.length} note${timelineNotes.length > 1 ? 's' : ''} de timeline — bonne granularité d'analyse`,
      variant: 'positive',
    })
  } else if (timelineNotes.length === 0) {
    lines.push({
      icon: AlertCircle,
      text: 'Pas de notes sur la timeline — ajoute des observations pendant la vidéo',
      variant: 'neutral',
    })
  }

  // 4. Free text presence
  if (freeText.trim().length > 20) {
    lines.push({
      icon: CheckCircle2,
      text: 'Conclusion libre rédigée',
      variant: 'positive',
    })
  }

  return lines
}

const variantStyles: Record<InsightLine['variant'], string> = {
  positive: 'text-hextech-green',
  negative: 'text-[#FF4655]',
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
  const allFundamentals = useLocalizedFundamentals().flatMap((c) => c.fundamentals)

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
      ),
    [objectiveRespected, kpiScores, timelineNotes, freeText, objectiveLabel, selectedKpiIds],
  )

  if (insights.length === 0) return null

  return (
    <Card className="border-hextech-cyan/20 bg-hextech-blue/10">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-hextech-cyan" />
          Analyse de la review
        </CardTitle>
        <p className="text-xs text-hextech-text-dim">Synthèse automatique basée sur tes données</p>
      </CardHeader>
      <CardContent className="space-y-2">
        {insights.map((line, i) => {
          const Icon = line.icon
          return (
            <div key={i} className="flex items-start gap-2">
              <Icon className={cn('h-4 w-4 mt-0.5 shrink-0', variantStyles[line.variant])} />
              <p className={cn('text-sm', variantStyles[line.variant])}>{line.text}</p>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
