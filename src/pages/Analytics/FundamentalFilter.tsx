import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, Filter, RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { FundamentalCategory } from '@/lib/constants/fundamentals'

interface Props {
  categories: FundamentalCategory[]
  /** null = everything shown */
  selected: string[] | null
  onChange: (ids: string[] | null) => void
  /** Fundamentals that have data in the current view (marked with a dot). */
  withData: Set<string>
}

/**
 * Collapsible fundamentals picker shared by both Analytics charts. Collapsed,
 * it states in plain words what is shown; expanded, categories and
 * fundamentals behave as before (first click isolates, then add/remove).
 */
export function FundamentalFilter({ categories, selected, onChange, withData }: Props) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const all = categories.flatMap((c) => c.fundamentals.map((f) => f.id))
  const shown = selected ?? all
  const labelOf = (id: string) => categories.flatMap((c) => c.fundamentals).find((f) => f.id === id)?.label ?? id

  const toggle = (id: string) => {
    if (selected === null) return onChange([id])
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]
    onChange(next.length === 0 ? null : next)
  }

  const toggleCategory = (ids: string[]) => {
    if (selected === null) return onChange(ids)
    const allActive = ids.every((id) => selected.includes(id))
    if (allActive) {
      const next = selected.filter((id) => !ids.includes(id))
      onChange(next.length === 0 ? null : next)
    } else {
      onChange([...new Set([...selected, ...ids])])
    }
  }

  const summary = selected === null
    ? t('analytics.filter.all')
    : selected.length <= 3
      ? selected.map(labelOf).join(', ')
      : t('analytics.filter.count', { count: selected.length, names: selected.slice(0, 2).map(labelOf).join(', ') })

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 rounded-full border border-hextech-border-dim px-3 py-1 text-hextech-text hover:border-hextech-border"
          aria-expanded={open}
        >
          <Filter className="h-3.5 w-3.5" />
          {t('analytics.filter.label')}
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
        <span className="text-hextech-text-dim">{summary}</span>
        {selected !== null && (
          <button type="button" onClick={() => onChange(null)} className="flex items-center gap-1 text-hextech-gold hover:underline">
            <RotateCcw className="h-3 w-3" />{t('analytics.filter.reset')}
          </button>
        )}
      </div>

      {open && (
        <div className="space-y-3 rounded-lg border border-hextech-border-dim p-3">
          <p className="text-[11px] text-hextech-text-dim">{t('analytics.filter.hint')}</p>
          {categories.map((cat) => {
            const ids = cat.fundamentals.map((f) => f.id)
            const catActive = selected !== null && ids.every((id) => shown.includes(id))
            return (
              <div key={cat.id} className="space-y-1.5">
                <button
                  type="button"
                  onClick={() => toggleCategory(ids)}
                  className={cn(
                    'rounded-full border px-3 py-0.5 text-[11px] font-semibold uppercase tracking-wide transition-colors',
                    catActive ? 'border-hextech-cyan bg-hextech-cyan/10 text-hextech-cyan' : 'border-hextech-border-dim text-hextech-text-dim hover:border-hextech-border',
                  )}
                >
                  {cat.label}
                  {ids.some((id) => withData.has(id)) && <span className="ml-1.5 text-hextech-gold opacity-70">●</span>}
                </button>
                <div className="flex flex-wrap gap-1.5 pl-2">
                  {cat.fundamentals.map((f) => {
                    const isActive = shown.includes(f.id)
                    const hasData = withData.has(f.id)
                    return (
                      <button
                        type="button"
                        key={f.id}
                        onClick={() => toggle(f.id)}
                        title={hasData ? undefined : t('analytics.filter.noData')}
                        className={cn(
                          'rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors',
                          isActive && hasData
                            ? 'border-hextech-gold bg-hextech-gold/10 text-hextech-gold-bright'
                            : isActive
                              ? 'border-hextech-border text-hextech-text-dim'
                              : 'border-hextech-border-dim text-hextech-text-dim opacity-40 hover:opacity-70',
                        )}
                      >
                        {f.label}
                        {hasData && <span className="ml-1 text-hextech-gold/60">●</span>}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
          <p className="text-[11px] text-hextech-text-dim">● {t('analytics.filter.dotLegend')}</p>
        </div>
      )}
    </div>
  )
}
