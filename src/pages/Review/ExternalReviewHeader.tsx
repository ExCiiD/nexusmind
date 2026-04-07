import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ChampionMatchup } from '@/components/ChampionMatchup'
import { useLocalizedFundamentals } from '@/lib/constants/useFundamentals'
import { formatGameTime, formatKDA } from '@/lib/utils'
import { ArrowLeft, Trash2, Clock, Target } from 'lucide-react'
import { Swords as SwordsIcon } from 'lucide-react'

interface Props {
  review: {
    title: string
    objectiveId: string | null
    objectiveIds?: string | null
    playerName: string | null
    matchData: string | null
    createdAt: string
  }
  onDelete: () => void
}

function StatPill({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="rounded-lg bg-hextech-elevated border border-hextech-border-dim p-3 text-center">
      <Icon className="h-4 w-4 mx-auto text-hextech-gold mb-1" />
      <div className="text-sm font-semibold text-hextech-text-bright">{value}</div>
      <div className="text-xs text-hextech-text-dim">{label}</div>
    </div>
  )
}

export function ExternalReviewHeader({ review, onDelete }: Props) {
  const navigate = useNavigate()
  const categories = useLocalizedFundamentals()
  const allFundamentals = categories.flatMap((c) => c.fundamentals)

  let objectiveIds: string[] = []
  try { objectiveIds = JSON.parse(review.objectiveIds ?? '[]') } catch { if (review.objectiveId) objectiveIds = [review.objectiveId] }
  const objectiveLabels = objectiveIds.map((id) => allFundamentals.find((f) => f.id === id)?.label).filter(Boolean)

  let matchData: any = null
  if (review.matchData) {
    try { matchData = JSON.parse(review.matchData) } catch { /* ignore */ }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-2 min-w-0">
          <Button variant="ghost" size="sm" onClick={() => navigate('/review')} className="shrink-0 -ml-2">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0">
            <h1 className="font-display text-2xl font-bold text-hextech-gold-bright truncate">{review.title}</h1>
            {objectiveLabels.length > 0 && (
              <p className="text-sm text-hextech-text mt-0.5">
                Objective: <span className="text-hextech-gold">{objectiveLabels.join(' · ')}</span>
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {matchData && (
            <Badge variant={matchData.win ? 'success' : 'destructive'}>
              {matchData.win ? 'Victory' : 'Defeat'}
            </Badge>
          )}
          <Button variant="ghost" size="sm" onClick={onDelete} className="text-hextech-text-dim hover:text-[#FF4655]">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {matchData && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <ChampionMatchup
              playerChampion={matchData.champion}
              opponentChampion={matchData.opponentChampion}
              size="lg"
            />
            <div>
              <p className="text-sm font-medium text-hextech-text-bright">{matchData.champion}</p>
              {review.playerName && (
                <p className="text-xs text-hextech-text-dim">{review.playerName}</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatPill icon={SwordsIcon} label="KDA" value={formatKDA(matchData.kills, matchData.deaths, matchData.assists)} />
            <StatPill icon={Target} label="CS" value={String(matchData.cs ?? 0)} />
            <StatPill icon={SwordsIcon} label="Vision" value={String(matchData.visionScore ?? 0)} />
            <StatPill icon={Clock} label="Duration" value={formatGameTime(matchData.duration)} />
          </div>
        </div>
      )}
    </div>
  )
}
