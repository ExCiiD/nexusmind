import type { GroupRole, StaffRole } from './collab'

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

/**
 * #39: a member's effective roles, their main role plus the staff roles held on top of it
 * (member_staff_roles, `private.has_group_role`). Every predicate below takes `staffRoles` as an optional
 * last argument: without it, they answer as before.
 */
export function effectiveRoles(role: GroupRole, staffRoles: readonly StaffRole[] = []): GroupRole[] {
  return [role, ...staffRoles.filter((r) => r !== role)]
}

const holdsAny = (role: GroupRole, staffRoles: readonly StaffRole[], wanted: readonly GroupRole[]) =>
  effectiveRoles(role, staffRoles).some((r) => wanted.includes(r))

export function isLegacyStaff(role: GroupRole, staffRoles: readonly StaffRole[] = []): boolean {
  return holdsAny(role, staffRoles, ['owner', 'coach', 'analyst'])
}

/** Management: owner, coach, manager — and the captain, whatever their role. */
export function canEditCalendar(role: GroupRole, isCaptain = false, staffRoles: readonly StaffRole[] = []): boolean {
  return holdsAny(role, staffRoles, ['owner', 'coach', 'manager']) || isCaptain
}

export function canManageSession(role: GroupRole, isCaptain: boolean, staffRoles: readonly StaffRole[] = []): boolean {
  return canEditCalendar(role, isCaptain, staffRoles)
}

/**
 * Shared wellbeing (`private.can_read_wellbeing`): a staff role AND a main role other than player, and not an
 * owner who also plays. A member who plays does not read teammates' wellbeing (user decision, 19/11/2026).
 */
export function canReadWellbeing(role: GroupRole, staffRoles: readonly StaffRole[] = [], alsoPlays = false): boolean {
  return role !== 'player' && !alsoPlays && isLegacyStaff(role, staffRoles)
}

/**
 * Whether a member plays in the group: the 'player' role, or an owner who also plays (`also_plays`). The team's
 * roster and "all players" are built from this, as the server's inactivity check is.
 */
export function playsInGroup(m: { role: GroupRole | string; alsoPlays?: boolean }): boolean {
  return m.role === 'player' || (m.role === 'owner' && m.alsoPlays === true)
}

/** #39: the staff roles the owner can add on top of a member's main role. */
export const ASSIGNABLE_STAFF_ROLES: StaffRole[] = ['coach', 'manager', 'analyst']

/** Only the owner changes roles (set_member_role), never their own. */
export function canChangeRoles(role: GroupRole): boolean {
  return role === 'owner'
}

/** Roles the owner can give from the group panel. */
export const ASSIGNABLE_ROLES: Array<Exclude<GroupRole, 'owner'>> = ['player', 'analyst', 'coach', 'manager']
