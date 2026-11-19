import { useTranslation } from 'react-i18next'
import { Loader2, Check } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { ObjectiveKpiPicker } from './ObjectiveKpiPicker'
import type { WizardState } from '../ExternalReviewWizard'

interface Props {
  state: WizardState
  onChange: (partial: Partial<WizardState>) => void
  creating: boolean
  onCreate: () => void
  /** Override primary button label (e.g. post-game flow) */
}

export function ExternalReviewCustomStep({ state, onChange, creating, onCreate }: Props) {
  const { t } = useTranslation()
  const toggleObjective = (id: string) => {
    const ids = state.objectiveIds.includes(id)
      ? state.objectiveIds.filter((x) => x !== id)
      : [...state.objectiveIds, id].slice(0, 3)
    // Remove KPIs that no longer belong to any selected objective
    onChange({ objectiveIds: ids })
  }

  const toggleKpi = (id: string) => {
    const ids = state.selectedKpiIds.includes(id)
      ? state.selectedKpiIds.filter((x) => x !== id)
      : [...state.selectedKpiIds, id]
    onChange({ selectedKpiIds: ids })
  }

  return (
    <div className="space-y-4 pt-1">
      {/* Title */}
      <div className="space-y-1">
        <label htmlFor="ext-review-title" className="text-xs font-medium text-hextech-text-dim uppercase tracking-wider">{t('externalReview.custom.title')}</label>
        <input
          id="ext-review-title"
          autoFocus
          type="text"
          value={state.title}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder={t('externalReview.custom.titlePlaceholder')}
          className="w-full rounded-md border border-hextech-border-dim bg-hextech-elevated px-3 py-2 text-sm text-hextech-text placeholder:text-hextech-text-dim/50 focus:outline-none focus:border-hextech-gold"
        />
      </div>

      {/* Objective toggle */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label htmlFor="ext-custom-objective" className="text-xs font-medium text-hextech-text-dim uppercase tracking-wider">{t('externalReview.objectiveOptional')}</label>
          <Switch
            id="ext-custom-objective"
            checked={state.wantsObjective}
            onCheckedChange={(v) => onChange({ wantsObjective: v, objectiveIds: [], selectedKpiIds: [] })}
          />
        </div>
        <p className="text-[11px] text-hextech-text-dim">
          {state.wantsObjective ? t('externalReview.objectiveOn') : t('externalReview.objectiveOff')}
        </p>

        {state.wantsObjective && (
          <div className="max-h-72 overflow-y-auto">
            <ObjectiveKpiPicker
              objectiveIds={state.objectiveIds}
              selectedKpiIds={state.selectedKpiIds}
              onToggleObjective={toggleObjective}
              onToggleKpi={toggleKpi}
            />
          </div>
        )}
      </div>

      <Button
        onClick={onCreate}
        disabled={creating || !state.title.trim()}
        className="w-full"
        size="lg"
      >
        {creating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden /> : <Check className="h-4 w-4 mr-2" aria-hidden />}
        {t('externalReview.custom.create')}
      </Button>
    </div>
  )
}
