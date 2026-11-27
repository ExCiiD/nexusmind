import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

/**
 * « Toute la session / G1 / G2… » segmented filter (docs/DESIGN_STATE.md § 15.2 and § 24), shared by the session page
 * and the player sheet. `value` is a game index (HistoryGame.index) or null for the whole session. Scrolls sideways
 * past a few games (solo sessions can have many).
 */
export function GameFilter({ games, value, onPick, right }: {
  games: ReadonlyArray<{ index: number; win: boolean | null }>
  value: number | null
  onPick: (index: number | null) => void
  right?: ReactNode
}) {
  const { t } = useTranslation()
  return (
    <div className="sticky top-0 z-10 -mx-1 flex flex-wrap items-center justify-between gap-2 border-b border-hextech-border-dim/40 bg-hextech-black px-1 py-2">
      <div role="radiogroup" aria-label={t('teamSessions.detail.gameFilter')} className="inline-flex max-w-full gap-1 overflow-x-auto rounded-md border border-hextech-border-dim bg-hextech-dark p-1">
        {[null, ...games.map((g) => g.index)].map((idx) => {
          const g = idx == null ? null : games.find((x) => x.index === idx)!
          const active = value === idx
          return (
            <button key={idx ?? 'all'} type="button" role="radio" aria-checked={active} onClick={() => onPick(idx)}
              className={cn('flex shrink-0 items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hextech-gold',
                active ? 'bg-hextech-gold text-hextech-black' : 'text-hextech-text hover:bg-hextech-elevated')}>
              {g ? `G${g.index}` : t('teamSessions.detail.whole')}
              {g && g.win != null && (
                <span className={cn('rounded px-1 font-mono text-[10px] font-bold', active ? 'bg-black/20' : g.win ? 'bg-hextech-green/20 text-hextech-green' : 'bg-hextech-red/20 text-hextech-red')}>
                  {g.win ? t('teamSessions.winShort') : t('teamSessions.lossShort')}
                </span>
              )}
            </button>
          )
        })}
      </div>
      {right && <p className="font-mono text-[11px] text-hextech-text-dim">{right}</p>}
    </div>
  )
}
