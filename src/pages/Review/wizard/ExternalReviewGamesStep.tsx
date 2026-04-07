import { Loader2, Check, ChevronsDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { formatGameTime, formatKDA } from '@/lib/utils'
import { ObjectiveKpiPicker } from './ObjectiveKpiPicker'
import type { WizardState } from '../ExternalReviewWizard'

interface Props {
  state: WizardState
  onChange: (partial: Partial<WizardState>) => void
  creating: boolean
  onCreate: (overrides?: Partial<WizardState>) => void
  onLoadMore: () => void
  loadingMore: boolean
}

export function ExternalReviewGamesStep({ state, onChange, creating, onCreate, onLoadMore, loadingMore }: Props) {
  const gameDate = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })

  const toggleObjective = (id: string) => {
    const ids = state.objectiveIds.includes(id)
      ? state.objectiveIds.filter((x) => x !== id)
      : [...state.objectiveIds, id].slice(0, 3)
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
      <p className="text-xs text-hextech-text-dim">
        Games for <span className="font-medium text-hextech-text-bright">{state.playerName}</span>. Pick one to review.
      </p>

      {/* Game list */}
      <div className="max-h-44 overflow-y-auto space-y-1.5">
        {state.fetchedGames.map((g, i) => (
          <button
            key={g.matchId ?? i}
            onClick={() => onChange({ selectedGame: g })}
            className={cn(
              'w-full flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-all text-sm',
              state.selectedGame?.matchId === g.matchId
                ? 'border-hextech-gold bg-hextech-gold/10'
                : 'border-hextech-border-dim bg-hextech-elevated hover:border-hextech-gold/40',
            )}
          >
            <div className={cn('w-1 h-8 rounded-full shrink-0', g.win ? 'bg-green-500' : 'bg-red-500')} />
            <div className="flex-1 min-w-0">
              <span className="font-semibold text-hextech-text-bright">{g.champion}</span>
              {g.opponentChampion && (
                <span className="text-hextech-text-dim text-xs ml-1">vs {g.opponentChampion}</span>
              )}
              <div className="text-[11px] text-hextech-text-dim mt-0.5">
                {formatKDA(g.kills, g.deaths, g.assists)} · {formatGameTime(g.duration)} · {gameDate(g.gameEndAt)}
              </div>
            </div>
            {state.selectedGame?.matchId === g.matchId && (
              <Check className="h-4 w-4 text-hextech-gold shrink-0" />
            )}
          </button>
        ))}
      </div>

      {/* Load more */}
      <div className="flex justify-center -mt-1">
        <button
          onClick={onLoadMore}
          disabled={loadingMore}
          className="flex items-center gap-1.5 text-xs text-hextech-text-dim hover:text-hextech-text transition-colors disabled:opacity-50"
        >
          {loadingMore
            ? <Loader2 className="h-3 w-3 animate-spin" />
            : <ChevronsDown className="h-3 w-3" />}
          {loadingMore ? 'Loading…' : 'Load 10 more'}
        </button>
      </div>

      {/* Objective + KPI toggle */}
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

        {state.wantsObjective && (
          <div className="max-h-64 overflow-y-auto">
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
        onClick={() => onCreate()}
        disabled={creating || !state.selectedGame}
        className="w-full"
        size="lg"
      >
        {creating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Check className="h-4 w-4 mr-2" />}
        Start review
      </Button>
    </div>
  )
}
