import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Lightbulb, ChevronRight } from 'lucide-react'
import { useLocalizedFundamentals } from '@/lib/constants/useFundamentals'
import type { Fundamental } from '@/lib/constants/fundamentals'

interface Suggestion {
  id: string
  label: string
  assessmentScore: number
  reason: string
  isNew: boolean
}

interface ObjectiveSuggestionPanelProps {
  assessmentScores: Record<string, number>
  onAccept?: (fundamentalId: string) => void
}

/**
 * Builds a ranked list of objective suggestions using purely local data:
 * 1. Weakness (lower assessment score → higher priority)
 * 2. Recency penalty (used in last session → deprioritised)
 * 3. "New" flag if the objective was never worked on in any session
 * 4. High-deaths rule: Tempo is boosted to top priority when avg deaths >= 5
 */
function buildSuggestions(
  scores: Record<string, number>,
  allFundamentals: Fundamental[],
  kpiHistory: Array<{ objectiveIds: string[] }>,
  highDeathsWarning: boolean,
): Suggestion[] {
  const recentSessions = kpiHistory.slice(0, 5)

  return allFundamentals
    .filter((f) => scores[f.id] !== undefined)
    .map((f) => {
      const assessmentScore = scores[f.id]
      const weakness = (10 - assessmentScore) / 10

      const lastUsedIdx = recentSessions.findIndex((s) => s.objectiveIds.includes(f.id))
      const neverUsed = kpiHistory.every((s) => !s.objectiveIds.includes(f.id))

      let recencyFactor = 1.0
      if (lastUsedIdx === 0) recencyFactor = 0.3
      else if (lastUsedIdx <= 2) recencyFactor = 0.65
      else if (lastUsedIdx <= 4) recencyFactor = 0.85

      let priority = weakness * recencyFactor
      if (f.id === 'tempo' && highDeathsWarning) priority = 999

      let reason: string
      if (f.id === 'tempo' && highDeathsWarning) {
        reason = '⚠ Moy. ≥ 5 morts/partie — Régulation des morts recommandée'
      } else if (assessmentScore <= 3) {
        reason = `Score ${assessmentScore}/10 — faiblesse critique`
      } else if (assessmentScore <= 5) {
        reason = `Score ${assessmentScore}/10 — priorité d'amélioration`
      } else if (assessmentScore <= 7) {
        reason = `Score ${assessmentScore}/10 — marge de progression`
      } else {
        reason = `Score ${assessmentScore}/10 — maintien conseillé`
      }

      if (lastUsedIdx === 0 && f.id !== 'tempo') reason += ' · déjà travaillé la dernière session'
      else if (neverUsed && f.id !== 'tempo') reason += ' · jamais encore travaillé'

      return { id: f.id, label: f.label, assessmentScore, reason, priority, isNew: neverUsed }
    })
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 3)
    .map(({ id, label, assessmentScore, reason, isNew }) => ({ id, label, assessmentScore, reason, isNew }))
}

export function ObjectiveSuggestionPanel({ assessmentScores, onAccept }: ObjectiveSuggestionPanelProps) {
  const allFundamentals = useLocalizedFundamentals().flatMap((c) => c.fundamentals)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])

  useEffect(() => {
    if (Object.keys(assessmentScores).length === 0) return
    Promise.all([
      window.api.getKpiHistory().catch(() => [] as Array<{ objectiveIds: string[]; selectedKpiIds: string[] }>),
      window.api.getCoachingPatterns().catch(() => null),
    ]).then(([history, patterns]) => {
      setSuggestions(buildSuggestions(assessmentScores, allFundamentals, history, patterns?.highDeathsWarning ?? false))
    })
  }, [assessmentScores, allFundamentals.length])

  if (suggestions.length === 0) return null

  return (
    <Card className="border-hextech-teal/30 bg-hextech-blue/10">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Lightbulb className="h-4 w-4 text-hextech-cyan" />
          Objectifs suggérés
        </CardTitle>
        <p className="text-xs text-hextech-text-dim">
          Basé sur ton bilan d'évaluation et tes sessions récentes
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {suggestions.map((s) => (
          <div
            key={s.id}
            className="flex items-center justify-between gap-3 rounded-lg border border-hextech-border-dim bg-hextech-elevated px-3 py-2"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-hextech-text-bright">{s.label}</span>
                {s.isNew && (
                  <Badge variant="outline" className="text-[10px] border-hextech-cyan/40 text-hextech-cyan">
                    Jamais travaillé
                  </Badge>
                )}
              </div>
              <p className="text-xs text-hextech-text-dim mt-0.5">{s.reason}</p>
            </div>
            {onAccept && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onAccept(s.id)}
                className="shrink-0 gap-1 text-xs text-hextech-gold hover:bg-hextech-gold/10"
              >
                Choisir
                <ChevronRight className="h-3 w-3" />
              </Button>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
