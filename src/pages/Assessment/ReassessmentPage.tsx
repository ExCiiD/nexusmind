import { useNavigate } from 'react-router-dom'
import { AssessmentStep } from '@/pages/Onboarding/AssessmentStep'
import { Button } from '@/components/ui/button'
import { ArrowLeft, Info } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export function ReassessmentPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => navigate('/')}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          {t('assessment.backToDashboard')}
        </Button>
      </div>
      <div>
        <h1 className="font-display text-2xl font-bold text-hextech-gold-bright">{t('assessment.title')}</h1>
        <p className="text-sm text-hextech-text mt-1">{t('assessment.subtitle')}</p>
      </div>

      <div className="flex items-start gap-3 rounded-lg border border-hextech-gold/20 bg-hextech-gold/5 px-4 py-3">
        <Info className="h-4 w-4 text-hextech-gold shrink-0 mt-0.5" />
        <p className="text-sm text-hextech-text leading-relaxed">{t('assessment.rankNote')}</p>
      </div>

      <AssessmentStep />
    </div>
  )
}
