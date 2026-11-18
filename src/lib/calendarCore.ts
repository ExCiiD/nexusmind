import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  AttendeeScope, AvailabilityException, AvailabilityRule, CalendarEvent, CalendarEventRequest, CalendarSubscription,
  CommonFreeWindow, EventRequestStatus, EventResponse, EventResponseStatus, NewAvailabilityExceptionInput, NewAvailabilityRuleInput,
  NewEventInput, NewEventRequestInput,
} from './calendar'
import { generateCalendarSubscriptionToken } from './calendar'
import type { GroupMember } from './collab'

/**
 * Planning & presence (E4), same pattern as teamCore.ts/devPlanCore.ts.
 * Purely server-side — desktop and web call these identically.
 */

function fail(error: { message: string; code?: string } | null, fallback: string): never {
  const msg = error?.message ?? fallback
  if (/permission|forbidden/i.test(msg) || error?.code === '42501') throw new Error('FORBIDDEN')
  throw new Error(msg)
}

interface EventRow {
  id: string; group_id: string; kind: CalendarEvent['kind']; title: string; starts_at: string; ends_at: string
  notes: string | null; linked_scrim_id: string | null; attendee_scope: AttendeeScope
  created_by: string; created_at: string; updated_at: string
}
interface RuleRow { id: string; group_id: string; user_id: string; weekday: number; start_time: string; end_time: string }
interface ExceptionRow { id: string; group_id: string; user_id: string; date: string; available: boolean; start_time: string | null; end_time: string | null; note: string | null }
interface EventRequestRow {
  id: string; group_id: string; requested_by: string; event_name: string; people_concerned: string[]
  preferred_start: string | null; preferred_end: string | null; status: EventRequestStatus; created_at: string
}

const EVENT_SELECT = 'id, group_id, kind, title, starts_at, ends_at, notes, linked_scrim_id, attendee_scope, created_by, created_at, updated_at'

const toEvent = (r: EventRow, attendeeUserIds: string[]): CalendarEvent => ({
  id: r.id, groupId: r.group_id, kind: r.kind, title: r.title, startsAt: r.starts_at, endsAt: r.ends_at,
  notes: r.notes, linkedScrimId: r.linked_scrim_id, attendeeScope: r.attendee_scope, attendeeUserIds,
  createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at,
})
const toEventRequest = (r: EventRequestRow): CalendarEventRequest => ({
  id: r.id, groupId: r.group_id, requestedBy: r.requested_by, eventName: r.event_name, peopleConcerned: r.people_concerned,
  preferredStart: r.preferred_start, preferredEnd: r.preferred_end, status: r.status, createdAt: r.created_at,
})
const toRule = (r: RuleRow): AvailabilityRule => ({
  id: r.id, groupId: r.group_id, userId: r.user_id, weekday: r.weekday,
  startTime: r.start_time.slice(0, 5), endTime: r.end_time.slice(0, 5),
})
const toException = (r: ExceptionRow): AvailabilityException => ({
  id: r.id, groupId: r.group_id, userId: r.user_id, date: r.date, available: r.available,
  startTime: r.start_time?.slice(0, 5) ?? null, endTime: r.end_time?.slice(0, 5) ?? null, note: r.note,
})

/** Bulk-fetches attendees for a batch of event ids, grouped by event. Split
 *  out of `listEvents` so `getEvent` (single-event) can reuse it too. */
async function attendeesByEvent(sb: SupabaseClient, eventIds: string[]): Promise<Map<string, string[]>> {
  const byEvent = new Map<string, string[]>()
  if (eventIds.length === 0) return byEvent
  const { data, error } = await sb.from('calendar_event_attendees').select('event_id, user_id').in('event_id', eventIds)
  if (error) fail(error, 'list event attendees')
  for (const r of data ?? []) byEvent.set(r.event_id, [...(byEvent.get(r.event_id) ?? []), r.user_id])
  return byEvent
}

/** Presence answers for a batch of events. Empty, not an error, when the
 *  table isn't there yet (before 20261118200000_captain_roles_presence):
 *  the planning keeps working without them. */
async function responsesByEvent(sb: SupabaseClient, eventIds: string[]): Promise<Map<string, EventResponse[]>> {
  const byEvent = new Map<string, EventResponse[]>()
  if (eventIds.length === 0) return byEvent
  try {
    const { data, error } = await sb.from('calendar_event_responses')
      .select('event_id, user_id, status, note, responded_at').in('event_id', eventIds)
    if (error) return byEvent
    for (const r of data ?? []) {
      const response: EventResponse = { userId: r.user_id, status: r.status, note: r.note, respondedAt: r.responded_at }
      byEvent.set(r.event_id, [...(byEvent.get(r.event_id) ?? []), response])
    }
  } catch { /* no answers rather than no planning */ }
  return byEvent
}

