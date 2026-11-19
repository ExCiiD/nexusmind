import { useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronUp, GripVertical } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import type { DraftLogEntry } from '@/lib/analyst'
import { joinPickOrder, moveItem, pickOrderSides } from '@/lib/analystViews'
import { ChampIcon } from './shared'

type SideKey = 'blue' | 'red'

/**
 * #40 · 2/3, § 11 « Ordre de pick »: match-v5 does not give it, the analyst types it. Each side's five picks are put
 * in order (B1…B5, R1…R5), so the stored order (B1 R1 R2 B2 … R5) is always a valid draft sequence. Reorder with
 * the mouse (drag), the keyboard (↑ / ↓ on a pick's handle) or the ▲ / ▼ buttons; a live region says where a pick
 * went. « Enregistrer » saves it (draftLogUpdate), « Effacer » removes it.
 */
export function PickOrderEditor({ entry, onSave }: {
  entry: Pick<DraftLogEntry, 'id' | 'side' | 'ourPicks' | 'theirPicks' | 'pickOrder'>
  onSave: (pickOrder: string[] | null) => void
}) {
  const { t } = useTranslation()
  const initial = pickOrderSides(entry.pickOrder, entry.side, entry.ourPicks, entry.theirPicks)
  const [order, setOrder] = useState(initial)
  const [announce, setAnnounce] = useState('')
  const drag = useRef<{ side: SideKey; index: number } | null>(null)
  const handles = useRef(new Map<string, HTMLButtonElement | null>())
  const dirty = joinPickOrder(order.blue, order.red).join('|') !== (entry.pickOrder ?? []).join('|')
  const complete = order.blue.length === 5 && order.red.length === 5

  const slotOf = (side: SideKey, i: number) => `${side === 'blue' ? 'B' : 'R'}${i + 1}`
  const move = (side: SideKey, from: number, to: number) => {
    const list = order[side]
    if (to < 0 || to >= list.length || from === to) return
    const next = { ...order, [side]: moveItem(list, from, to) }
    setOrder(next)
    setAnnounce(t('analyst.draftLog.pickOrder.moved', { champion: list[from], slot: slotOf(side, to) }))
    // Focus follows the moved pick (keyboard users keep their place).
    setTimeout(() => handles.current.get(`${side}-${list[from]}`)?.focus(), 0)
  }
  const onKey = (side: SideKey, i: number) => (e: KeyboardEvent) => {
    if (e.key === 'ArrowUp') { e.preventDefault(); move(side, i, i - 1) }
    if (e.key === 'ArrowDown') { e.preventDefault(); move(side, i, i + 1) }
  }
  const onDrop = (side: SideKey, i: number) => (e: DragEvent) => {
    e.preventDefault()
    const from = drag.current
    drag.current = null
    if (from && from.side === side) move(side, from.index, i)
  }

  const column = (side: SideKey) => (
    <ol aria-label={t(`analyst.draftLog.pickOrder.${side}`)} className="space-y-1">
      {order[side].map((champion, i) => (
        <li
          key={champion}
          draggable
          onDragStart={() => { drag.current = { side, index: i } }}
          onDragOver={(e) => { if (drag.current?.side === side) e.preventDefault() }}
          onDrop={onDrop(side, i)}
          className="flex items-center gap-1.5 rounded border border-hextech-border-dim bg-hextech-black/30 px-1.5 py-1 text-xs"
        >
          <span className="w-6 font-mono text-[10px] text-hextech-text-dim">{slotOf(side, i)}</span>
          <button
            type="button"
            ref={(el) => { handles.current.set(`${side}-${champion}`, el) }}
            onKeyDown={onKey(side, i)}
            aria-label={t('analyst.draftLog.pickOrder.handle', { champion, slot: slotOf(side, i) })}
            className="cursor-grab rounded text-hextech-text-dim hover:text-hextech-text-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hextech-gold"
          >
            <GripVertical className="h-3.5 w-3.5" aria-hidden />
          </button>
          <ChampIcon championKey={champion} size={20} />
          <span className="min-w-0 flex-1 truncate text-hextech-text-bright">{champion}</span>
          <button type="button" onClick={() => move(side, i, i - 1)} disabled={i === 0}
            aria-label={t('analyst.draftLog.pickOrder.up', { champion })}
            className="rounded p-0.5 text-hextech-text-dim hover:text-hextech-text-bright disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hextech-gold">
            <ChevronUp className="h-3.5 w-3.5" aria-hidden />
          </button>
          <button type="button" onClick={() => move(side, i, i + 1)} disabled={i === order[side].length - 1}
            aria-label={t('analyst.draftLog.pickOrder.down', { champion })}
            className="rounded p-0.5 text-hextech-text-dim hover:text-hextech-text-bright disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hextech-gold">
            <ChevronDown className="h-3.5 w-3.5" aria-hidden />
          </button>
        </li>
      ))}
    </ol>
  )

  if (!complete) return <p className="text-xs text-hextech-text-dim">{t('analyst.draftLog.pickOrder.incomplete')}</p>
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-hextech-text-dim">{t('analyst.draftLog.pickOrder.hint')}</p>
      <div className="grid grid-cols-2 gap-2">
        <div className={cn('space-y-1')}><p className="text-[10px] font-semibold uppercase text-sky-300">{t('analyst.common.side.blue')}</p>{column('blue')}</div>
        <div className="space-y-1"><p className="text-[10px] font-semibold uppercase text-rose-300">{t('analyst.common.side.red')}</p>{column('red')}</div>
      </div>
      <p aria-live="polite" className="sr-only">{announce}</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={!dirty && entry.pickOrder != null} onClick={() => onSave(joinPickOrder(order.blue, order.red))}>{t('analyst.draftLog.pickOrder.save')}</Button>
        {entry.pickOrder && <Button size="sm" variant="outline" onClick={() => onSave(null)}>{t('analyst.draftLog.pickOrder.clear')}</Button>}
      </div>
    </div>
  )
}
