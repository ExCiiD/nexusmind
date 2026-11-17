import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AvailabilityException, AvailabilityRule, CalendarEvent, CommonFreeWindow } from '@/lib/calendar'
import type { ScrimSummary } from '@/lib/scrims'
import { KIND_STYLE, availableAnyTime, availableCount, localDateKey } from '@/lib/planningView'

export interface HourRange { day: Date; startHour: number; endHour: number }

/** "Esport hours" (16h–24h, taller rows) vs the full day (08h–24h). */
export type GridMode = 'esport' | 'day'
export const GRID_MODES: Record<GridMode, { start: number; end: number; rowHeight: number }> = {
  esport: { start: 16, end: 24, rowHeight: 56 },
  day: { start: 8, end: 24, rowHeight: 36 },
}
const RAIL_WIDTH = 12 // px, the per-day "my availability" rail

const toDateKey = localDateKey
const minutesOf = (iso: string) => { const d = new Date(iso); return d.getHours() * 60 + d.getMinutes() }
const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
const shortH = (min: number) => `${Math.floor(min / 60)}h${min % 60 ? String(min % 60).padStart(2, '0') : ''}`

/**
 * Week planning grid (redesign 17/11/2026, PLAN_GESTION_EQUIPE §9). Two
 * drag surfaces per day: the main lane (team events, staff only) and a thin
 * right rail (your own availability). Common-availability windows of the
 * starters are shaded behind the events; each event shows how many of its
 * attendees are free at that time.
 */
interface Props {
  days: Date[]
  mode: GridMode
  events: CalendarEvent[]
  scrims: ScrimSummary[]
  rules: AvailabilityRule[]
  exceptions: AvailabilityException[]
  starterIds: string[]
  commonFree: CommonFreeWindow[]
  myAvailabilityExceptions: AvailabilityException[]
  canEditCalendar: boolean
  onSelectEventRange: (range: HourRange) => void
  onSelectAvailabilityRange: (range: HourRange) => void
  onRemoveAvailabilityException: (id: string) => void
  onEventClick: (event: CalendarEvent) => void
  /** Event highlighted in the side inspector. */
  selectedEventId?: string | null
}

