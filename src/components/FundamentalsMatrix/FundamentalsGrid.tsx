import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { SkillSlider } from './SkillSlider'
import type { FundamentalCategory } from '@/lib/constants/fundamentals'
import { useLocalizedFundamentals } from '@/lib/constants/useFundamentals'
import { ChevronRight, ChevronLeft, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslation } from 'react-i18next'

interface FundamentalsGridProps {
  scores: Record<string, number>
  onScoreChange: (fundamentalId: string, score: number) => void
  onComplete: () => void
  mode?: 'full' | 'compact'
}

export function FundamentalsGrid({ scores, onScoreChange, onComplete, mode = 'full' }: FundamentalsGridProps) {
  const { t } = useTranslation()
  const [currentCategoryIdx, setCurrentCategoryIdx] = useState(0)
  const categories = useLocalizedFundamentals()
  const category = categories[currentCategoryIdx]

  const totalFundamentals = categories.reduce((sum, c) => sum + c.fundamentals.length, 0)
  const ratedCount = Object.values(scores).filter((v) => v > 0).length
  const progress = Math.round((ratedCount / totalFundamentals) * 100)

  const isLastCategory = currentCategoryIdx === categories.length - 1
  const canComplete = ratedCount >= totalFundamentals * 0.8

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-display font-bold text-hextech-gold-bright">{t('fundamentalsGrid.title')}</h2>
          <p className="text-sm text-hextech-text mt-1">{t('fundamentalsGrid.subtitle')}</p>
        </div>
        <div className="text-right">
          <div className="text-sm text-hextech-text">
            {ratedCount}/{totalFundamentals} {t('fundamentalsGrid.rated')}
          </div>
          <div className="h-2 w-32 rounded-full bg-hextech-elevated mt-1 overflow-hidden">
            <div
              className="h-full bg-hextech-gold transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-2">
        {categories.map((cat, idx) => (
          <button
            key={cat.id}
            onClick={() => setCurrentCategoryIdx(idx)}
            className={cn(
              'whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              idx === currentCategoryIdx
                ? 'bg-hextech-gold/20 text-hextech-gold border border-hextech-border'
                : 'text-hextech-text hover:text-hextech-text-bright hover:bg-hextech-elevated',
            )}
          >
            {cat.label}
          </button>
        ))}
      </div>

      <CategorySection
        category={category}
        scores={scores}
        onScoreChange={onScoreChange}
        compact={mode === 'compact'}
      />

      <div className="flex items-center justify-between pt-4 border-t border-hextech-border-dim">
        <Button
          variant="ghost"
          onClick={() => setCurrentCategoryIdx(Math.max(0, currentCategoryIdx - 1))}
          disabled={currentCategoryIdx === 0}
        >
          <ChevronLeft className="h-4 w-4 mr-1" /> {t('fundamentalsGrid.prev')}
        </Button>

        {isLastCategory ? (
          <Button onClick={onComplete} disabled={!canComplete}>
            <Check className="h-4 w-4 mr-1" /> {t('fundamentalsGrid.complete')}
          </Button>
        ) : (
          <Button
            variant="outline"
            onClick={() => setCurrentCategoryIdx(Math.min(categories.length - 1, currentCategoryIdx + 1))}
          >
            {t('fundamentalsGrid.next')} <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        )}
      </div>
    </div>
  )
}

function CategorySection({
  category,
  scores,
  onScoreChange,
  compact,
}: {
  category: FundamentalCategory
  scores: Record<string, number>
  onScoreChange: (id: string, score: number) => void
  compact: boolean
}) {
  return (
    <div className="space-y-4">
      {category.fundamentals.map((fundamental) => (
        <Card key={fundamental.id}>
          <CardHeader className={compact ? 'p-4 pb-2' : undefined}>
            <CardTitle className="text-base">{fundamental.label}</CardTitle>
            {!compact && <CardDescription>{fundamental.description}</CardDescription>}
          </CardHeader>
          <CardContent className={compact ? 'p-4 pt-0' : undefined}>
            <SkillSlider
              label={fundamental.label}
              description={fundamental.description}
              value={scores[fundamental.id] || 0}
              onChange={(v) => onScoreChange(fundamental.id, v)}
              compact={compact}
            />
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
