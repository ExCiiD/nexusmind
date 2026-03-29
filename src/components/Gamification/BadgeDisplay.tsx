import { cn } from '@/lib/utils'
import {
  Trophy,
  Flame,
  Target,
  TrendingUp,
  Star,
  Shield,
  Zap,
  Crown,
  type LucideIcon,
} from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip'
import { useTranslation } from 'react-i18next'

export interface BadgeDef {
  id: string
  icon: LucideIcon
  color: string
}

export const BADGES: BadgeDef[] = [
  { id: 'first_review', icon: Star, color: 'text-hextech-gold' },
  { id: 'streak_3', icon: Flame, color: 'text-orange-400' },
  { id: 'streak_7', icon: Flame, color: 'text-hextech-gold' },
  { id: 'streak_30', icon: Crown, color: 'text-hextech-gold-bright' },
  { id: 'objective_5', icon: Target, color: 'text-hextech-cyan' },
  { id: 'objective_25', icon: Shield, color: 'text-hextech-teal' },
  { id: 'improvement_1', icon: TrendingUp, color: 'text-hextech-green' },
  { id: 'sessions_10', icon: Zap, color: 'text-hextech-cyan' },
  { id: 'sessions_50', icon: Trophy, color: 'text-hextech-gold' },
  { id: 'rank_up', icon: TrendingUp, color: 'text-hextech-gold-bright' },
]

interface BadgeDisplayProps {
  unlockedBadgeIds: string[]
  compact?: boolean
}

export function BadgeDisplay({ unlockedBadgeIds, compact }: BadgeDisplayProps) {
  const { t } = useTranslation()

  return (
    <div className={cn('flex flex-wrap', compact ? 'gap-2' : 'gap-3')}>
      <TooltipProvider>
        {BADGES.map((badge) => {
          const unlocked = unlockedBadgeIds.includes(badge.id)
          return (
            <Tooltip key={badge.id}>
              <TooltipTrigger asChild>
                <div
                  className={cn(
                    'flex items-center justify-center rounded-lg border transition-all',
                    compact ? 'h-8 w-8' : 'h-12 w-12',
                    unlocked
                      ? 'border-hextech-border bg-hextech-elevated gold-glow cursor-pointer'
                      : 'border-hextech-border-dim bg-hextech-dark opacity-40 cursor-default',
                  )}
                >
                  <badge.icon className={cn(compact ? 'h-4 w-4' : 'h-6 w-6', unlocked ? badge.color : 'text-hextech-text-dim')} />
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p className="font-semibold">{t(`gamification.badges.${badge.id}`)}</p>
                <p className="text-xs text-hextech-text">{t(`gamification.badges.${badge.id}_desc`)}</p>
                {!unlocked && <p className="text-xs text-hextech-text-dim mt-1">{t('gamification.badges.locked')}</p>}
              </TooltipContent>
            </Tooltip>
          )
        })}
      </TooltipProvider>
    </div>
  )
}
