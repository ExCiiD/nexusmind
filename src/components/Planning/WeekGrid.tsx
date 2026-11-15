import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AvailabilityException, CalendarEvent } from '@/lib/calendar'
import type { ScrimSummary } from '@/lib/scrims'

export const HOUR_START = 8
export const HOUR_END = 24
const ROW_HEIGHT = 32 // px per hour
const RAIL_WIDTH = 16 // px, the per-day "my availability" rail

export interface HourRange { day: Date; startHour: number; endHour: number }

const toDateKey = (d: Date) => d.toISOString().slice(0, 10)
const clampHour = (h: number) => Math.min(HOUR_END, Math.max(HOUR_START, h))

const KIND_COLOR: Record<CalendarEvent['kind'], string> = {
  tournament: 'bg-hextech-gold/25 border-hextech-gold/60 text-hextech-gold-bright',
  scrim: 'bg-emerald-500/20 border-emerald-500/60 text-emerald-200',
  flex: 'bg-cyan-500/20 border-cyan-500/60 text-cyan-200',
  team_review: 'bg-purple-500/20 border-purple-500/60 text-purple-200',
  one_on_one: 'bg-blue-500/20 border-blue-500/60 text-blue-200',
  meeting: 'bg-orange-500/20 border-orange-500/60 text-orange-200',
  soloq_block: 'bg-zinc-500/20 border-zinc-500/60 text-zinc-200',
  rest: 'bg-zinc-700/30 border-zinc-600/50 text-zinc-300',
  other: 'bg-hextech-elevated border-hextech-border-dim text-hextech-text',
}

/**
 * Google-Calendar-style hour grid (Phase 1, docs/PLAN_GESTION_EQUIPE.md §9).
 * Two independent drag surfaces per day column: the wide main lane (team
 * events) and a narrow side rail (the viewer's own availability) — kept as
 * physically separate hit areas so a drag is never ambiguous between the
 * two, rather than a mode toggle. Whole-hour snapping on drag; the popup
 * that opens afterward lets the user fine-tune the exact time.
 */
interface Props {
  days: Date[]
  events: CalendarEvent[]
  scrims: ScrimSummary[]
  myAvailabilityExceptions: AvailabilityException[]
  canEditCalendar: boolean
  onSelectEventRange: (range: HourRange) => void
  onSelectAvailabilityRange: (range: HourRange) => void
  onRemoveAvailabilityException: (id: string) => void
  onEventClick: (event: CalendarEvent) => void
}

