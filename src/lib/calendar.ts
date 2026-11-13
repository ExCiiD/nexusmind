/** Renderer-side mirror of the shared planning tables (E4). */

export type CalendarEventKind = 'tournament' | 'team_review' | 'one_on_one' | 'soloq_block' | 'rest' | 'other'

export interface CalendarEvent {
  id: string
  groupId: string
  kind: CalendarEventKind
  title: string
  startsAt: string
  endsAt: string
  notes: string | null
  createdBy: string
  createdAt: string
  updatedAt: string
}

export interface NewEventInput {
  kind: CalendarEventKind
  title: string
  startsAt: string
  endsAt: string
  notes?: string | null
}

/** "HH:MM" (24h). */
export type TimeString = string

export interface AvailabilityRule {
  id: string
  groupId: string
  userId: string
  /** 0 = Sunday, matches JS `Date#getDay()`. */
  weekday: number
  startTime: TimeString
  endTime: TimeString
}

export interface NewAvailabilityRuleInput {
  weekday: number
  startTime: TimeString
  endTime: TimeString
}

export interface AvailabilityException {
  id: string
  groupId: string
  userId: string
  /** "YYYY-MM-DD". */
  date: string
  available: boolean
  startTime: TimeString | null
  endTime: TimeString | null
  note: string | null
}

export interface NewAvailabilityExceptionInput {
  date: string
  available: boolean
  startTime?: TimeString | null
  endTime?: TimeString | null
  note?: string | null
}

/** A window, on one date, where every given user is free. */
export interface CommonFreeWindow {
  date: string
  startTime: TimeString
  endTime: TimeString
}

/**
 * All of this is server-only (no local Prisma data), so desktop and web
 * implement every method the same way — same pattern as devPlan.ts.
 */
/** Minimal VCALENDAR text for the given events — a point-in-time .ics download (no live subscription yet). */
export function eventsToICS(events: CalendarEvent[], calendarName: string): string {
  const fold = (s: string) => s.replace(/[\\,;]/g, (c) => `\\${c}`).replace(/\n/g, '\\n')
  const stamp = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Ascend//Planning//EN',
    `X-WR-CALNAME:${fold(calendarName)}`,
  ]
  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.id}@ascend`,
      `DTSTAMP:${stamp(e.updatedAt)}`,
      `DTSTART:${stamp(e.startsAt)}`,
      `DTEND:${stamp(e.endsAt)}`,
      `SUMMARY:${fold(e.title)}`,
      ...(e.notes ? [`DESCRIPTION:${fold(e.notes)}`] : []),
      'END:VEVENT',
    )
  }
  lines.push('END:VCALENDAR')
  return lines.join('\r\n')
}

export interface CalendarApi {
  calendarListEvents: (groupId: string, fromISO: string, toISO: string) => Promise<CalendarEvent[]>
  calendarCreateEvent: (groupId: string, input: NewEventInput) => Promise<string>
  calendarUpdateEvent: (id: string, input: NewEventInput) => Promise<void>
  calendarDeleteEvent: (id: string) => Promise<void>
  availabilityListRules: (groupId: string) => Promise<AvailabilityRule[]>
  availabilitySetRule: (groupId: string, input: NewAvailabilityRuleInput) => Promise<string>
  availabilityDeleteRule: (id: string) => Promise<void>
  availabilityListExceptions: (groupId: string, fromDate: string, toDate: string) => Promise<AvailabilityException[]>
  availabilitySetException: (groupId: string, input: NewAvailabilityExceptionInput) => Promise<string>
  availabilityDeleteException: (id: string) => Promise<void>
}
