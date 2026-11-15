import type { GroupRole } from './collab'

/**
 * Permission predicates for the Planning rework + team sessions (Phase 0).
 * Pure, no I/O — mirrors the SQL helpers in the `e_phase0_manager_role_captain`
 * migration 1:1, so client-side UI gating and server-side RLS never drift:
 *
 *   - `private.is_group_staff`   (unchanged: owner/coach/analyst) → isLegacyStaff
 *   - `private.can_edit_calendar` (owner/coach/manager)            → canEditCalendar
 *   - `private.can_manage_session` (owner/coach/manager, or captain) → canManageSession
 *
 * `is_group_staff`/`isLegacyStaff` keeps its existing meaning for everything
 * that predates this feature (dev plans, VOD review, trials, staff notes,
 * sharing/invites) — analyst stays "staff" there. Only calendar-ish features
 * (Planning, availability, announcements, event requests) and team-session
 * management switch to the two new, narrower checks.
 */

export function isLegacyStaff(role: GroupRole): boolean {
  return role === 'owner' || role === 'coach' || role === 'analyst'
}

export function canEditCalendar(role: GroupRole): boolean {
  return role === 'owner' || role === 'coach' || role === 'manager'
}

export function canManageSession(role: GroupRole, isCaptain: boolean): boolean {
  return canEditCalendar(role) || isCaptain
}