export function WeekGrid({
  days, events, scrims, myAvailabilityExceptions, canEditCalendar,
  onSelectEventRange, onSelectAvailabilityRange, onRemoveAvailabilityException, onEventClick,
}: Props) {
  const { i18n } = useTranslation()
  const columnRefs = useRef<Array<HTMLDivElement | null>>([])
  const [drag, setDrag] = useState<{ dayIndex: number; lane: 'event' | 'availability'; startHour: number; endHour: number } | null>(null)

  const hourAt = useCallback((dayIndex: number, clientY: number): number => {
    const el = columnRefs.current[dayIndex]
    if (!el) return HOUR_START
    const rect = el.getBoundingClientRect()
    const hour = HOUR_START + (clientY - rect.top) / ROW_HEIGHT
    return clampHour(Math.round(hour))
  }, [])

  const beginDrag = (dayIndex: number, lane: 'event' | 'availability') => (e: React.MouseEvent) => {
    if (lane === 'event' && !canEditCalendar) return
    e.preventDefault()
    const hour = hourAt(dayIndex, e.clientY)
    setDrag({ dayIndex, lane, startHour: hour, endHour: hour })

    const onMove = (ev: MouseEvent) => {
      setDrag((prev) => (prev ? { ...prev, endHour: hourAt(dayIndex, ev.clientY) } : prev))
    }
    const onUp = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      const endHour = hourAt(dayIndex, ev.clientY)
      const start = Math.min(hour, endHour)
      const end = Math.max(hour, endHour, start + 1)
      const range: HourRange = { day: days[dayIndex], startHour: start, endHour: end }
      if (lane === 'event') onSelectEventRange(range)
      else onSelectAvailabilityRange(range)
      setDrag(null)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const hours = Array.from({ length: HOUR_END - HOUR_START }, (_, i) => HOUR_START + i)
  const gridHeight = hours.length * ROW_HEIGHT

  return (
    <div className="flex overflow-x-auto rounded-lg border border-hextech-border-dim">
      {/* Time labels */}
      <div className="shrink-0" style={{ width: 44 }}>
        <div className="h-8 border-b border-hextech-border-dim" />
        {hours.map((h) => (
          <div key={h} className="flex items-start justify-end border-b border-hextech-border-dim/40 pr-1 text-[10px] text-hextech-text-dim" style={{ height: ROW_HEIGHT }}>
            {String(h).padStart(2, '0')}:00
          </div>
        ))}
      </div>

      {days.map((day, dayIndex) => {
        const key = toDateKey(day)
        const dayEvents = events.filter((e) => e.startsAt.slice(0, 10) === key)
        const dayScrims = scrims.filter((s) => s.scheduledAt.slice(0, 10) === key)
        const dayExceptions = myAvailabilityExceptions.filter((ex) => ex.date === key && ex.available)
        const isDraggingHere = drag?.dayIndex === dayIndex
        const draftStart = isDraggingHere ? Math.min(drag.startHour, drag.endHour) : null
        const draftEnd = isDraggingHere ? Math.max(drag.startHour, drag.endHour, (draftStart ?? 0) + 1) : null

        return (
          <div key={key} className="flex-1 min-w-[120px] border-l border-hextech-border-dim">
            <div className="flex h-8 items-center justify-center border-b border-hextech-border-dim text-[11px] font-semibold uppercase tracking-wide text-hextech-text-dim">
              {day.toLocaleDateString(i18n.language, { weekday: 'short', day: 'numeric' })}
            </div>
            <div className="relative flex" style={{ height: gridHeight }}>
              {/* Main lane: team events */}
              <div
                ref={(el) => { columnRefs.current[dayIndex] = el }}
                className={cn('relative flex-1', canEditCalendar && 'cursor-pointer')}
                onMouseDown={beginDrag(dayIndex, 'event')}
              >
                {hours.map((h) => (
                  <div key={h} className="border-b border-hextech-border-dim/30" style={{ height: ROW_HEIGHT }} />
                ))}
                {dayScrims.map((s) => {
                  const start = new Date(s.scheduledAt).getHours() + new Date(s.scheduledAt).getMinutes() / 60
                  const durH = s.durationMin / 60
                  if (start < HOUR_START || start >= HOUR_END) return null
                  return (
                    <div
                      key={`scrim-${s.id}`}
                      title={`${s.title}${s.opponent ? ` vs ${s.opponent}` : ''}`}
                      className="absolute left-0.5 right-0.5 overflow-hidden rounded border border-emerald-500/60 bg-emerald-500/20 px-1 py-0.5 text-[10px] text-emerald-200"
                      style={{ top: (start - HOUR_START) * ROW_HEIGHT, height: Math.max(ROW_HEIGHT * durH, 16) }}
                    >
                      {s.title}{s.opponent ? ` vs ${s.opponent}` : ''}
                    </div>
                  )
                })}
                {dayEvents.map((e) => {
                  const startDate = new Date(e.startsAt)
                  const start = startDate.getHours() + startDate.getMinutes() / 60
                  const durH = (new Date(e.endsAt).getTime() - startDate.getTime()) / 3_600_000
                  if (start < HOUR_START || start >= HOUR_END) return null
                  return (
                    <button
                      key={e.id}
                      title={e.title}
                      onMouseDown={(ev) => ev.stopPropagation()}
                      onClick={(ev) => { ev.stopPropagation(); onEventClick(e) }}
                      className={cn('absolute left-0.5 right-0.5 overflow-hidden rounded border px-1 py-0.5 text-left text-[10px]', KIND_COLOR[e.kind])}
                      style={{ top: (start - HOUR_START) * ROW_HEIGHT, height: Math.max(ROW_HEIGHT * durH, 16) }}
                    >
                      {e.title}
                    </button>
                  )
                })}
                {isDraggingHere && drag.lane === 'event' && draftStart !== null && draftEnd !== null && (
                  <div
                    className="pointer-events-none absolute left-0.5 right-0.5 rounded border-2 border-dashed border-hextech-gold bg-hextech-gold/15"
                    style={{ top: (draftStart - HOUR_START) * ROW_HEIGHT, height: (draftEnd - draftStart) * ROW_HEIGHT }}
                  />
                )}
              </div>

              {/* Availability rail: the viewer's own, click-drag to mark free */}
              <div
                className="relative shrink-0 cursor-pointer border-l border-hextech-border-dim/50 bg-black/10"
                style={{ width: RAIL_WIDTH }}
                onMouseDown={beginDrag(dayIndex, 'availability')}
              >
                {dayExceptions.map((ex) => {
                  const start = ex.startTime ? Number(ex.startTime.slice(0, 2)) + Number(ex.startTime.slice(3, 5)) / 60 : HOUR_START
                  const end = ex.endTime ? Number(ex.endTime.slice(0, 2)) + Number(ex.endTime.slice(3, 5)) / 60 : HOUR_END
                  return (
                    <button
                      key={ex.id}
                      title="Available — click to remove"
                      onMouseDown={(ev) => ev.stopPropagation()}
                      onClick={(ev) => { ev.stopPropagation(); onRemoveAvailabilityException(ex.id) }}
                      className="group absolute inset-x-0 flex items-center justify-center rounded-sm border border-hextech-green/60 bg-hextech-green/30 hover:bg-[#E24C3A]/40"
                      style={{ top: (clampHour(start) - HOUR_START) * ROW_HEIGHT, height: Math.max((clampHour(end) - clampHour(start)) * ROW_HEIGHT, 8) }}
                    >
                      <X className="hidden h-2.5 w-2.5 text-white group-hover:block" />
                    </button>
                  )
                })}
                {isDraggingHere && drag.lane === 'availability' && draftStart !== null && draftEnd !== null && (
                  <div
                    className="pointer-events-none absolute inset-x-0 rounded-sm border-2 border-dashed border-hextech-green bg-hextech-green/20"
                    style={{ top: (draftStart - HOUR_START) * ROW_HEIGHT, height: (draftEnd - draftStart) * ROW_HEIGHT }}
                  />
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
