import { useState, useEffect } from 'react'
import { ProfileStep } from './ProfileStep'
import { RiotConnectStep } from './RiotConnectStep'
import { AssessmentStep } from './AssessmentStep'
import { AccountPickerStep } from './AccountPickerStep'
import { cn } from '@/lib/utils'
import { useTranslation } from 'react-i18next'
import { SavedAccount } from '@/lib/ipc'

type Flow = 'loading' | 'picker' | 'new-account'

export function OnboardingPage() {
  const { t } = useTranslation()
  const [flow, setFlow] = useState<Flow>('loading')
  const [savedAccounts, setSavedAccounts] = useState<SavedAccount[]>([])
  const [currentStep, setCurrentStep] = useState(0)
  const [displayName, setDisplayName] = useState('')
  const [skipAssessment, setSkipAssessment] = useState(false)

  useEffect(() => {
    window.api.listSavedAccounts().then((accounts) => {
      if (accounts.length > 0) {
        setSavedAccounts(accounts)
        setFlow('picker')
      } else {
        setFlow('new-account')
      }
    }).catch(() => setFlow('new-account'))
  }, [])

  const steps = [
    t('onboarding.steps.profile'),
    t('onboarding.steps.connect'),
    t('onboarding.steps.assessment'),
  ]

  if (flow === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-hextech-black">
        <div className="h-8 w-8 rounded bg-gradient-to-br from-hextech-cyan to-hextech-teal flex items-center justify-center animate-pulse">
          <span className="text-sm font-bold text-hextech-black">N</span>
        </div>
      </div>
    )
  }

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

          {flow === 'picker' ? (
            <div className="animate-fade-in">
              <AccountPickerStep
                accounts={savedAccounts}
                onNewAccount={() => { setFlow('new-account'); setCurrentStep(0) }}
              />
            </div>
          ) : (
            <>
              {/* Step indicator — only show for the 3-step new-account flow */}
              {!skipAssessment && (
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
              )}

              <div className="animate-fade-in">
                {currentStep === 0 && (
                  <ProfileStep
                    onNext={(name) => { setDisplayName(name); setCurrentStep(1) }}
                  />
                )}
                {currentStep === 1 && (
                  <RiotConnectStep
                    displayName={displayName}
                    onNext={(isReturning) => {
                      if (isReturning) {
                        // Returning user — data is already loaded, go straight to app
                        setSkipAssessment(true)
                        // setUser was called inside RiotConnectStep, App.tsx will redirect
                      } else {
                        setCurrentStep(2)
                      }
                    }}
                  />
                )}
                {currentStep === 2 && <AssessmentStep />}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
