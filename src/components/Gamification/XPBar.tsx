import { Progress } from '@/components/ui/progress'
import { getLevelFromXp } from '@/lib/utils'
import { Sparkles } from 'lucide-react'

interface XPBarProps {
  totalXp: number
}

export function XPBar({ totalXp }: XPBarProps) {
  const { level, currentXp, nextLevelXp } = getLevelFromXp(totalXp)
  const percent = Math.round((currentXp / nextLevelXp) * 100)

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-hextech-gold/20 border border-hextech-border">
            <span className="text-sm font-bold text-hextech-gold">{level}</span>
          </div>
          <span className="text-sm font-medium text-hextech-text-bright">Level {level}</span>
        </div>
        <div className="flex items-center gap-1 text-xs text-hextech-gold">
          <Sparkles className="h-3 w-3" />
          <span>{currentXp} / {nextLevelXp} XP</span>
        </div>
      </div>
      <Progress value={percent} indicatorClassName="bg-gradient-to-r from-hextech-gold to-hextech-gold-bright" />
    </div>
  )
}
