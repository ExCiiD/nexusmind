import { SkillSlider } from '@/components/FundamentalsMatrix/SkillSlider'
import { type KPI } from '@/lib/constants/fundamentals'
import { useLocalizedFundamentals } from '@/lib/constants/useFundamentals'
import { AlertTriangle, MessageSquare } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface DynamicKPIFormProps {
  objectiveIds: string[]
  subObjectiveId?: string
  scores: Record<string, number>
  onChange: (kpiId: string, score: number) => void
  /** Optional free-text note per KPI — key is kpiId */
  kpiNotes?: Record<string, string>
  onNoteChange?: (kpiId: string, note: string) => void
  biasWarningsByObjective?: Record<string, string[]>
  /** If provided, only these KPI IDs are displayed. If empty/undefined, all KPIs are shown. */
  selectedKpiIds?: string[]
}

export function DynamicKPIForm({
  objectiveIds,
  subObjectiveId,
  scores,
  onChange,
  kpiNotes = {},
  onNoteChange,
  biasWarningsByObjective = {},
  selectedKpiIds,
}: DynamicKPIFormProps) {
  const { t } = useTranslation()
  const fundamentals = useLocalizedFundamentals()
  const allFundamentals = fundamentals.flatMap((c) => c.fundamentals)
  const selectedSet = selectedKpiIds && selectedKpiIds.length > 0 ? new Set(selectedKpiIds) : null

  const sections: Array<{ objectiveId: string; label: string; kpis: KPI[] }> = []

  for (const objId of objectiveIds) {
    const fundamental = allFundamentals.find((f) => f.id === objId)
    if (!fundamental) continue

    let kpis: KPI[] = []
    if (subObjectiveId && objectiveIds.length === 1) {
      const sub = fundamental.subcategories?.find((s) => s.id === subObjectiveId)
      kpis = sub?.kpis ?? fundamental.kpis
    } else {
      kpis = fundamental.kpis
    }

    // Filter to only selected KPIs if a selection exists
    if (selectedSet) {
      kpis = kpis.filter((kpi) => selectedSet.has(kpi.id))
    }

    if (kpis.length > 0) {
      sections.push({ objectiveId: objId, label: fundamental.label, kpis })
    }
  }

  if (sections.length === 0) {
    return (
      <div className="py-4 text-center text-sm text-hextech-text-dim">
        {t('reviewForm.kpi.noKpis')}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-hextech-text-bright">{t('reviewForm.kpi.title')}</h3>
        <p className="text-xs text-hextech-text mt-0.5">{t('reviewForm.kpi.subtitle')}</p>
      </div>
      {sections.map((section) => (
        <div
          key={section.label}
          className={`space-y-1 rounded-lg ${biasWarningsByObjective[section.objectiveId]?.length ? 'border border-orange-500/50 bg-orange-500/5 p-3' : ''}`}
        >
          {sections.length > 1 && (
            <div className="text-xs font-semibold text-hextech-gold border-b border-hextech-border-dim pb-1 mb-2">
              {section.label}
            </div>
          )}
          {biasWarningsByObjective[section.objectiveId]?.map((warning) => (
            <div
              key={warning}
              className="mb-2 flex items-start gap-2 rounded-md border border-orange-500/40 bg-orange-500/10 px-3 py-2 text-xs text-orange-200"
            >
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-orange-300" />
              <span>{warning}</span>
            </div>
          ))}
          {section.kpis.map((kpi: KPI) => (
            <div key={kpi.id} className={kpi.priority ? 'rounded-md border border-hextech-gold/30 bg-hextech-gold/5 px-2 pt-1.5 pb-1' : ''}>
              {kpi.priority && (
                <p className="text-[10px] font-semibold uppercase tracking-wide text-hextech-gold mb-1">
                  ⚠ Priorité — à ne pas négliger
                </p>
              )}
              <SkillSlider
                label={kpi.label}
                description={kpi.description}
                value={scores[kpi.id] || 0}
                onChange={(v) => onChange(kpi.id, v)}
                compact
              />
              {onNoteChange && (scores[kpi.id] > 0 || kpiNotes[kpi.id]) && (
                <div className="flex items-start gap-1.5 pl-1 mt-1 mb-2">
                  <MessageSquare className="h-3 w-3 text-hextech-text-dim shrink-0 mt-1.5" />
                  <input
                    type="text"
                    placeholder="Note (optionnel)…"
                    value={kpiNotes[kpi.id] ?? ''}
                    onChange={(e) => onNoteChange(kpi.id, e.target.value)}
                    className="w-full bg-transparent text-xs text-hextech-text placeholder:text-hextech-text-dim border-b border-hextech-border-dim focus:border-hextech-gold/50 focus:outline-none py-0.5 transition-colors"
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
