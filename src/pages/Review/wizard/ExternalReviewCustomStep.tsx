import { Loader2, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ObjectiveKpiPicker } from './ObjectiveKpiPicker'
import type { WizardState } from '../ExternalReviewWizard'

interface Props {
  state: WizardState
  onChange: (partial: Partial<WizardState>) => void
  creating: boolean
  onCreate: () => void
  /** Override primary button label (e.g. post-game flow) */
  submitLabel?: string
}

export function ExternalReviewCustomStep({ state, onChange, creating, onCreate, submitLabel }: Props) {
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
        <label className="text-xs font-medium text-hextech-text-dim uppercase tracking-wider">Review title</label>
        <input
          autoFocus
          type="text"
          value={state.title}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder="e.g. Laning phase focus — Yone TOP"
          className="w-full rounded-md border border-hextech-border-dim bg-hextech-elevated px-3 py-2 text-sm text-hextech-text placeholder:text-hextech-text-dim/50 focus:outline-none focus:border-hextech-gold"
        />
      </div>

      {/* Objective toggle */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-hextech-text-dim uppercase tracking-wider">Objective (optional)</label>
          <button
            onClick={() => onChange({ wantsObjective: !state.wantsObjective, objectiveIds: [], selectedKpiIds: [] })}
            className={cn(
              'relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
              state.wantsObjective ? 'bg-hextech-teal' : 'bg-hextech-elevated border border-hextech-border-dim',
            )}
          >
            <span className={cn('inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform', state.wantsObjective ? 'translate-x-4' : 'translate-x-0.5')} />
          </button>
        </div>
        <p className="text-[11px] text-hextech-text-dim">
          {state.wantsObjective ? 'Pick up to 3 focus areas and the KPIs to track.' : 'Skip — review freely with marks and thoughts.'}
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
        {creating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Check className="h-4 w-4 mr-2" />}
        {submitLabel ?? 'Create review'}
      </Button>
    </div>
  )
}
