/**
 * Planning grid & quick-slot popup (redesign of 17/11/2026). Pure — no I/O.
 *   - who among the starters is available at a given time / day;
 *   - the title the popup pre-fills from the people concerned;
 *   - inline autocomplete for the title field (Tab / Enter to accept).
 */
import type { AvailabilityException, AvailabilityRule, AttendeeScope, CalendarEvent, CalendarEventKind } from './calendar'
import type { GroupMember } from './collab'

const toMinutes = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m }

/** One user's free windows (minutes since midnight) on `date` ("YYYY-MM-DD"):
 *  a per-date exception overrides their recurring rules for that day. Same
 *  semantics as calendarCore.findCommonAvailability. */
export function userWindows(rules: AvailabilityRule[], exceptions: AvailabilityException[], userId: string, date: string): Array<{ start: number; end: number }> {
  const ex = exceptions.find((e) => e.userId === userId && e.date === date)
  if (ex) {
    if (!ex.available) return []
    if (ex.startTime && ex.endTime) return [{ start: toMinutes(ex.startTime), end: toMinutes(ex.endTime) }]
    return [{ start: 0, end: 24 * 60 }]
  }
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay()
  return rules.filter((r) => r.userId === userId && r.weekday === weekday).map((r) => ({ start: toMinutes(r.startTime), end: toMinutes(r.endTime) }))
}

/** How many of `userIds` are free for the whole [fromMin, toMin) span. */
export function availableCount(rules: AvailabilityRule[], exceptions: AvailabilityException[], userIds: string[], date: string, fromMin: number, toMin: number): number {
  return userIds.filter((uid) => userWindows(rules, exceptions, uid, date).some((w) => w.start <= fromMin && w.end >= toMin)).length
}

/** How many of `userIds` have any availability at all on `date`. */
export function availableAnyTime(rules: AvailabilityRule[], exceptions: AvailabilityException[], userIds: string[], date: string): number {
  return userIds.filter((uid) => userWindows(rules, exceptions, uid, date).length > 0).length
}

/* ─── Whose availability the planning follows ─── */

/**
 * The players the planning counts: the starters of the roster published to
 * the group when they're linked to an account, otherwise every member with
 * the player role. Without that fallback a group that never published its
 * roster showed no availability at all, even to its owner.
 */
export function planningPlayers(linkedStarterIds: string[], members: GroupMember[]): { ids: string[]; fromRoster: boolean } {
  if (linkedStarterIds.length > 0) return { ids: linkedStarterIds, fromRoster: true }
  return { ids: members.filter((m) => m.role === 'player').map((m) => m.userId), fromRoster: false }
}

export type DayAvailability =
  | { state: 'free'; windows: Array<{ start: number; end: number }> }
  | { state: 'off'; note: string | null }
  | { state: 'unknown' }

/** One player's day: free (with windows), marked unavailable, or nothing said. */
export function dayAvailability(rules: AvailabilityRule[], exceptions: AvailabilityException[], userId: string, date: string): DayAvailability {
  const ex = exceptions.find((e) => e.userId === userId && e.date === date)
  if (ex && !ex.available) return { state: 'off', note: ex.note }
  const windows = userWindows(rules, exceptions, userId, date)
  return windows.length > 0 ? { state: 'free', windows } : { state: 'unknown' }
}

/** "18:00–22:00" for a window in minutes. */
export function windowLabel(w: { start: number; end: number }): string {
  const hm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
  return `${hm(w.start)}–${hm(w.end)}`
}

/* ─── Presence at an event ─── */

export type Presence = 'confirmed' | 'declined' | 'free' | 'unknown'

/** What the planning knows of one attendee: their answer first, otherwise
 *  whether their availability covers the start of the event. */
export function presenceOf(
  event: CalendarEvent,
  userId: string,
  rules: AvailabilityRule[],
  exceptions: AvailabilityException[],
): { presence: Presence; note: string | null } {
  const answer = event.responses?.find((r) => r.userId === userId)
  if (answer) return { presence: answer.status, note: answer.note }
  const start = new Date(event.startsAt)
  const startMin = start.getHours() * 60 + start.getMinutes()
  const durMin = (Date.parse(event.endsAt) - start.getTime()) / 60000
  const free = availableCount(rules, exceptions, [userId], localDateKey(start), startMin, startMin + Math.min(durMin, 60)) === 1
  return { presence: free ? 'free' : 'unknown', note: null }
}

/** Counts for an event card: present (said so, or free without answering),
 *  declined, out of the attendees. */
