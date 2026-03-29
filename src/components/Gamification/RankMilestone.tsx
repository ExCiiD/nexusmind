import { useState, useEffect } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { TrendingUp, TrendingDown } from 'lucide-react'
import { getRankColor } from '@/lib/utils'

interface RankMilestoneProps {
  oldRank: string | null
  newRank: string
  scoreDeltas?: Record<string, number>
}

export function RankMilestone({ oldRank, newRank, scoreDeltas }: RankMilestoneProps) {
  const [aiMessage, setAiMessage] = useState<string | null>(null)

  const isPromotion = oldRank && rankValue(newRank) > rankValue(oldRank)
  const isDemotion = oldRank && rankValue(newRank) < rankValue(oldRank)

  useEffect(() => {
    if (oldRank && oldRank !== newRank && scoreDeltas) {
      window.api
        .synthesizeReview({
          timelineNotes: [],
          kpiScores: scoreDeltas,
          objective: `Rank change: ${oldRank} -> ${newRank}`,
        })
        .then(setAiMessage)
        .catch(() => {})
    }
  }, [oldRank, newRank, scoreDeltas])

  if (!oldRank || oldRank === newRank) return null

  return (
    <Card
      className={
        isPromotion
          ? 'border-hextech-green/30 bg-hextech-green/5 animate-fade-in'
          : 'border-hextech-border bg-hextech-dark animate-fade-in'
      }
    >
      <CardContent className="flex items-center gap-4 p-4">
        <div className="shrink-0">
          {isPromotion ? (
            <TrendingUp className="h-8 w-8 text-hextech-green" />
          ) : (
            <TrendingDown className="h-8 w-8 text-hextech-red" />
          )}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="font-display text-lg font-bold" style={{ color: getRankColor(oldRank.split(' ')[0]) }}>
              {oldRank}
            </span>
            <span className="text-hextech-text-dim">&rarr;</span>
            <span className="font-display text-lg font-bold" style={{ color: getRankColor(newRank.split(' ')[0]) }}>
              {newRank}
            </span>
          </div>
          {aiMessage && <p className="text-sm text-hextech-text mt-1">{aiMessage}</p>}
          {!aiMessage && isPromotion && (
            <p className="text-sm text-hextech-green mt-1">
              Congratulations on ranking up! Your hard work is paying off.
            </p>
          )}
          {!aiMessage && isDemotion && (
            <p className="text-sm text-hextech-text mt-1">
              Don't worry — focus on your fundamentals. The rank will follow.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function rankValue(rank: string): number {
  const tiers = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER']
  const divisions = ['IV', 'III', 'II', 'I']

  const parts = rank.toUpperCase().split(' ')
  const tierIdx = tiers.indexOf(parts[0]) * 4
  const divIdx = parts[1] ? divisions.indexOf(parts[1]) : 0

  return tierIdx + divIdx
}
