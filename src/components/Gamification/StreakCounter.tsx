import { Flame } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslation } from 'react-i18next'

interface StreakCounterProps {
  days: number
}

export function StreakCounter({ days }: StreakCounterProps) {
  const { t } = useTranslation()

  if (days === 0) {
    return (
      <div className="flex items-center gap-2 text-hextech-text-dim">
        <Flame className="h-5 w-5" />
        <span className="text-sm">{t('gamification.streak.noStreak')}</span>
      </div>
    )
  }

  const streakLabel =
    days >= 30 ? t('gamification.streak.label30')
    : days >= 14 ? t('gamification.streak.label14')
    : days >= 7 ? t('gamification.streak.label7')
    : days >= 3 ? t('gamification.streak.label3')
    : t('gamification.streak.label1')

  return (
    <div className="flex items-center gap-3">
      <div
        className={cn(
          'flex h-10 w-10 items-center justify-center rounded-full',
          days >= 7 ? 'bg-hextech-gold/20 animate-glow-pulse' : 'bg-hextech-elevated',
        )}
      >
        <Flame className={cn('h-5 w-5', days >= 7 ? 'text-hextech-gold' : 'text-orange-400')} />
      </div>
      <div>
        <div className="text-lg font-bold text-hextech-gold-bright">
          {t('gamification.streak.day', { count: days })}
        </div>
        <div className="text-xs text-hextech-text">{streakLabel}</div>
      </div>
    </div>
  )
}
