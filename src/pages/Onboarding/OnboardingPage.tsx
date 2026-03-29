import { useState } from 'react'
import { ProfileStep } from './ProfileStep'
import { RiotConnectStep } from './RiotConnectStep'
import { AssessmentStep } from './AssessmentStep'
import { cn } from '@/lib/utils'
import { useTranslation } from 'react-i18next'

export function OnboardingPage() {
  const { t } = useTranslation()
  const [currentStep, setCurrentStep] = useState(0)
  const [displayName, setDisplayName] = useState('')
  const steps = [
    t('onboarding.steps.profile'),
    t('onboarding.steps.connect'),
    t('onboarding.steps.assessment'),
  ]

  return (
    <div className="flex min-h-screen bg-hextech-black">
      <div className="flex flex-1 flex-col items-center justify-center px-8 py-12">
        <div className="w-full max-w-2xl space-y-8">
          <div className="text-center space-y-3">
            <div className="flex items-center justify-center gap-3 mb-6">
              <div className="h-12 w-12 rounded-lg bg-gradient-to-br from-hextech-cyan to-hextech-teal flex items-center justify-center">
                <span className="text-xl font-bold text-hextech-black">N</span>
              </div>
              <h1 className="font-display text-3xl font-bold text-gradient-gold">NexusMind</h1>
            </div>
            <p className="text-hextech-text">{t('onboarding.tagline')}</p>
          </div>

          <div className="flex items-center justify-center gap-4">
            {steps.map((step, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <div
                  className={cn(
                    'flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold transition-colors',
                    idx < currentStep
                      ? 'bg-hextech-green text-hextech-black'
                      : idx === currentStep
                        ? 'bg-hextech-gold text-hextech-black'
                        : 'bg-hextech-elevated text-hextech-text-dim',
                  )}
                >
                  {idx < currentStep ? '✓' : idx + 1}
                </div>
                <span
                  className={cn(
                    'text-sm hidden sm:inline',
                    idx === currentStep ? 'text-hextech-gold-bright font-medium' : 'text-hextech-text-dim',
                  )}
                >
                  {step}
                </span>
                {idx < steps.length - 1 && <div className="h-px w-8 bg-hextech-border-dim" />}
              </div>
            ))}
          </div>

          <div className="animate-fade-in">
            {currentStep === 0 && (
              <ProfileStep
                onNext={(name) => { setDisplayName(name); setCurrentStep(1) }}
              />
            )}
            {currentStep === 1 && (
              <RiotConnectStep displayName={displayName} onNext={() => setCurrentStep(2)} />
            )}
            {currentStep === 2 && <AssessmentStep />}
          </div>
        </div>
      </div>
    </div>
  )
}
