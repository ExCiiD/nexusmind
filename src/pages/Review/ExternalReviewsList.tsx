import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
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
  const { t, i18n } = useTranslation()
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

  const handleDelete = async (id: string) => {
    setDeletingId(id)
    try {
      await window.api.deleteExternalReview(id)
      setReviews((prev) => prev.filter((r) => r.id !== id))
      toast({ title: t('externalReview.list.deleted') })
    } catch {
      toast({ title: t('externalReview.list.deleteFailed'), variant: 'destructive' })
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
    new Date(iso).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short', year: 'numeric' })

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-hextech-gold" aria-label={t('common.loading')} />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-lg font-bold text-hextech-text-bright">{t('externalReview.list.title')}</h2>
          <p className="text-xs text-hextech-text-dim mt-0.5">{t('externalReview.list.count', { count: reviews.length })}</p>
        </div>
        <Button size="sm" onClick={onCreateNew} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" aria-hidden />
          {t('externalReview.list.new')}
        </Button>
      </div>

      {reviews.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-14 gap-3 rounded-xl border border-hextech-border-dim bg-hextech-elevated/30">
          <Film className="h-10 w-10 text-hextech-text-dim/40" aria-hidden />
          <p className="text-sm text-hextech-text-dim">{t('externalReview.list.empty')}</p>
          <Button variant="outline" size="sm" onClick={onCreateNew} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {t('externalReview.list.createFirst')}
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {reviews.map((review) => {
            const match = getMatchInfo(review.matchData)
            const objectiveLabels = getObjectiveLabels(review.objectiveIds)

            return (
              <div
                key={review.id}
                className="w-full flex items-center gap-2 rounded-xl border border-hextech-border-dim bg-hextech-elevated hover:border-hextech-gold/40 hover:bg-hextech-gold/5 transition-all pr-2 group"
              >
              <button
                type="button"
                onClick={() => navigate(`/external-review/${review.id}`)}
                className="flex-1 min-w-0 flex items-center gap-4 px-4 py-3.5 text-left rounded-xl focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {/* Win/loss bar or generic icon */}
                {match ? (
                  <div className={cn('w-1 h-10 rounded-full shrink-0', match.win ? 'bg-green-500' : 'bg-red-500')} aria-hidden />
                ) : (
                  <Film className="h-4 w-4 text-hextech-text-dim shrink-0" aria-hidden />
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
                <ChevronRight className="h-4 w-4 shrink-0 text-hextech-text-dim/40 group-hover:text-hextech-gold transition-colors" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => handleDelete(review.id)}
                disabled={deletingId === review.id}
                aria-label={t('externalReview.list.deleteAria', { title: review.title })}
                className="shrink-0 p-1.5 rounded text-hextech-text-dim/40 hover:text-[#E24C3A] hover:bg-[#E24C3A]/10 transition-colors opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {deletingId === review.id
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  : <Trash2 className="h-3.5 w-3.5" aria-hidden />}
              </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
