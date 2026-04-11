import { useState, useEffect, useMemo, useRef } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Plus, Search, Lightbulb, History, ChevronRight, Check, X } from 'lucide-react'
import type { Fundamental, FundamentalCategory } from '@/lib/constants/fundamentals'
import { cn } from '@/lib/utils'

/* ─── Types ─────────────────────────────────────────────────────────────────── */

interface KpiHistoryEntry {
  objectiveIds: string[]
}

interface Suggestion {
  id: string
  label: string
  assessmentScore: number
  reason: string
  isNew: boolean
  priority: number
}

/* ─── Helpers ────────────────────────────────────────────────────────────────── */

/**
 * Builds a ranked list of objective suggestions based on assessment weakness,
 * recency of usage, and deterministic rules (e.g. high average deaths).
 */
function buildSuggestions(
  allFundamentals: Fundamental[],
  assessmentScores: Record<string, number>,
  kpiHistory: KpiHistoryEntry[],
  selectedObjectives: string[],
  highDeathsWarning: boolean,
  max = 4,
): Suggestion[] {
  const recent5 = kpiHistory.slice(0, 5)

  return allFundamentals
    .filter((f) => assessmentScores[f.id] !== undefined && !selectedObjectives.includes(f.id))
    .map((f) => {
      const score = assessmentScores[f.id]
      const weakness = (10 - score) / 10
      const lastIdx = recent5.findIndex((s) => s.objectiveIds.includes(f.id))
      const neverUsed = kpiHistory.every((s) => !s.objectiveIds.includes(f.id))
      let recencyFactor = 1.0
      if (lastIdx === 0) recencyFactor = 0.3
      else if (lastIdx <= 2) recencyFactor = 0.65
      else if (lastIdx <= 4) recencyFactor = 0.85

      let priority = weakness * recencyFactor

      // Boost Tempo to top priority when the player's avg deaths are >= 5
      if (f.id === 'tempo' && highDeathsWarning) {
        priority = 999
      }

      let reason: string
      if (f.id === 'tempo' && highDeathsWarning) {
        reason = '⚠ Moy. ≥ 5 morts/partie — Régulation des morts recommandée'
      } else if (score <= 3) {
        reason = `Score ${score}/10 — faiblesse critique`
      } else if (score <= 5) {
        reason = `Score ${score}/10 — priorité`
      } else if (score <= 7) {
        reason = `Score ${score}/10 — marge`
      } else {
        reason = `Score ${score}/10`
      }
      if (neverUsed && f.id !== 'tempo') reason += ' · jamais travaillé'

      return { id: f.id, label: f.label, assessmentScore: score, reason, priority, isNew: neverUsed }
    })
    .sort((a, b) => b.priority - a.priority)
    .slice(0, max)
}

/**
 * Returns the most-recently-used unique objective IDs from session history,
 * excluding any already selected objectives.
 */
function buildRecents(
  kpiHistory: KpiHistoryEntry[],
  allFundamentals: Fundamental[],
  selectedObjectives: string[],
  max = 5,
): Fundamental[] {
  const seen = new Set<string>()
  const recent: string[] = []
  for (const entry of kpiHistory) {
    for (const id of entry.objectiveIds) {
      if (!seen.has(id) && !selectedObjectives.includes(id)) {
        seen.add(id)
        recent.push(id)
      }
    }
    if (recent.length >= max) break
  }
  return recent
    .map((id) => allFundamentals.find((f) => f.id === id))
    .filter((f): f is Fundamental => f !== undefined)
}

/* ─── FundamentalItem ─────────────────────────────────────────────────────────── */

function FundamentalItem({
  fundamental,
  isSelected,
  assessmentScore,
  isNew,
  onSelect,
}: {
  fundamental: Fundamental
  isSelected: boolean
  assessmentScore?: number
  isNew?: boolean
  onSelect: (id: string) => void
}) {
  return (
    <button
      type="button"
      disabled={isSelected}
      onClick={() => onSelect(fundamental.id)}
      className={cn(
        'group w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors',
        isSelected
          ? 'opacity-40 cursor-not-allowed'
          : 'hover:bg-hextech-elevated/80 hover:border-hextech-border cursor-pointer',
      )}
    >
      <div className={cn(
        'flex h-6 w-6 shrink-0 items-center justify-center rounded-md border transition-colors',
        isSelected
          ? 'border-hextech-green bg-hextech-green/20'
          : 'border-hextech-border-dim group-hover:border-hextech-gold/50',
      )}>
        {isSelected
          ? <Check className="h-3.5 w-3.5 text-hextech-green" />
          : <Plus className="h-3.5 w-3.5 text-hextech-text-dim group-hover:text-hextech-gold" />
        }
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={cn('text-sm font-medium', isSelected ? 'text-hextech-text-dim' : 'text-hextech-text-bright')}>
            {fundamental.label}
          </span>
          {isNew && !isSelected && (
            <Badge variant="outline" className="text-[10px] h-4 px-1.5 border-hextech-cyan/40 text-hextech-cyan">
              Nouveau
            </Badge>
          )}
        </div>
      </div>
      {assessmentScore !== undefined && (
        <span className={cn(
          'shrink-0 text-xs font-semibold tabular-nums',
          assessmentScore <= 4 ? 'text-[#FF4655]'
            : assessmentScore <= 6 ? 'text-hextech-gold'
            : 'text-hextech-green',
        )}>
          {assessmentScore}/10
        </span>
      )}
    </button>
  )
}

