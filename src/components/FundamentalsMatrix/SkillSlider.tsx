import { Slider } from '@/components/ui/slider'
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { Info } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface SkillSliderProps {
  label: string
  description: string
  value: number
  onChange: (value: number) => void
  compact?: boolean
}

function getScoreColor(value: number): string {
  if (value <= 0) return 'text-hextech-text-dim'
  if (value <= 2) return 'text-hextech-red'
  if (value <= 4) return 'text-orange-400'
  if (value <= 6) return 'text-hextech-gold'
  if (value <= 8) return 'text-hextech-cyan'
  return 'text-hextech-green'
}

function getScoreLabelKey(value: number): string {
  if (value <= 0) return ''
  if (value <= 2) return '1'
  if (value <= 4) return '2'
  if (value <= 5) return '3'
  if (value <= 7) return '4'
  if (value <= 9) return '5'
  return '6'
}

export function SkillSlider({
  label,
  description,
  value,
  onChange,
  compact,
}: SkillSliderProps) {
  const { t } = useTranslation()
  const labelKey = getScoreLabelKey(value)
  const scoreLabel = labelKey ? t(`skillSlider.labels.${labelKey}`) : ''

  return (
    <div className={cn('space-y-2', compact ? 'py-1' : 'py-2')}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-hextech-text-bright">{label}</span>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-3.5 w-3.5 text-hextech-text-dim cursor-help" />
              </TooltipTrigger>
              <TooltipContent>
                <p className="max-w-xs">{description}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <span className={cn('text-sm font-semibold', getScoreColor(value))}>
          {value > 0 ? `${value}/10 — ${scoreLabel}` : t('skillSlider.notRated')}
        </span>
      </div>
      <Slider value={[value]} onValueChange={([v]) => onChange(v)} max={10} min={1} step={1} />
    </div>
  )
}
