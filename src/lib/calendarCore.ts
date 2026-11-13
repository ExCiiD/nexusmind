import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  AvailabilityException, AvailabilityRule, CalendarEvent, CommonFreeWindow,
  NewAvailabilityExceptionInput, NewAvailabilityRuleInput, NewEventInput,
} from './calendar'

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
