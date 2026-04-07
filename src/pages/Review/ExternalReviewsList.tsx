import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLocalizedFundamentals } from '@/lib/constants/useFundamentals'
import { formatGameTime, formatKDA } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { Loader2, Film, ChevronRight, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/useToast'

interface ExternalReview {
  id: string
  title: string
  objectiveIds: string
  playerName: string | null
  matchData: string | null
  filePath: string | null
  freeText: string | null
  createdAt: string
}

interface Props {
  onCreateNew: () => void
}

export function ExternalReviewsList({ onCreateNew }: Props) {
  const navigate = useNavigate()
  const { toast } = useToast()
  const categories = useLocalizedFundamentals()
  const allFundamentals = categories.flatMap((c) => c.fundamentals)

  const [reviews, setReviews] = useState<ExternalReview[]>([])
  const [loading, setLoading] = useState(true)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const load = async () => {
    try {
      const list = await window.api.listExternalReviews()
      setReviews(list ?? [])
    } catch {
      setReviews([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    setDeletingId(id)
    try {
      await window.api.deleteExternalReview(id)
      setReviews((prev) => prev.filter((r) => r.id !== id))
      toast({ title: 'Review deleted' })
    } catch {
      toast({ title: 'Failed to delete', variant: 'destructive' })
    } finally {
      setDeletingId(null)
    }
  }

  const getObjectiveLabels = (objectiveIds: string): string => {
    try {
      const ids: string[] = JSON.parse(objectiveIds)
      return ids
        .map((id) => allFundamentals.find((f) => f.id === id)?.label)
        .filter(Boolean)
        .join(' · ')
    } catch {
      return ''
    }
  }

  const getMatchInfo = (matchData: string | null) => {
    if (!matchData) return null
    try { return JSON.parse(matchData) } catch { return null }
  }

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-hextech-gold" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-lg font-bold text-hextech-text-bright">External Reviews</h2>
          <p className="text-xs text-hextech-text-dim mt-0.5">{reviews.length} review{reviews.length !== 1 ? 's' : ''} saved</p>
        </div>
        <Button size="sm" onClick={onCreateNew} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          New review
        </Button>
      </div>

      {reviews.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-14 gap-3 rounded-xl border border-hextech-border-dim bg-hextech-elevated/30">
          <Film className="h-10 w-10 text-hextech-text-dim/40" />
          <p className="text-sm text-hextech-text-dim">No external reviews yet</p>
          <Button variant="outline" size="sm" onClick={onCreateNew} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" />
            Create your first one
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {reviews.map((review) => {
            const match = getMatchInfo(review.matchData)
            const objectiveLabels = getObjectiveLabels(review.objectiveIds)

            return (
              <button
                key={review.id}
                onClick={() => navigate(`/external-review/${review.id}`)}
                className="w-full flex items-center gap-4 rounded-xl border border-hextech-border-dim bg-hextech-elevated hover:border-hextech-gold/40 hover:bg-hextech-gold/5 transition-all px-4 py-3.5 text-left group"
              >
                {/* Win/loss bar or generic icon */}
                {match ? (
                  <div className={cn('w-1 h-10 rounded-full shrink-0', match.win ? 'bg-green-500' : 'bg-red-500')} />
                ) : (
                  <Film className="h-4 w-4 text-hextech-text-dim shrink-0" />
                )}

                <div className="flex-1 min-w-0">
                  <p className="font-medium text-hextech-text-bright text-sm truncate">{review.title}</p>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    {review.playerName && (
                      <span className="text-[11px] text-hextech-text-dim">{review.playerName}</span>
                    )}
                    {match && (
                      <span className="text-[11px] text-hextech-text-dim">
                        {formatKDA(match.kills, match.deaths, match.assists)} · {formatGameTime(match.duration)}
                      </span>
                    )}
                    {objectiveLabels && (
                      <span className="text-[10px] rounded px-1.5 py-0.5 bg-hextech-gold/10 text-hextech-gold-bright font-medium">
                        {objectiveLabels}
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-hextech-text-dim/60 mt-0.5">{formatDate(review.createdAt)}</p>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={(e) => handleDelete(e, review.id)}
                    disabled={deletingId === review.id}
                    className="p-1.5 rounded text-hextech-text-dim/40 hover:text-[#FF4655] hover:bg-[#FF4655]/10 transition-colors opacity-0 group-hover:opacity-100"
                  >
                    {deletingId === review.id
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <Trash2 className="h-3.5 w-3.5" />}
                  </button>
                  <ChevronRight className="h-4 w-4 text-hextech-text-dim/40 group-hover:text-hextech-gold transition-colors" />
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