export async function listEvents(sb: SupabaseClient, groupId: string, fromISO: string, toISO: string): Promise<CalendarEvent[]> {
  const { data, error } = await sb.from('calendar_events')
    .select(EVENT_SELECT).eq('group_id', groupId).gte('starts_at', fromISO).lt('starts_at', toISO).order('starts_at')
  if (error) fail(error, 'list events')
  const rows = data as EventRow[]
  const ids = rows.map((r) => r.id)
  const [byEvent, answers] = await Promise.all([attendeesByEvent(sb, ids), responsesByEvent(sb, ids)])
  return rows.map((r) => ({ ...toEvent(r, byEvent.get(r.id) ?? []), responses: answers.get(r.id) ?? [] }))
}

/**
 * The caller's answer to an event: present, or can't come (with an optional
 * reason). The RPC checks the event concerns them and hasn't ended, and
 * tells the management about an absence (in-app; the Discord bot relays it
 * as a direct message).
 */
export async function respondToEvent(sb: SupabaseClient, eventId: string, status: EventResponseStatus, note?: string | null): Promise<void> {
  const { error } = await sb.rpc('respond_to_calendar_event', { p_event: eventId, p_status: status, p_note: note ?? null })
  if (!error) return
  for (const code of ['NOT_CONCERNED', 'EVENT_OVER']) if (error.message?.includes(code)) throw new Error(code)
  fail(error, 'respond to event')
}

/** Single-event lookup — the one caller that doesn't already have a date
 *  range in hand (TeamSessionPage, opened by calendarEventId alone, e.g.
 *  from a direct link or after a page reload). */
export async function getEvent(sb: SupabaseClient, id: string): Promise<CalendarEvent | null> {
  const { data, error } = await sb.from('calendar_events').select(EVENT_SELECT).eq('id', id).maybeSingle()
  if (error) fail(error, 'get event')
  if (!data) return null
  const [byEvent, answers] = await Promise.all([attendeesByEvent(sb, [data.id]), responsesByEvent(sb, [data.id])])
  return { ...toEvent(data as EventRow, byEvent.get(data.id) ?? []), responses: answers.get(data.id) ?? [] }
}

export async function createEvent(sb: SupabaseClient, groupId: string, input: NewEventInput): Promise<string> {
  const { data, error } = await sb.from('calendar_events').insert({
    group_id: groupId, kind: input.kind, title: input.title, starts_at: input.startsAt, ends_at: input.endsAt,
    notes: input.notes ?? null, linked_scrim_id: input.linkedScrimId ?? null, attendee_scope: input.attendeeScope ?? 'custom',
  }).select('id').single()
  if (error) fail(error, 'create event')
  const attendeeUserIds = input.attendeeUserIds ?? []
  if (attendeeUserIds.length > 0) {
    const { error: attErr } = await sb.from('calendar_event_attendees').insert(attendeeUserIds.map((userId) => ({ event_id: data.id, user_id: userId })))
    if (attErr) fail(attErr, 'set event attendees')
  }
  return data.id
}

export async function updateEvent(sb: SupabaseClient, id: string, input: NewEventInput): Promise<void> {
  const { error } = await sb.from('calendar_events').update({
    kind: input.kind, title: input.title, starts_at: input.startsAt, ends_at: input.endsAt, notes: input.notes ?? null,
    linked_scrim_id: input.linkedScrimId ?? null, attendee_scope: input.attendeeScope ?? 'custom',
  }).eq('id', id)
  if (error) fail(error, 'update event')
  // Attendees aren't part of this row — replace the snapshot wholesale when
  // the caller provides one (omitting attendeeUserIds leaves it untouched).
  if (input.attendeeUserIds) {
    const { error: delErr } = await sb.from('calendar_event_attendees').delete().eq('event_id', id)
    if (delErr) fail(delErr, 'clear event attendees')
    if (input.attendeeUserIds.length > 0) {
      const { error: attErr } = await sb.from('calendar_event_attendees').insert(input.attendeeUserIds.map((userId) => ({ event_id: id, user_id: userId })))
      if (attErr) fail(attErr, 'set event attendees')
    }
  }
}

export async function deleteEvent(sb: SupabaseClient, id: string): Promise<void> {
  const { error } = await sb.from('calendar_events').delete().eq('id', id)
  if (error) fail(error, 'delete event')
}

/** Resolves an attendee quick-select scope against the group's current
 *  roster into a concrete user-id list — the result is what actually gets
 *  written (a snapshot), the scope itself is kept only for display/re-editing
 *  (see CalendarEvent.attendeeScope's doc comment in calendar.ts). */
