import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  AvailabilityException, AvailabilityRule, CalendarEvent, CalendarSubscription, CommonFreeWindow,
  NewAvailabilityExceptionInput, NewAvailabilityRuleInput, NewEventInput,
} from './calendar'
import { generateCalendarSubscriptionToken } from './calendar'

/**
 * Planning & presence (E4), same pattern as teamCore.ts/devPlanCore.ts.
 * Purely server-side — desktop and web call these identically.
 */

function fail(error: { message: string; code?: string } | null, fallback: string): never {
  const msg = error?.message ?? fallback
  if (/permission|forbidden/i.test(msg) || error?.code === '42501') throw new Error('FORBIDDEN')
  throw new Error(msg)
}

interface EventRow { id: string; group_id: string; kind: CalendarEvent['kind']; title: string; starts_at: string; ends_at: string; notes: string | null; created_by: string; created_at: string; updated_at: string }
interface RuleRow { id: string; group_id: string; user_id: string; weekday: number; start_time: string; end_time: string }
interface ExceptionRow { id: string; group_id: string; user_id: string; date: string; available: boolean; start_time: string | null; end_time: string | null; note: string | null }

const toEvent = (r: EventRow): CalendarEvent => ({
  id: r.id, groupId: r.group_id, kind: r.kind, title: r.title, startsAt: r.starts_at, endsAt: r.ends_at,
  notes: r.notes, createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at,
})
const toRule = (r: RuleRow): AvailabilityRule => ({
  id: r.id, groupId: r.group_id, userId: r.user_id, weekday: r.weekday,
  startTime: r.start_time.slice(0, 5), endTime: r.end_time.slice(0, 5),
})
const toException = (r: ExceptionRow): AvailabilityException => ({
  id: r.id, groupId: r.group_id, userId: r.user_id, date: r.date, available: r.available,
  startTime: r.start_time?.slice(0, 5) ?? null, endTime: r.end_time?.slice(0, 5) ?? null, note: r.note,
})

export async function listEvents(sb: SupabaseClient, groupId: string, fromISO: string, toISO: string): Promise<CalendarEvent[]> {
  const { data, error } = await sb.from('calendar_events')
    .select('id, group_id, kind, title, starts_at, ends_at, notes, created_by, created_at, updated_at')
    .eq('group_id', groupId).gte('starts_at', fromISO).lt('starts_at', toISO).order('starts_at')
  if (error) fail(error, 'list events')
  return (data as EventRow[]).map(toEvent)
}

export async function createEvent(sb: SupabaseClient, groupId: string, input: NewEventInput): Promise<string> {
  const { data, error } = await sb.from('calendar_events').insert({
    group_id: groupId, kind: input.kind, title: input.title, starts_at: input.startsAt, ends_at: input.endsAt,
    notes: input.notes ?? null,
  }).select('id').single()
  if (error) fail(error, 'create event')
  return data.id
}

export async function updateEvent(sb: SupabaseClient, id: string, input: NewEventInput): Promise<void> {
  const { error } = await sb.from('calendar_events').update({
    kind: input.kind, title: input.title, starts_at: input.startsAt, ends_at: input.endsAt, notes: input.notes ?? null,
  }).eq('id', id)
  if (error) fail(error, 'update event')
}

export async function deleteEvent(sb: SupabaseClient, id: string): Promise<void> {
  const { error } = await sb.from('calendar_events').delete().eq('id', id)
  if (error) fail(error, 'delete event')
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
