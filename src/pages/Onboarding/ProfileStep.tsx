import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ChevronRight, UserCircle2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface ProfileStepProps {
  onNext: (displayName: string) => void
}

export function ProfileStep({ onNext }: ProfileStepProps) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [error, setError] = useState(false)

  const handleNext = () => {
    if (!name.trim()) { setError(true); return }
    onNext(name.trim())
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserCircle2 className="h-5 w-5 text-hextech-gold" />
          {t('profileStep.title')}
        </CardTitle>
        <CardDescription>{t('profileStep.subtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="displayName">{t('profileStep.label')}</Label>
          <Input
            id="displayName"
            placeholder={t('profileStep.placeholder')}
            value={name}
            onChange={(e) => { setName(e.target.value); setError(false) }}
            onKeyDown={(e) => e.key === 'Enter' && handleNext()}
            className={error ? 'border-[#FF4655]' : ''}
            autoFocus
          />
          {error && (
            <p className="text-xs text-[#FF4655]">{t('profileStep.error')}</p>
          )}
        </div>
        <Button onClick={handleNext} disabled={!name.trim()} className="w-full gap-2">
          {t('profileStep.nextButton')}
          <ChevronRight className="h-4 w-4" />
        </Button>
      </CardContent>
    </Card>
  )
}