export function WeekGrid({
  days, mode, events, scrims, rules, exceptions, starterIds, commonFree, myAvailabilityExceptions, canEditCalendar,
  onSelectEventRange, onSelectAvailabilityRange, onRemoveAvailabilityException, onEventClick, selectedEventId,
}: Props) {
  const { t, i18n } = useTranslation()
  const { start: HOUR_START, end: HOUR_END, rowHeight: ROW } = GRID_MODES[mode]
  const columnRefs = useRef<Array<HTMLDivElement | null>>([])
  const [drag, setDrag] = useState<{ dayIndex: number; lane: 'event' | 'availability'; startHour: number; endHour: number } | null>(null)
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 60_000); return () => clearInterval(id) }, [])

  const clampHour = useCallback((h: number) => Math.min(HOUR_END, Math.max(HOUR_START, h)), [HOUR_START, HOUR_END])
  const hourAt = useCallback((dayIndex: number, clientY: number): number => {
    const el = columnRefs.current[dayIndex]
    if (!el) return HOUR_START
    const rect = el.getBoundingClientRect()
    return clampHour(Math.round(HOUR_START + (clientY - rect.top) / ROW))
  }, [HOUR_START, ROW, clampHour])

  const beginDrag = (dayIndex: number, lane: 'event' | 'availability') => (e: React.MouseEvent) => {
    if (lane === 'event' && !canEditCalendar) return
    e.preventDefault()
    const hour = hourAt(dayIndex, e.clientY)
    setDrag({ dayIndex, lane, startHour: hour, endHour: hour })
    const onMove = (ev: MouseEvent) => setDrag((prev) => (prev ? { ...prev, endHour: hourAt(dayIndex, ev.clientY) } : prev))
    const onUp = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      const endHour = hourAt(dayIndex, ev.clientY)
      const start = Math.min(hour, endHour)
      const end = Math.min(HOUR_END, Math.max(hour, endHour, start + 1))
      const range: HourRange = { day: days[dayIndex], startHour: start, endHour: end }
      if (lane === 'event') onSelectEventRange(range)
      else onSelectAvailabilityRange(range)
      setDrag(null)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const hours = Array.from({ length: HOUR_END - HOUR_START }, (_, i) => HOUR_START + i)
  const gridHeight = hours.length * ROW
  const top = (min: number) => (min / 60 - HOUR_START) * ROW
  const visible = (startMin: number) => startMin / 60 >= HOUR_START && startMin / 60 < HOUR_END
  const todayKey = toDateKey(now)
  const nowMin = now.getHours() * 60 + now.getMinutes()
  const showNow = days.some((d) => toDateKey(d) === todayKey) && visible(nowMin)
  const total = starterIds.length
  const offset = -now.getTimezoneOffset() / 60
  const tzLabel = `UTC${offset >= 0 ? '+' : ''}${offset}`

  return (
    <div className="overflow-x-auto rounded-xl border border-hextech-border-dim bg-hextech-black/60">
      <div className="flex min-w-[860px]">
        {/* Time column */}
        <div className="relative shrink-0 border-r border-hextech-border-dim" style={{ width: 64 }}>
          <div className="flex h-14 items-end justify-center border-b border-hextech-border-dim pb-2 font-mono text-[10px] text-hextech-text-dim">{tzLabel}</div>
          <div className="relative" style={{ height: gridHeight }}>
            {hours.map((h) => (
              <div key={h} className="flex justify-center border-b border-hextech-border-dim/40 pt-1 font-mono text-[11px] text-hextech-text" style={{ height: ROW }}>
                {String(h).padStart(2, '0')}:00
              </div>
            ))}
            {showNow && (
              <span className="absolute left-1 z-20 -translate-y-1/2 rounded bg-hextech-red px-1 font-mono text-[10px] font-bold text-white" style={{ top: top(nowMin) }}>
                {hhmm(nowMin)}
              </span>
            )}
          </div>
        </div>

        {days.map((day, dayIndex) => {
          const key = toDateKey(day)
          const isToday = key === todayKey
          const dayEvents = events.filter((e) => toDateKey(new Date(e.startsAt)) === key)
          const dayScrims = scrims.filter((s) => toDateKey(new Date(s.scheduledAt)) === key)
          const dayFree = commonFree.filter((w) => w.date === key)
          const dayExceptions = myAvailabilityExceptions.filter((ex) => ex.date === key && ex.available)
          const free = total ? availableAnyTime(rules, exceptions, starterIds, key) : 0
          const isDraggingHere = drag?.dayIndex === dayIndex
          const draftStart = isDraggingHere ? Math.min(drag.startHour, drag.endHour) : null
          const draftEnd = isDraggingHere ? Math.max(drag.startHour, drag.endHour, (draftStart ?? 0) + 1) : null

          return (
            <div key={key} className={cn('min-w-[110px] flex-1 border-r border-hextech-border-dim/60 last:border-r-0', isToday && 'bg-hextech-gold/[0.03]')}>
              {/* Day header */}
              <div className="flex h-14 flex-col items-center justify-center gap-1 border-b border-hextech-border-dim">
                <div className={cn('flex items-center gap-1.5 font-condensed text-base font-extrabold uppercase tracking-wide', isToday ? 'text-hextech-gold' : 'text-hextech-text-bright')}>
                  {day.toLocaleDateString(i18n.language, { weekday: 'short' }).replace('.', '')} {day.getDate()}
                  {isToday && <span className="rounded bg-hextech-gold px-1 font-mono text-[9px] font-bold text-hextech-black">{t('planning.grid.today')}</span>}
                </div>
                {total > 0 && (
                  <span className={cn('rounded px-1.5 font-mono text-[10px]', free === total ? 'bg-hextech-green/20 text-hextech-green' : 'text-hextech-text-dim')}>
                    {t('planning.grid.dayAvail', { free, total })}
                  </span>
                )}
              </div>

              <div className="relative flex" style={{ height: gridHeight }}>
                <div
                  ref={(el) => { columnRefs.current[dayIndex] = el }}
                  className={cn('relative flex-1', canEditCalendar && 'cursor-cell')}
                  onMouseDown={beginDrag(dayIndex, 'event')}
                >
                  {hours.map((h) => {
                    const inFree = dayFree.some((w) => Number(w.startTime.slice(0, 2)) <= h && h * 60 < Number(w.endTime.slice(0, 2)) * 60 + Number(w.endTime.slice(3, 5)))
                    return (
                      <div key={h} className="group/cell relative border-b border-hextech-border-dim/30" style={{ height: ROW }}>
                        {canEditCalendar && !drag && (
                          <span className={cn('pointer-events-none absolute right-1 top-1 z-[1] rounded px-1 font-mono text-[9px] font-bold uppercase opacity-0 transition-opacity group-hover/cell:opacity-100',
                            inFree ? 'bg-hextech-green/25 text-hextech-green' : 'bg-hextech-gold/20 text-hextech-gold')}>
                            {inFree ? t('planning.grid.hoverFree') : t('planning.grid.hoverAdd', { h })}
                          </span>
                        )}
                      </div>
                    )
                  })}

                  {/* Every starter free: shaded zone behind events */}
                  {dayFree.map((w, i) => {
                    const s = Math.max(Number(w.startTime.slice(0, 2)) * 60 + Number(w.startTime.slice(3, 5)), HOUR_START * 60)
                    const e = Math.min(Number(w.endTime.slice(0, 2)) * 60 + Number(w.endTime.slice(3, 5)), HOUR_END * 60)
                    if (e <= s) return null
                    return (
                      <div key={i} className="pointer-events-none absolute inset-x-0 border-y border-hextech-green/30 bg-hextech-green/[0.16] px-1.5 pt-1 font-mono text-[10px] leading-tight text-hextech-green/80" style={{ top: top(s), height: ((e - s) / 60) * ROW }}>
                        {total}/{total}<br />{t('planning.grid.free')}
                      </div>
                    )
                  })}

                  {dayScrims.map((s) => {
                    const startMin = minutesOf(s.scheduledAt)
                    if (!visible(startMin)) return null
                    return (
                      <EventCard key={`scrim-${s.id}`} accent={KIND_STYLE.scrim.accent} tag={t('planning.tag.scrim')}
                        time={`${shortH(startMin)}–${shortH(startMin + s.durationMin)}`} title={s.opponent ? `${s.title} vs ${s.opponent}` : s.title}
                        top={top(startMin)} height={(s.durationMin / 60) * ROW} />
                    )
                  })}

                  {dayEvents.map((e) => {
                    const startMin = minutesOf(e.startsAt)
                    if (!visible(startMin)) return null
                    const durMin = (new Date(e.endsAt).getTime() - new Date(e.startsAt).getTime()) / 60000
                    const att = e.attendeeUserIds.length
                    const freeAtt = att ? availableCount(rules, exceptions, e.attendeeUserIds, key, startMin, startMin + Math.min(durMin, 60)) : 0
                    return (
                      <EventCard key={e.id} accent={(KIND_STYLE[e.kind] ?? KIND_STYLE.other).accent} tag={t(`planning.tag.${e.kind}`, { defaultValue: e.kind })}
                        time={`${shortH(startMin)}–${shortH(startMin + durMin)}`} title={e.title} notes={e.notes}
                        attendance={att ? { free: freeAtt, total: att } : undefined}
                        top={top(startMin)} height={(durMin / 60) * ROW} selected={selectedEventId === e.id} onClick={() => onEventClick(e)} />
                    )
                  })}

                  {isDraggingHere && drag.lane === 'event' && draftStart !== null && draftEnd !== null && (
                    <div className="pointer-events-none absolute inset-x-1 rounded-md border-2 border-dashed border-hextech-gold bg-hextech-gold/15"
                      style={{ top: (draftStart - HOUR_START) * ROW, height: (draftEnd - draftStart) * ROW }} />
                  )}
                </div>

                {/* My availability rail */}
                <div
                  className="relative shrink-0 cursor-pointer border-l border-hextech-border-dim/40 bg-black/20 hover:bg-hextech-green/5"
                  style={{ width: RAIL_WIDTH }}
                  title={t('planning.grid.railHint')}
                  onMouseDown={beginDrag(dayIndex, 'availability')}
                >
                  {dayExceptions.map((ex) => {
                    const s = ex.startTime ? Number(ex.startTime.slice(0, 2)) + Number(ex.startTime.slice(3, 5)) / 60 : HOUR_START
                    const en = ex.endTime ? Number(ex.endTime.slice(0, 2)) + Number(ex.endTime.slice(3, 5)) / 60 : HOUR_END
                    return (
                      <button key={ex.id} title={t('planning.grid.removeAvail')}
                        onMouseDown={(ev) => ev.stopPropagation()}
                        onClick={(ev) => { ev.stopPropagation(); onRemoveAvailabilityException(ex.id) }}
                        className="group absolute inset-x-0 flex items-center justify-center rounded-sm border border-hextech-green/60 bg-hextech-green/30 hover:bg-hextech-red/40"
                        style={{ top: (clampHour(s) - HOUR_START) * ROW, height: Math.max((clampHour(en) - clampHour(s)) * ROW, 8) }}>
                        <X className="hidden h-2.5 w-2.5 text-white group-hover:block" />
                      </button>
                    )
                  })}
                  {isDraggingHere && drag.lane === 'availability' && draftStart !== null && draftEnd !== null && (
                    <div className="pointer-events-none absolute inset-x-0 rounded-sm border-2 border-dashed border-hextech-green bg-hextech-green/20"
                      style={{ top: (draftStart - HOUR_START) * ROW, height: (draftEnd - draftStart) * ROW }} />
                  )}
                </div>

                {/* Current time line */}
                {showNow && <div className="pointer-events-none absolute inset-x-0 z-10 h-px bg-hextech-red" style={{ top: top(nowMin) }} />}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function EventCard({ accent, tag, time, title, notes, attendance, top, height, selected, onClick }: {
  accent: string
  tag: string
  time: string
  title: string
  notes?: string | null
  attendance?: { free: number; total: number }
  top: number
  height: number
  selected?: boolean
  onClick?: () => void
}) {
  const h = Math.max(height, 26)
  const roomy = h >= 84
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      title={title}
      onMouseDown={(ev: React.MouseEvent) => ev.stopPropagation()}
      onClick={onClick ? (ev: React.MouseEvent) => { ev.stopPropagation(); onClick() } : undefined}
      aria-pressed={onClick ? !!selected : undefined}
      className={cn('absolute inset-x-1 z-[5] flex flex-col overflow-hidden rounded-md border border-l-[3px] px-2 py-1.5 text-left shadow-md transition-[filter] hover:brightness-125', selected && 'z-[6] ring-2 ring-hextech-gold ring-offset-1 ring-offset-hextech-black')}
      style={{ top: top + 1, height: h - 2, borderColor: `${accent}55`, borderLeftColor: accent, backgroundColor: `color-mix(in srgb, ${accent} 16%, var(--hextech-dark))` }}
    >
      <div className="flex items-start justify-between gap-1">
        <span className={cn('max-w-[64%] rounded border px-1 font-mono text-[9px] font-semibold uppercase leading-[1.25] tracking-wide', !roomy && 'truncate')} style={{ borderColor: `${accent}66`, color: accent }}>{tag}</span>
        <span className="shrink-0 font-mono text-[10px] font-bold text-hextech-text-bright">{time}</span>
      </div>
      <p className={cn('mt-1 font-condensed font-extrabold uppercase leading-[1.05] text-hextech-text-bright', roomy ? 'line-clamp-2 text-[15px]' : 'line-clamp-1 text-[13px]')}>{title}</p>
      {roomy && (notes || attendance) && (
        <div className="mt-auto flex items-center justify-between gap-1 border-t border-white/10 pt-1 text-[10px]">
          <span className="min-w-0 truncate text-hextech-text">{notes}</span>
          {attendance && (
            <span className={cn('flex shrink-0 items-center gap-0.5 font-mono font-semibold', attendance.free === attendance.total ? 'text-hextech-green' : 'text-amber-300')}>
              {attendance.free}/{attendance.total}{attendance.free === attendance.total && <Check className="h-3 w-3" />}
            </span>
          )}
        </div>
      )}
    </Tag>
  )
}