export function resolveAttendeeScope(scope: AttendeeScope, members: GroupMember[], customUserIds: string[] = []): string[] {
  switch (scope) {
    case 'whole_team': return members.map((m) => m.userId)
    case 'all_players': return members.filter((m) => m.role === 'player').map((m) => m.userId)
    case 'all_staff': return members.filter((m) => m.role !== 'player').map((m) => m.userId)
    case 'custom': return customUserIds
  }
}

// ── "Request an event" (Phase 1) — informational only, never writes a real
// calendar_events row. ───────────────────────────────────────────────────

export async function createEventRequest(sb: SupabaseClient, groupId: string, input: NewEventRequestInput): Promise<string> {
  const { data, error } = await sb.from('calendar_event_requests').insert({
    group_id: groupId, event_name: input.eventName, people_concerned: input.peopleConcerned,
    preferred_start: input.preferredStart ?? null, preferred_end: input.preferredEnd ?? null,
  }).select('id').single()
  if (error) fail(error, 'create event request')
  return data.id
}

export async function listEventRequests(sb: SupabaseClient, groupId: string): Promise<CalendarEventRequest[]> {
  const { data, error } = await sb.from('calendar_event_requests')
    .select('id, group_id, requested_by, event_name, people_concerned, preferred_start, preferred_end, status, created_at')
    .eq('group_id', groupId).order('created_at', { ascending: false })
  if (error) fail(error, 'list event requests')
  return (data as EventRequestRow[]).map(toEventRequest)
}

export async function setEventRequestStatus(sb: SupabaseClient, id: string, status: Exclude<EventRequestStatus, 'pending'>): Promise<void> {
  const { error } = await sb.from('calendar_event_requests').update({ status }).eq('id', id)
  if (error) fail(error, 'set event request status')
}

export async function deleteEventRequest(sb: SupabaseClient, id: string): Promise<void> {
  const { error } = await sb.from('calendar_event_requests').delete().eq('id', id)
  if (error) fail(error, 'delete event request')
}

export async function listAvailabilityRules(sb: SupabaseClient, groupId: string): Promise<AvailabilityRule[]> {
  const { data, error } = await sb.from('availability_rules')
    .select('id, group_id, user_id, weekday, start_time, end_time').eq('group_id', groupId).order('weekday')
  if (error) fail(error, 'list rules')
  return (data as RuleRow[]).map(toRule)
}

export async function setAvailabilityRule(sb: SupabaseClient, groupId: string, input: NewAvailabilityRuleInput): Promise<string> {
  const { data, error } = await sb.from('availability_rules').insert({
    group_id: groupId, weekday: input.weekday, start_time: input.startTime, end_time: input.endTime,
  }).select('id').single()
  if (error) fail(error, 'set rule')
  return data.id
}

export async function deleteAvailabilityRule(sb: SupabaseClient, id: string): Promise<void> {
  const { error } = await sb.from('availability_rules').delete().eq('id', id)
  if (error) fail(error, 'delete rule')
}

export async function listAvailabilityExceptions(sb: SupabaseClient, groupId: string, fromDate: string, toDate: string): Promise<AvailabilityException[]> {
  const { data, error } = await sb.from('availability_exceptions')
    .select('id, group_id, user_id, date, available, start_time, end_time, note')
    .eq('group_id', groupId).gte('date', fromDate).lte('date', toDate).order('date')
  if (error) fail(error, 'list exceptions')
  return (data as ExceptionRow[]).map(toException)
}

export async function setAvailabilityException(sb: SupabaseClient, groupId: string, input: NewAvailabilityExceptionInput): Promise<string> {
  const { data, error } = await sb.from('availability_exceptions').upsert({
    group_id: groupId, date: input.date, available: input.available,
    start_time: input.startTime ?? null, end_time: input.endTime ?? null, note: input.note ?? null,
  }, { onConflict: 'group_id,user_id,date' }).select('id').single()
  if (error) fail(error, 'set exception')
  return data.id
}

export async function deleteAvailabilityException(sb: SupabaseClient, id: string): Promise<void> {
  const { error } = await sb.from('availability_exceptions').delete().eq('id', id)
  if (error) fail(error, 'delete exception')
}

// ── Live calendar subscription (E4 v2) ──────────────────────────────────

interface SubscriptionRow { id: string; group_id: string; token: string; created_by: string; created_at: string }
/** `baseUrl` is the project's own Supabase URL (`https://<ref>.supabase.co`)
 *  — desktop/web each know their own (electron/main/cloud/supabase.ts's
 *  `getSupabaseUrl()`, web/src/supabase.ts's `supabaseUrl`), so the ICS URL
 *  is computed here rather than stored (it's deterministic from the token
 *  and never changes independently of it). */
const toSubscription = (r: SubscriptionRow, baseUrl: string): CalendarSubscription => ({
  id: r.id, groupId: r.group_id, token: r.token, createdBy: r.created_by, createdAt: r.created_at,
  icsUrl: `${baseUrl}/functions/v1/team-calendar-ics/${r.token}.ics`,
})

