import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, Filter } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  DEFAULT_LAYERS, GAME_LAYERS, OBJECTIVE_LAYERS, SELF_LAYERS, activeFilterCount, objectivesState, toggleAllObjectives,
  type PlayerLayer, type PlayerLayers,
} from '@/lib/playerLayers'

/**
 * « Filtres » of the Review player (DECISIONS 21/11, spec § 19): replaces the toggles above the timeline. TOI (my
 * notes, micro-review, detected mistakes unless « Je tague mes erreurs moi-même », deaths), PARTIE (« Objectifs ·
 * tous » tri-state, each type, fights), « Réinitialiser ». Default: my notes + micro-review. Remembered.
 * Final look after the user's go on the mockups.
 */
export function PlayerFiltersMenu({ layers, onChange, hideMistakes = false }: { layers: PlayerLayers; onChange: (next: PlayerLayers) => void; hideMistakes?: boolean }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  const count = activeFilterCount(layers, { hideMistakes })
  const objState = objectivesState(layers)
  const row = (k: PlayerLayer, indent = false) => (
    <label key={k} className={cn('flex cursor-pointer items-center gap-2 py-1 text-sm text-hextech-text', indent && 'pl-5')}>
      <input type="checkbox" checked={layers[k]} onChange={() => onChange({ ...layers, [k]: !layers[k] })} className="accent-[var(--hextech-gold)]" />
      {t(`recording.layers.${k}`)}
    </label>
  )

  return (
    <div ref={rootRef} className="relative inline-block" data-testid="player-filters">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="dialog"
        className="flex items-center gap-1.5 rounded-full border border-hextech-border px-3 py-1 text-xs text-hextech-text hover:border-hextech-gold/60">
        <Filter className="h-3.5 w-3.5" />{t('recording.layers.filters')}
        <span className="rounded-full bg-hextech-gold/20 px-1.5 font-mono text-[10px] text-hextech-gold">{count}</span>
        <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <div role="dialog" aria-label={t('recording.layers.title')}
          className="absolute bottom-full left-0 z-40 mb-2 w-[300px] rounded-lg border border-hextech-border bg-hextech-elevated p-3 shadow-xl">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-hextech-text-bright">{t('recording.layers.title')}</span>
            <button type="button" onClick={() => onChange({ ...DEFAULT_LAYERS })} className="text-[11px] text-hextech-gold hover:underline">{t('recording.layers.reset')}</button>
          </div>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-hextech-text-dim">{t('recording.layers.self')}</p>
          {SELF_LAYERS.filter((k) => !(hideMistakes && k === 'mistakes')).map((k) => row(k))}
          <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-hextech-text-dim">{t('recording.layers.game')}</p>
          <label className="flex cursor-pointer items-center gap-2 py-1 text-sm text-hextech-text">
            <input type="checkbox" checked={objState === 'all'} ref={(el) => { if (el) el.indeterminate = objState === 'some' }}
              onChange={() => onChange(toggleAllObjectives(layers))} className="accent-[var(--hextech-gold)]" />
            {t('recording.layers.allObjectives')}
          </label>
          {GAME_LAYERS.filter((k) => (OBJECTIVE_LAYERS as readonly string[]).includes(k)).map((k) => row(k, true))}
          {row('fights')}
          <p className="mt-2 text-[10px] text-hextech-text-dim">{t('recording.layers.remembered')}</p>
        </div>
      )}
    </div>
  )
}
