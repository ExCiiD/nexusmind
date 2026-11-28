/**
 * Perf gain 3 (docs/audits/AUDIT_PERF.md): the cache keys of a group's screens (Management, Coaching, Lobby, Team
 * sessions). Every key carries the group id, so a screen never shows another group's data; the invalidations below
 * also reach the keys of the Organisation tab (`org:`). Shared with the web bundle: no desktop-only call here.
 */
import { invalidateCached } from './queryCache'

export const groupKey = (groupId: string, part: string) => `group:${groupId}:${part}`
/** A cloud account's own data (check-ins, sessions…): another account never reads it. */
export const userKey = (userId: string, part: string) => `user:${userId}:${part}`
/** This device's own teams (the Lobby's roster): local data, emptied on a profile change. */
export const OWN_TEAMS_KEY = 'teams:own'

/** After a change to the calendar or the availabilities (or a Realtime `calendar` event). */
export function invalidateGroupCalendar(groupId: string) {
  invalidateCached(groupKey(groupId, 'calendar'))
  invalidateCached(groupKey(groupId, 'availability'))
  invalidateCached(`org:week:${groupId}:`)
}

/** After a change to the tasks. */
export function invalidateGroupTasks(groupId: string) {
  invalidateCached(groupKey(groupId, 'tasks'))
  invalidateCached(`org:tasks:${groupId}`)
}

/** After deleting team sessions (teamSessionHistoryDelete): the history list and its summary refetch. */
export function invalidateGroupSessions(groupId: string) {
  invalidateCached(groupKey(groupId, 'sessions'))
}
