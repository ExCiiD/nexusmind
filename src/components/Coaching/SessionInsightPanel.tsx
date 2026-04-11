import { useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { BarChart3, CheckCircle2, Clock, TrendingUp, TrendingDown, AlertCircle } from 'lucide-react'
import { useLocalizedFundamentals } from '@/lib/constants/useFundamentals'
import { cn } from '@/lib/utils'

interface Review {
  kpiScores: string
  objectiveRespected: boolean
}

interface Game {
  id: string
  win: boolean
  kills: number
  deaths: number
  assists: number
  reviewStatus: 'pending' | 'to_be_reviewed' | 'reviewed'
  review: Review | null
}

interface SessionInsightPanelProps {
  games: Game[]
  objectiveIds: string
  selectedKpiIds: string
}

interface InsightLine {
  icon: React.ComponentType<{ className?: string }>
  text: string
  variant: 'positive' | 'negative' | 'neutral' | 'warning'
}

const variantStyles: Record<InsightLine['variant'], string> = {
  positive: 'text-hextech-green',
  negative: 'text-[#FF4655]',
  neutral: 'text-hextech-text-dim',
  warning: 'text-hextech-gold',
}

/**
 * Builds live coaching insights from the current active session's game data.
 * All computations are deterministic and run client-side without any external call.
 */
function buildSessionInsights(games: Game[], objectiveIds: string[]): InsightLine[] {
  const counted = games.filter((g) => g.reviewStatus !== 'to_be_reviewed')
  if (counted.length === 0) return []

  const lines: InsightLine[] = []

  // Win/loss ratio
  const wins = counted.filter((g) => g.win).length
  const losses = counted.length - wins
  const wr = Math.round((wins / counted.length) * 100)
  lines.push({
    icon: wr >= 50 ? TrendingUp : TrendingDown,
    text: `${wins}W ${losses}L — ${wr}% de winrate sur la session`,
    variant: wr >= 50 ? 'positive' : 'negative',
  })

  // Review completion
  const reviewed = counted.filter((g) => g.review !== null).length
  const pending = counted.length - reviewed
  if (reviewed === counted.length && reviewed > 0) {
    lines.push({
      icon: CheckCircle2,
      text: `Toutes les parties ont été reviewées (${reviewed}/${counted.length})`,
      variant: 'positive',
    })
  } else if (pending > 0) {
    lines.push({
      icon: AlertCircle,
      text: `${pending} partie${pending > 1 ? 's' : ''} en attente de review`,
      variant: 'warning',
    })
  }

  // KPI averages from all reviews in this session
  const allKpiScores: number[] = []
  let objectiveRespectedCount = 0
  let reviewsWithObjectiveFlag = 0

  for (const game of counted) {
    if (!game.review) continue
    reviewsWithObjectiveFlag++
    if (game.review.objectiveRespected) objectiveRespectedCount++
    try {
      const map: Record<string, number> = JSON.parse(game.review.kpiScores)
      const vals = Object.values(map).filter((v) => typeof v === 'number' && v > 0)
      allKpiScores.push(...vals)
    } catch { /* ignore */ }
  }

  if (allKpiScores.length > 0) {
    const avg = allKpiScores.reduce((a, b) => a + b, 0) / allKpiScores.length
    const avgRounded = Math.round(avg * 10) / 10
    lines.push({
      icon: BarChart3,
      text: `Moyenne KPI de la session : ${avgRounded}/10`,
      variant: avg >= 7 ? 'positive' : avg >= 5 ? 'neutral' : 'negative',
    })
  }

  // Objective respect rate
  if (reviewsWithObjectiveFlag > 0) {
    const rate = Math.round((objectiveRespectedCount / reviewsWithObjectiveFlag) * 100)
    lines.push({
      icon: rate >= 60 ? CheckCircle2 : AlertCircle,
      text: `Objectif respecté dans ${rate}% des parties reviewées`,
      variant: rate >= 60 ? 'positive' : rate >= 40 ? 'warning' : 'negative',
    })
  }

  // Encourage more reviews if session is mid-way
  if (counted.length >= 3 && reviewed < counted.length * 0.5) {
    lines.push({
      icon: Clock,
      text: 'Moins de la moitié des parties sont reviewées — n\'oublie pas de remplir tes reviews',
      variant: 'neutral',
    })
  }

  return lines
}

export function SessionInsightPanel({ games, objectiveIds, selectedKpiIds }: SessionInsightPanelProps) {
  const parsedObjectiveIds = useMemo(() => {
    try { return JSON.parse(objectiveIds) as string[] } catch { return [objectiveIds] }
  }, [objectiveIds])

  const allFundamentals = useLocalizedFundamentals().flatMap((c) => c.fundamentals)

  const objectiveLabels = parsedObjectiveIds
    .map((id) => allFundamentals.find((f) => f.id === id)?.label ?? id)
    .join(', ')

  const insights = useMemo(
    () => buildSessionInsights(games, parsedObjectiveIds),
    [games, parsedObjectiveIds],
  )

  if (insights.length === 0) return null

  return (
    <Card className="border-hextech-cyan/20 bg-hextech-blue/10">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-hextech-cyan" />
          Bilan en cours
        </CardTitle>
        <p className="text-xs text-hextech-text-dim">
          Session · {objectiveLabels}
        </p>
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
