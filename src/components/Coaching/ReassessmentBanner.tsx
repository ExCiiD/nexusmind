import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ClipboardList } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CalibrationFlash } from '@/components/MicroReview/CalibrationFlash'
import type { CalibrationStatus } from '@/lib/microReview/types'

/**
 * P1 + micro-review §D: the long periodic form is replaced by the
 * Calibration flash (every 15 games, one question). The stats/bilan gap on
 * ≥ 3 fundamentals (`coach:reassessment-check`) still points to the full
 * assessment, since the scores keep being computed continuously. Shared by
 * the Dashboard and the "Mon plan" page so the two never disagree.
 */
export function ReassessmentBanner() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  // The status is read once here and handed to the flash (it used to read it again: 2 requests per Dashboard).
  const [calibration, setCalibration] = useState<CalibrationStatus | null>(null)
  const [flashDue, setFlashDue] = useState<boolean | null>(null)
  const [statGapCount, setStatGapCount] = useState(0)

  useEffect(() => {
    window.api.calibrationStatus?.().then((s) => { setCalibration(s ?? null); setFlashDue(!!s?.due) }).catch(() => setFlashDue(false))
    window.api.coachReassessmentCheck?.().then((r) => setStatGapCount(r?.gaps.length ?? 0)).catch(() => {})
  }, [])

  if (flashDue) return <CalibrationFlash initialStatus={calibration} />
  if (flashDue === null || statGapCount < 3) return null

  return (
    <div className="flex items-center justify-between panel-surface rounded-lg border border-hextech-gold/30 bg-gradient-to-r from-hextech-gold/15 to-hextech-gold/5 px-4 py-2.5" data-testid="reassessment-banner">
      <div className="flex items-center gap-3">
        <ClipboardList className="h-4 w-4 text-hextech-gold shrink-0" />
        <div>
          <p className="text-sm font-medium text-hextech-gold-bright">{t('dashboard.reassessmentBanner.title')}</p>
          <p className="text-xs text-hextech-text">{t('dashboard.reassessmentBanner.statGapDesc', { n: statGapCount })}</p>
        </div>
      </div>
      <Button size="sm" variant="outline" onClick={() => navigate('/assessment')} className="shrink-0 ml-4 border-hextech-gold/50 text-hextech-gold hover:bg-hextech-gold/10">
        {t('dashboard.reassessmentBanner.cta')}
      </Button>
    </div>
  )
}