export function attendanceOf(event: CalendarEvent, rules: AvailabilityRule[], exceptions: AvailabilityException[]): { present: number; declined: number; total: number } {
  let present = 0
  let declined = 0
  for (const id of event.attendeeUserIds) {
    const { presence } = presenceOf(event, id, rules, exceptions)
    if (presence === 'confirmed' || presence === 'free') present++
    else if (presence === 'declined') declined++
  }
  return { present, declined, total: event.attendeeUserIds.length }
}

/** Whether `userId` may answer the event: one of its attendees (or any
 *  member when it has no list), and it hasn't ended. */
export function canRespond(event: CalendarEvent, userId: string, now = Date.now()): boolean {
  if (Date.parse(event.endsAt) < now) return false
  return event.attendeeUserIds.length === 0 || event.attendeeUserIds.includes(userId)
}

/* ─── Kinds ─── */

/** Visual identity per event kind: short mono tag + accent colour. */
export const KIND_STYLE: Record<CalendarEventKind, { accent: string; tagKey: string }> = {
  scrim: { accent: '#E0A43C', tagKey: 'scrim' },
  flex: { accent: '#E0A43C', tagKey: 'flex' },
  tournament: { accent: '#E5483A', tagKey: 'tournament' },
  team_review: { accent: '#3FA894', tagKey: 'team_review' },
  warmup_draft: { accent: '#7BBF5A', tagKey: 'warmup_draft' },
  one_on_one: { accent: '#5B9BD5', tagKey: 'one_on_one' },
  meeting: { accent: '#D9823B', tagKey: 'meeting' },
  soloq_block: { accent: '#9AA0A8', tagKey: 'soloq_block' },
  rest: { accent: '#6B6F76', tagKey: 'rest' },
  other: { accent: '#8A6A34', tagKey: 'other' },
}

/* ─── Smart title from the people concerned ─── */

const STAFF_ROLES = new Set(['owner', 'coach', 'manager', 'analyst'])

export interface TitleSuggestion {
  /** i18n key under `planning.smartTitle`. */
  key: 'oneOnOne' | 'teamMeeting' | 'staffMeeting' | 'vodReview' | 'kind'
  /** Kind that best matches, when the attendees imply one. */
  kind?: CalendarEventKind
  /** The other person, for a 1:1. */
  name?: string
}

/**
 * Pre-fill rule for the slot title, from who is concerned:
 *  - exactly 2 people           → "1:1 <other person>"
 *  - the whole team (staff incl.) → team meeting
 *  - staff only                 → staff meeting
 *  - players + at least one coach/analyst, not everyone → VOD review
 *  - anything else              → the label of the chosen kind
 */
export function suggestTitle(scope: AttendeeScope, attendeeIds: string[], members: GroupMember[], myUserId: string): TitleSuggestion {
  if (scope === 'whole_team') return { key: 'teamMeeting', kind: 'meeting' }
  if (scope === 'all_staff') return { key: 'staffMeeting', kind: 'meeting' }
  if (scope !== 'custom') return { key: 'kind' }
  const people = members.filter((m) => attendeeIds.includes(m.userId))
  if (people.length === 2) {
    const other = people.find((m) => m.userId !== myUserId) ?? people[1]
    return { key: 'oneOnOne', kind: 'one_on_one', name: other.displayName || other.riotId || '' }
  }
  const staff = people.filter((m) => STAFF_ROLES.has(m.role))
  const players = people.filter((m) => m.role === 'player')
  if (people.length > 0 && people.length === members.length && staff.length > 0) return { key: 'teamMeeting', kind: 'meeting' }
  if (staff.length > 0 && players.length > 0) return { key: 'vodReview', kind: 'team_review' }
  if (staff.length > 0 && players.length === 0) return { key: 'staffMeeting', kind: 'meeting' }
  return { key: 'kind' }
}

/* ─── Title autocomplete ─── */

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** First suggestion that starts with what was typed (accent- and
 *  case-insensitive), and is longer than it; null otherwise. The returned
 *  value keeps the suggestion's own spelling. */
export function completeTitle(typed: string, suggestions: string[]): string | null {
  const q = norm(typed.trimStart())
  if (q.length < 2) return null
  return suggestions.find((s) => norm(s).startsWith(q) && s.length > typed.length) ?? null
}

/** "YYYY-MM-DD" of a Date in the viewer's own timezone. The grid's columns
 *  are local days: keying them by `toISOString()` (UTC) shifted every event
 *  and the "today" marker by one day for anyone ahead of UTC (e.g. France). */
export function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
