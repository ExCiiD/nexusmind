import type { LucideIcon } from 'lucide-react'
import { User, Users, Target } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

export type EventFilterMode = 'mine' | 'all' | 'objectives'

export interface FilterChip {
  key: string
  label: string
  count: number
  on: boolean
  Icon: LucideIcon
  /** Tailwind colours of the chip when it is on. */
  colorClass: string
  onToggle: () => void
}

/**
 * The player's filters (beta.20 feedback, in place of the « Filtres » menu, on every player): the scope Mine · All ·
 * Objectives, then one coloured chip per kind of marker with its count. A pressed chip clicked again hides its
 * markers (grey chip); clicked once more, they come back.
 */
export function PlayerFilterChips({ mode, onMode, chips }: { mode: EventFilterMode; onMode: (m: EventFilterMode) => void; chips: FilterChip[] }) {
  const { t } = useTranslation()
  const modes: Array<{ id: EventFilterMode; label: string; Icon: LucideIcon; title: string }> = [
    { id: 'mine', label: t('record.player.modeMine'), Icon: User, title: t('record.player.modeMineHint') },
    { id: 'all', label: t('record.player.modeAll'), Icon: Users, title: t('record.player.modeAllHint') },
    { id: 'objectives', label: t('record.player.modeObjectives'), Icon: Target, title: t('record.player.modeObjectivesHint') },
  ]
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid="player-filter-chips">
      <div className="flex items-center rounded-md border border-white/10 bg-white/5 p-0.5" role="radiogroup" aria-label={t('recording.layers.filters')}>
        {modes.map(({ id, label, Icon, title }) => (
          <button key={id} type="button" role="radio" aria-checked={mode === id} onClick={() => onMode(id)} title={title}
            className={cn('flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition-colors',
              mode === id ? 'bg-hextech-gold/25 text-hextech-gold' : 'text-white/40 hover:bg-white/5 hover:text-white/70')}>
            <Icon className="h-2.5 w-2.5" strokeWidth={2.5} /><span>{label}</span>
          </button>
        ))}
      </div>
      {chips.map((c) => (
        <button key={c.key} type="button" aria-pressed={c.on} onClick={c.onToggle} data-testid={`filter-chip-${c.key}`}
          title={c.on ? t('record.player.hideX', { x: c.label }) : t('record.player.showX', { x: c.label })}
          className={cn('flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition-all',
            c.on ? cn(c.colorClass, 'border-white/20 hover:brightness-110') : 'border-white/10 bg-white/5 text-white/30 line-through decoration-white/30 hover:bg-white/10 hover:text-white/60')}>
          <c.Icon className="h-2.5 w-2.5" strokeWidth={2.5} />
          <span>{c.label}</span>
          <span className="opacity-60">{c.count}</span>
        </button>
      ))}
    </div>
  )
}