/** The group's current live-subscription link, or null if none was
 *  generated yet. At most one per group (callers regenerate by deleting
 *  then creating, not by keeping several live). */
export async function getCalendarSubscription(sb: SupabaseClient, groupId: string, baseUrl: string): Promise<CalendarSubscription | null> {
  const { data, error } = await sb.from('calendar_subscriptions')
    .select('id, group_id, token, created_by, created_at').eq('group_id', groupId).maybeSingle()
  if (error) fail(error, 'get calendar subscription')
  return data ? toSubscription(data as SubscriptionRow, baseUrl) : null
}

export async function createCalendarSubscription(sb: SupabaseClient, groupId: string, baseUrl: string): Promise<CalendarSubscription> {
  const token = generateCalendarSubscriptionToken()
  const { data, error } = await sb.from('calendar_subscriptions')
    .insert({ group_id: groupId, token }).select('id, group_id, token, created_by, created_at').single()
  if (error) fail(error, 'create calendar subscription')
  return toSubscription(data as SubscriptionRow, baseUrl)
}

/** Revokes (deletes) the group's subscription — any calendar app still
 *  polling the old URL gets a 404 from then on. Callers generate a new one
 *  with `createCalendarSubscription` if they want live sync again. */
export async function revokeCalendarSubscription(sb: SupabaseClient, id: string): Promise<void> {
  const { error } = await sb.from('calendar_subscriptions').delete().eq('id', id)
  if (error) fail(error, 'revoke calendar subscription')
}

// ── pure scheduling helper (no I/O) ─────────────────────────────────────

const toMinutes = (t: string): number => {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}
const fromMinutes = (m: number): string => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

interface Interval { start: number; end: number }

function intersectAll(perUser: Interval[][]): Interval[] {
  if (perUser.length === 0) return []
  let common = perUser[0]
  for (const windows of perUser.slice(1)) {
    const next: Interval[] = []
    for (const a of common) {
      for (const b of windows) {
        const start = Math.max(a.start, b.start)
        const end = Math.min(a.end, b.end)
        if (start < end) next.push({ start, end })
      }
    }
    common = next
    if (common.length === 0) break
  }
  return common
}

/**
 * Is `userId` free (per their rules/exceptions) on this single `date`
 * ("YYYY-MM-DD")? Used by the Discord bot (E11) to suggest a same-role
 * replacement when someone marks themselves away on a scrim day — unlike
 * `findCommonAvailability`, this checks ONE user individually rather than
 * intersecting several, so it can answer "who (if anyone) is free" rather
 * than "when are all of these people free together".
 */
export function isUserAvailable(rules: AvailabilityRule[], exceptions: AvailabilityException[], userId: string, date: string): boolean {
  const exception = exceptions.find((e) => e.userId === userId && e.date === date)
  if (exception) return exception.available
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay()
  return rules.some((r) => r.userId === userId && r.weekday === weekday)
}

/**
 * For each of the 7 days starting at `weekStartDate` ("YYYY-MM-DD"), the
 * windows where every one of `starterUserIds` is free: a per-date exception
 * overrides that user's recurring rules for the day; with no exception, the
 * union of their rule windows for that weekday is used. Users with neither
 * (no rule, no exception) are treated as unavailable that day.
 */
export function findCommonAvailability(
  rules: AvailabilityRule[],
  exceptions: AvailabilityException[],
  starterUserIds: string[],
  weekStartDate: string,
): CommonFreeWindow[] {
  const out: CommonFreeWindow[] = []
  const start = new Date(`${weekStartDate}T00:00:00Z`)

  for (let i = 0; i < 7; i++) {
    const d = new Date(start)
    d.setUTCDate(start.getUTCDate() + i)
    const date = d.toISOString().slice(0, 10)
    const weekday = d.getUTCDay()

    const perUser: Interval[][] = starterUserIds.map((uid) => {
      const exception = exceptions.find((e) => e.userId === uid && e.date === date)
      if (exception) {
        if (!exception.available) return []
        if (exception.startTime && exception.endTime) return [{ start: toMinutes(exception.startTime), end: toMinutes(exception.endTime) }]
        return [{ start: 0, end: 24 * 60 }]
      }
      return rules
        .filter((r) => r.userId === uid && r.weekday === weekday)
        .map((r) => ({ start: toMinutes(r.startTime), end: toMinutes(r.endTime) }))
    })

    if (perUser.some((w) => w.length === 0)) continue
    for (const w of intersectAll(perUser)) {
      out.push({ date, startTime: fromMinutes(w.start), endTime: fromMinutes(w.end) })
    }
  }
  return out
}
