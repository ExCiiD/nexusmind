/** Renderer-side mirror of the shared planning tables (E4, extended in the
 *  Planning rework — see docs/PLAN_GESTION_EQUIPE.md §9 Phase 1). */
import { randomHexToken } from './tokens'

export type CalendarEventKind =
  | 'tournament' | 'team_review' | 'one_on_one' | 'soloq_block' | 'rest' | 'other' | 'warmup_draft'
  | 'scrim' | 'flex' | 'meeting'

/** Quick-select for "people concerned" on event creation — `custom` means
 *  the explicit `attendeeUserIds` list is authoritative; the other three are
 *  resolved once at creation time (see `resolveAttendeeScope` in
 *  calendarCore.ts) into a snapshot, not re-evaluated against the live
 *  roster later. */
export type AttendeeScope = 'whole_team' | 'all_players' | 'all_staff' | 'custom'

export interface CalendarEvent {
  id: string
  groupId: string
  kind: CalendarEventKind
  title: string
  startsAt: string
  endsAt: string
  notes: string | null
  /** Set when kind is 'scrim'/'flex' and the event is tied to a real `scrims` row. */
  linkedScrimId: string | null
  attendeeScope: AttendeeScope
  /** The resolved, snapshotted attendee list (see AttendeeScope doc above). */
  attendeeUserIds: string[]
  /** Who said they'll be there or can't come (calendar_event_responses). */
  responses?: EventResponse[]
  createdBy: string
  createdAt: string
  updatedAt: string
}

export type EventResponseStatus = 'confirmed' | 'declined'

/** A player's answer to an event, set with respond_to_calendar_event. */
export interface EventResponse {
  userId: string
  status: EventResponseStatus
  /** Why they can't come, when they said. */
  note: string | null
  respondedAt: string
}

export interface NewEventInput {
  kind: CalendarEventKind
  title: string
  startsAt: string
  endsAt: string
  notes?: string | null
  linkedScrimId?: string | null
  attendeeScope?: AttendeeScope
  /** Required when attendeeScope is 'custom' (or omitted); ignored otherwise
   *  since the other three scopes are resolved server-side from the roster. */
  attendeeUserIds?: string[]
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

export type EventRequestStatus = 'pending' | 'accepted' | 'declined'

/** "Request an event" (Phase 1) — purely informational: it never writes a
 *  real CalendarEvent, it's a queue a calendar editor reads and acts on by
 *  hand (e.g. by creating the real event themselves). */
export interface CalendarEventRequest {
  id: string
  groupId: string
  requestedBy: string
  eventName: string
  /** Free-text names/labels the requester typed — not resolved user ids,
   *  since this is informational only. */
  peopleConcerned: string[]
  preferredStart: string | null
  preferredEnd: string | null
  status: EventRequestStatus
  createdAt: string
}

export interface NewEventRequestInput {
  eventName: string
  peopleConcerned: string[]
  preferredStart?: string | null
  preferredEnd?: string | null
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

/** Live calendar subscription (E4 v2) — the stable token a calendar app
 *  (Google/Apple/Outlook) polls on its own schedule, unlike the v1
 *  point-in-time "Export .ics" download. Served by the `team-calendar-ics`
 *  Edge Function (supabase/functions/team-calendar-ics), which has no
 *  Ascend session to check — the token itself is the only secret. */
export interface CalendarSubscription {
  id: string
  groupId: string
  token: string
  createdBy: string
  createdAt: string
  /** Full URL to paste into Google/Apple/Outlook "subscribe by URL". */
  icsUrl: string
}

/** 40 hex chars (160 bits) via Web Crypto — long-lived and unguessable,
 *  unlike the short human-typed codes in discord.ts (short TTL, one-time
 *  use is enough security there; this token has neither). */
export function generateCalendarSubscriptionToken(): string {
  return randomHexToken(20)
}

export interface CalendarApi {
  calendarListEvents: (groupId: string, fromISO: string, toISO: string) => Promise<CalendarEvent[]>
  calendarGetEvent: (id: string) => Promise<CalendarEvent | null>
  calendarCreateEvent: (groupId: string, input: NewEventInput) => Promise<string>
  calendarUpdateEvent: (id: string, input: NewEventInput) => Promise<void>
  calendarDeleteEvent: (id: string) => Promise<void>
  /** "I'll be there" / "I can't come" — management is told about an absence. */
  calendarRespond: (eventId: string, status: EventResponseStatus, note?: string | null) => Promise<void>
  availabilityListRules: (groupId: string) => Promise<AvailabilityRule[]>
  availabilitySetRule: (groupId: string, input: NewAvailabilityRuleInput) => Promise<string>
  availabilityDeleteRule: (id: string) => Promise<void>
  availabilityListExceptions: (groupId: string, fromDate: string, toDate: string) => Promise<AvailabilityException[]>
  availabilitySetException: (groupId: string, input: NewAvailabilityExceptionInput) => Promise<string>
  availabilityDeleteException: (id: string) => Promise<void>
  calendarGetSubscription: (groupId: string) => Promise<CalendarSubscription | null>
  calendarCreateSubscription: (groupId: string) => Promise<CalendarSubscription>
  calendarRevokeSubscription: (id: string) => Promise<void>
  calendarCreateRequest: (groupId: string, input: NewEventRequestInput) => Promise<string>
  calendarListRequests: (groupId: string) => Promise<CalendarEventRequest[]>
  calendarSetRequestStatus: (id: string, status: Exclude<EventRequestStatus, 'pending'>) => Promise<void>
  calendarDeleteRequest: (id: string) => Promise<void>
}
