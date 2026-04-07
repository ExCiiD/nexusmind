import { cn } from '@/lib/utils'
import { useLocalizedFundamentals } from '@/lib/constants/useFundamentals'
import { getKPIsForObjective } from '@/lib/constants/fundamentals'
import { Check } from 'lucide-react'

interface Props {
  objectiveIds: string[]
  selectedKpiIds: string[]
  onToggleObjective: (id: string) => void
  onToggleKpi: (id: string) => void
}

export function ObjectiveKpiPicker({ objectiveIds, selectedKpiIds, onToggleObjective, onToggleKpi }: Props) {
  const categories = useLocalizedFundamentals()
  const allFundamentals = categories.flatMap((c) => c.fundamentals)

  const kpisForObjective = objectiveIds
    .map((id) => {
      const f = allFundamentals.find((x) => x.id === id)
      return f ? { objectiveId: id, label: f.label, kpis: getKPIsForObjective(id) } : null
    })
    .filter(Boolean) as Array<{ objectiveId: string; label: string; kpis: any[] }>

  return (
    <div className="space-y-4">
      {/* Objective multi-select (max 3) */}
      <div className="space-y-1.5">
        <p className="text-[10px] font-semibold text-hextech-text-dim uppercase tracking-widest">
          Focus area{objectiveIds.length > 1 ? 's' : ''} (up to 3)
        </p>
        <div className="max-h-36 overflow-y-auto space-y-0.5 rounded-lg border border-hextech-border-dim p-2">
          {allFundamentals.map((f) => {
            const selected = objectiveIds.includes(f.id)
            const maxReached = objectiveIds.length >= 3 && !selected
            return (
              <button
                key={f.id}
                disabled={maxReached}
                onClick={() => onToggleObjective(f.id)}
                className={cn(
                  'w-full text-left rounded px-2.5 py-1.5 text-xs transition-colors flex items-center gap-2',
                  selected
                    ? 'bg-hextech-gold/20 text-hextech-gold-bright font-medium'
                    : maxReached
                      ? 'text-hextech-text-dim/40 cursor-not-allowed'
                      : 'text-hextech-text hover:bg-white/5',
                )}
              >
                <div className={cn(
                  'h-3.5 w-3.5 rounded border flex items-center justify-center shrink-0',
                  selected ? 'bg-hextech-gold border-hextech-gold' : 'border-hextech-border-dim',
                )}>
                  {selected && <Check className="h-2.5 w-2.5 text-black" />}
                </div>
                {f.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* KPI selection for each picked objective */}
      {kpisForObjective.length > 0 && (
        <div className="space-y-3">
          <p className="text-[10px] font-semibold text-hextech-text-dim uppercase tracking-widest">KPIs to track</p>
          {kpisForObjective.map(({ objectiveId, label, kpis }) => (
            <div key={objectiveId} className="space-y-1">
              <p className="text-[10px] font-medium text-hextech-gold uppercase tracking-wide">{label}</p>
              <div className="space-y-0.5">
                {kpis.map((kpi) => {
                  const isSelected = selectedKpiIds.includes(kpi.id)
                  return (
                    <button
                      key={kpi.id}
                      onClick={() => onToggleKpi(kpi.id)}
                      className={cn(
                        'w-full text-left rounded border px-2.5 py-2 text-xs transition-all',
                        isSelected
                          ? 'border-hextech-gold/50 bg-hextech-gold/10 text-hextech-text-bright'
                          : 'border-hextech-border-dim text-hextech-text-dim hover:border-hextech-border hover:text-hextech-text',
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <div className={cn(
                          'h-3.5 w-3.5 rounded border flex items-center justify-center shrink-0',
                          isSelected ? 'bg-hextech-gold border-hextech-gold' : 'border-hextech-border-dim',
                        )}>
                          {isSelected && <Check className="h-2.5 w-2.5 text-black" />}
                        </div>
                        <span className="font-medium">{kpi.label}</span>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
