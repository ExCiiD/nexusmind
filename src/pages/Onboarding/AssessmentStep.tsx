import { useState } from 'react'
import { FundamentalsGrid } from '@/components/FundamentalsMatrix/FundamentalsGrid'
import { useUserStore } from '@/store/useUserStore'
import { useToast } from '@/hooks/useToast'
import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export function AssessmentStep() {
  const { t } = useTranslation()
  const [scores, setScores] = useState<Record<string, number>>({})
  const [saving, setSaving] = useState(false)
  const loadUser = useUserStore((s) => s.loadUser)
  const { toast } = useToast()

  const handleScoreChange = (fundamentalId: string, score: number) => {
    setScores((prev) => ({ ...prev, [fundamentalId]: score }))
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
    <FundamentalsGrid
      scores={scores}
      onScoreChange={handleScoreChange}
      onComplete={handleComplete}
    />
  )
}
