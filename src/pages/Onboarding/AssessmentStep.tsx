import { useEffect, useState } from 'react'
import { FundamentalsGrid } from '@/components/FundamentalsMatrix/FundamentalsGrid'
import { useUserStore } from '@/store/useUserStore'
import { useToast } from '@/hooks/useToast'
import { Loader2, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useLocalizedFundamentals } from '@/lib/constants/useFundamentals'

export function AssessmentStep() {
  const { t } = useTranslation()
  const [scores, setScores] = useState<Record<string, number>>({})
  const [saving, setSaving] = useState(false)
  // Pre-filled from stats (lot 5): fundamentals the player hasn't touched yet,
  // so a manual edit always wins and is never silently overwritten.
  const [suggested, setSuggested] = useState<string[]>([])
  const allFundamentals = useLocalizedFundamentals().flatMap((c) => c.fundamentals)
  const objectiveLabel = (id: string) => allFundamentals.find((f) => f.id === id)?.label ?? id
  const loadUser = useUserStore((s) => s.loadUser)
  const { toast } = useToast()

  useEffect(() => {
    window.api.coachSuggestedScores?.()
      .then((rows) => {
        if (rows.length === 0) return
        setScores((prev) => {
          const next = { ...prev }
          for (const r of rows) if (!(r.fundamentalId in next)) next[r.fundamentalId] = r.score
          return next
        })
        setSuggested(rows.map((r) => r.fundamentalId))
      })
      .catch(() => {})
  }, [])

  const handleScoreChange = (fundamentalId: string, score: number) => {
    setScores((prev) => ({ ...prev, [fundamentalId]: score }))
    setSuggested((prev) => (prev.includes(fundamentalId) ? prev.filter((id) => id !== fundamentalId) : prev))
  }

  const handleComplete = async () => {
    setSaving(true)
    try {
      const scoreEntries = Object.entries(scores).map(([fundamentalId, score]) => ({
        fundamentalId,
        score,
      }))

      await window.api.saveAssessment(scoreEntries)
      toast({
        title: t('assessment.toast.successTitle'),
        description: t('assessment.toast.successDesc'),
        variant: 'gold',
      })
      await loadUser()
    } catch (err: any) {
      toast({
        title: t('assessment.toast.errorTitle'),
        description: err.message,
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  if (saving) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-hextech-gold" />
        <p className="text-hextech-text">{t('assessment.saving')}</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {suggested.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-hextech-cyan/20 bg-hextech-cyan/5 px-4 py-2.5 text-sm text-hextech-text" data-testid="assessment-prefill-banner">
          <Sparkles className="h-4 w-4 text-hextech-cyan shrink-0 mt-0.5" />
          <span>
            {t('assessment.prefill.banner', { n: suggested.length, fundamentals: suggested.map(objectiveLabel).join(', ') })}
          </span>
        </div>
      )}
      <FundamentalsGrid
        scores={scores}
        onScoreChange={handleScoreChange}
        onComplete={handleComplete}
      />
    </div>
  )
}
