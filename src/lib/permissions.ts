import type { GroupRole } from './collab'

/**
 * Permission predicates for the Planning rework + team sessions. Pure, no
 * I/O — mirrors the SQL helpers 1:1 (e_phase0_manager_role_captain, then
 * 20261118200000_captain_roles_presence), so client-side UI gating and
 * server-side RLS never drift:
 *
 *   - `private.is_group_staff`    (owner/coach/analyst)               → isLegacyStaff
 *   - `private.can_edit_calendar` (owner/coach/manager, or captain)   → canEditCalendar
 *   - `private.can_manage_session` (owner/coach/manager, or captain)  → canManageSession
 *
 * `is_group_staff`/`isLegacyStaff` keeps its existing meaning for everything
 * that predates the Planning rework (dev plans, VOD review, trials, staff
 * notes, sharing/invites) — analyst stays "staff" there. The calendar side
 * (Planning, availability, announcements, event requests) and team-session
 * management are "management": the manager's job, which the captain shares
 * since 18 November 2026.
 */

export function isLegacyStaff(role: GroupRole): boolean {
  return role === 'owner' || role === 'coach' || role === 'analyst'
}

/** Management: owner, coach, manager — and the captain, whatever their role. */
export function canEditCalendar(role: GroupRole, isCaptain = false): boolean {
  return role === 'owner' || role === 'coach' || role === 'manager' || isCaptain
}

export function canManageSession(role: GroupRole, isCaptain: boolean): boolean {
  return canEditCalendar(role, isCaptain)
}

/** Only the owner changes roles (set_member_role), never their own. */
export function canChangeRoles(role: GroupRole): boolean {
  return role === 'owner'
}

/** Roles the owner can give from the group panel. */
export const ASSIGNABLE_ROLES: Array<Exclude<GroupRole, 'owner'>> = ['player', 'analyst', 'coach', 'manager']
