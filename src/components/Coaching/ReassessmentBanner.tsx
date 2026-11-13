import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ClipboardList } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useUserStore } from '@/store/useUserStore'

/**
 * P1: due either by the scheduled date (`user.nextAssessmentAt`) or by a
 * stats/bilan gap on ≥ 3 fundamentals (`coach:reassessment-check`). Shared
 * by the Dashboard and the "Mon plan" page so the two never disagree.
 */
export function ReassessmentBanner() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const user = useUserStore((s) => s.user)
  const [statGapCount, setStatGapCount] = useState(0)

  useEffect(() => {
    window.api.coachReassessmentCheck?.().then((r) => setStatGapCount(r?.gaps.length ?? 0)).catch(() => {})
  }, [])

  if (!user) return null
  const dateReassessment = !!(user.nextAssessmentAt && new Date(user.nextAssessmentAt) < new Date())
  if (!dateReassessment && statGapCount < 3) return null

  return (
    <div className="flex items-center justify-between rounded-lg border border-hextech-gold/30 bg-hextech-gold/5 px-4 py-2.5" data-testid="reassessment-banner">
      <div className="flex items-center gap-3">
        <ClipboardList className="h-4 w-4 text-hextech-gold shrink-0" />
        <div>
          <p className="text-sm font-medium text-hextech-gold-bright">{t('dashboard.reassessmentBanner.title')}</p>
          <p className="text-xs text-hextech-text">
            {dateReassessment ? t('dashboard.reassessmentBanner.desc') : t('dashboard.reassessmentBanner.statGapDesc', { n: statGapCount })}
          </p>
        </div>
      </div>
      <Button size="sm" variant="outline" onClick={() => navigate('/assessment')} className="shrink-0 ml-4 border-hextech-gold/50 text-hextech-gold hover:bg-hextech-gold/10">
        {t('dashboard.reassessmentBanner.cta')}
      </Button>
    </div>
  )
}
