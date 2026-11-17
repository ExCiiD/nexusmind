/**
 * Planning grid & quick-slot popup (redesign of 17/11/2026). Pure — no I/O.
 *   - who among the starters is available at a given time / day;
 *   - the title the popup pre-fills from the people concerned;
 *   - inline autocomplete for the title field (Tab / Enter to accept).
 */
import type { AvailabilityException, AvailabilityRule, AttendeeScope, CalendarEventKind } from './calendar'
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