/* ─── Main component ─────────────────────────────────────────────────────────── */

interface FundamentalPickerDialogProps {
  FUNDAMENTALS: FundamentalCategory[]
  allFundamentals: Fundamental[]
  selectedObjectives: string[]
  assessmentScores: Record<string, number>
  onSelect: (id: string) => void
  disabled?: boolean
}

export function FundamentalPickerDialog({
  FUNDAMENTALS,
  allFundamentals,
  selectedObjectives,
  assessmentScores,
  onSelect,
  disabled = false,
}: FundamentalPickerDialogProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [kpiHistory, setKpiHistory] = useState<KpiHistoryEntry[]>([])
  const [highDeathsWarning, setHighDeathsWarning] = useState(false)
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    window.api.getKpiHistory().then(setKpiHistory).catch(() => setKpiHistory([]))
    window.api.getCoachingPatterns()
      .then((p) => setHighDeathsWarning(p?.highDeathsWarning ?? false))
      .catch(() => setHighDeathsWarning(false))
  }, [])

  useEffect(() => {
    if (open) {
      setQuery('')
      setActiveCategory(null)
      setTimeout(() => searchRef.current?.focus(), 80)
    }
  }, [open])

  const suggestions = useMemo(
    () => buildSuggestions(allFundamentals, assessmentScores, kpiHistory, selectedObjectives, highDeathsWarning),
    [allFundamentals, assessmentScores, kpiHistory, selectedObjectives, highDeathsWarning],
  )

  const recents = useMemo(
    () => buildRecents(kpiHistory, allFundamentals, selectedObjectives),
    [kpiHistory, allFundamentals, selectedObjectives],
  )

  const q = query.trim().toLowerCase()

  const searchResults = useMemo(() => {
    if (!q) return null
    return FUNDAMENTALS.map((cat) => ({
      ...cat,
      fundamentals: cat.fundamentals.filter(
        (f) =>
          f.label.toLowerCase().includes(q) ||
          f.description.toLowerCase().includes(q),
      ),
    })).filter((cat) => cat.fundamentals.length > 0)
  }, [q, FUNDAMENTALS])

  const browseCategories = useMemo(() => {
    if (q) return null
    if (activeCategory) {
      return FUNDAMENTALS.filter((c) => c.id === activeCategory)
    }
    return FUNDAMENTALS
  }, [q, activeCategory, FUNDAMENTALS])

  const handleSelect = (id: string) => {
    onSelect(id)
    if (selectedObjectives.length >= 2) {
      setOpen(false)
    }
  }

  const isFull = selectedObjectives.length >= 3

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          disabled={disabled || isFull}
          className={cn(
            'w-full flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm transition-colors',
            isFull || disabled
              ? 'border-hextech-border-dim text-hextech-text-dim cursor-not-allowed opacity-60'
              : 'border-hextech-border-dim text-hextech-text hover:border-hextech-gold/50 hover:text-hextech-gold-bright cursor-pointer',
          )}
        >
          <Plus className="h-4 w-4 shrink-0" />
          <span>Ajouter un fondamental</span>
          {!isFull && (
            <span className="ml-auto text-xs text-hextech-text-dim">
              {3 - selectedObjectives.length} disponible{3 - selectedObjectives.length > 1 ? 's' : ''}
            </span>
          )}
        </button>
      </DialogTrigger>

      <DialogContent className="max-w-xl p-0 gap-0 overflow-hidden">
        {/* ─── Header + search ──────────────────────────────────────────────── */}
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-hextech-border-dim">
          <DialogTitle className="text-base">
            Choisir un fondamental
            <span className="ml-2 text-sm font-normal text-hextech-text-dim">
              ({selectedObjectives.length}/3 sélectionné{selectedObjectives.length > 1 ? 's' : ''})
            </span>
          </DialogTitle>
          <div className="flex items-center gap-2 mt-3 rounded-md border border-hextech-border-dim bg-hextech-elevated px-3 py-2">
            <Search className="h-4 w-4 text-hextech-text-dim shrink-0" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher par nom ou description…"
              className="flex-1 bg-transparent text-sm text-hextech-text-bright placeholder:text-hextech-text-dim outline-none"
            />
            {query && (
              <button onClick={() => setQuery('')} className="text-hextech-text-dim hover:text-hextech-text transition-colors">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </DialogHeader>

        {/* ─── Scrollable body ────────────────────────────────────────────────── */}
        <div className="overflow-y-auto max-h-[58vh] px-3 py-3 space-y-4">

          {/* SEARCH RESULTS */}
          {searchResults !== null && (
            searchResults.length === 0 ? (
              <p className="text-center text-sm text-hextech-text-dim py-8">Aucun résultat pour « {query} »</p>
            ) : (
              <div className="space-y-3">
                {searchResults.map((cat) => (
                  <div key={cat.id}>
                    <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wide text-hextech-gold/70">
                      {cat.label}
                    </p>
                    {cat.fundamentals.map((f) => (
                      <FundamentalItem
                        key={f.id}
                        fundamental={f}
                        isSelected={selectedObjectives.includes(f.id)}
                        assessmentScore={assessmentScores[f.id]}
                        onSelect={handleSelect}
                      />
                    ))}
                  </div>
                ))}
              </div>
            )
          )}

          {/* SUGGESTED + RECENTS + BROWSE (no query) */}
          {searchResults === null && (
            <>
              {/* Suggérés */}
              {suggestions.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-1 px-3">
                    <Lightbulb className="h-3.5 w-3.5 text-hextech-cyan" />
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-hextech-cyan/80">
                      Suggérés
                    </span>
                    <span className="text-[10px] text-hextech-text-dim">· évaluation + sessions récentes</span>
                  </div>
                  {suggestions.map((s) => (
                    <FundamentalItem
                      key={s.id}
                      fundamental={{ id: s.id, label: s.label, description: s.reason, kpis: [] }}
                      isSelected={selectedObjectives.includes(s.id)}
                      assessmentScore={s.assessmentScore}
                      isNew={s.isNew}
                      onSelect={handleSelect}
                    />
                  ))}
                </div>
              )}

              {/* Récents */}
              {recents.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-1 px-3">
                    <History className="h-3.5 w-3.5 text-hextech-gold/70" />
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-hextech-gold/70">
                      Récents
                    </span>
                  </div>
                  {recents.map((f) => (
                    <FundamentalItem
                      key={f.id}
                      fundamental={f}
                      isSelected={selectedObjectives.includes(f.id)}
                      assessmentScore={assessmentScores[f.id]}
                      onSelect={handleSelect}
                    />
                  ))}
                </div>
              )}

              {/* Séparateur + browse */}
              <div>
                <div className="flex items-center gap-2 mb-2 px-3 pt-1">
                  <div className="h-px flex-1 bg-hextech-border-dim" />
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-hextech-text-dim px-2">
                    Tous les fondamentaux
                  </span>
                  <div className="h-px flex-1 bg-hextech-border-dim" />
                </div>

                {/* Category pills */}
                <div className="flex flex-wrap gap-1.5 px-3 mb-3">
                  <button
                    type="button"
                    onClick={() => setActiveCategory(null)}
                    className={cn(
                      'rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors',
                      activeCategory === null
                        ? 'border-hextech-gold/50 bg-hextech-gold/10 text-hextech-gold-bright'
                        : 'border-hextech-border-dim text-hextech-text-dim hover:border-hextech-border',
                    )}
                  >
                    Tout
                  </button>
                  {FUNDAMENTALS.map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setActiveCategory(activeCategory === cat.id ? null : cat.id)}
                      className={cn(
                        'rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors',
                        activeCategory === cat.id
                          ? 'border-hextech-cyan/50 bg-hextech-cyan/10 text-hextech-cyan'
                          : 'border-hextech-border-dim text-hextech-text-dim hover:border-hextech-border',
                      )}
                    >
                      {cat.label.split(' — ')[1] ?? cat.label}
                    </button>
                  ))}
                </div>

                {/* Fundamentals list */}
                {browseCategories?.map((cat) => (
                  <div key={cat.id} className="mb-2">
                    <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wide text-hextech-text-dim">
                      {cat.label}
                    </p>
                    {cat.fundamentals.map((f) => (
                      <FundamentalItem
                        key={f.id}
                        fundamental={f}
                        isSelected={selectedObjectives.includes(f.id)}
                        assessmentScore={assessmentScores[f.id]}
                        onSelect={handleSelect}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* ─── Footer ─────────────────────────────────────────────────────────── */}
        {selectedObjectives.length > 0 && (
          <div className="border-t border-hextech-border-dim px-5 py-3 flex items-center justify-between gap-3">
            <div className="flex flex-wrap gap-1.5 min-w-0">
              {selectedObjectives.map((id) => {
                const label = allFundamentals.find((f) => f.id === id)?.label ?? id
                return (
                  <Badge key={id} variant="gold" className="text-xs gap-1 pr-1">
                    {label}
                    <ChevronRight className="h-3 w-3 opacity-60" />
                  </Badge>
                )
              })}
            </div>
            <Button size="sm" onClick={() => setOpen(false)} className="shrink-0">
              Confirmer
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
