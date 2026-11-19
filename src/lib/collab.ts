/** Renderer-side mirror of electron/main/cloud/collab.ts types. */
import type { PlayerDashboardRow } from './staffDashboard'
import type { DevPlanApi } from './devPlan'

export type GroupRole = 'owner' | 'coach' | 'manager' | 'analyst' | 'player'
/** #39: the staff roles a member may hold on top of their main role (group_members.staff_roles). */
export type StaffRole = 'coach' | 'manager' | 'analyst'
export type GroupKind = 'team' | 'coaching'
/** #38: the server's check of a member's declared Riot ID (verify-member-puuid). */
export type PuuidStatus = 'verified' | 'not_found' | 'conflict'

export interface GroupMember {
  userId: string
  role: GroupRole
  /** Session-management rights (set objectives, run the review flow) on top
   *  of whatever `role` already grants — owner-settable only, see
   *  `src/lib/permissions.ts`. */
  isCaptain: boolean
  displayName: string | null
  riotId: string | null
  /**
   * #38: the member's Riot puuid, the stable key (a Riot ID changes on a rename). null when the member never
   * published it; absent before the member_puuid migration.
   */
  puuid?: string | null
  /**
   * #38: where the server's check of the member's Riot ID stands. 'conflict' = another member of the group already
   * holds that puuid (two members claim the same player): show it to the staff. null = not verified yet.
   */
  puuidStatus?: PuuidStatus | null
  /**
   * #39: staff roles held on top of `role` (a player who also coaches: role 'player', staffRoles ['coach']).
   * Set by the owner only. Never contains `role` itself, always empty for the owner. Absent before the
   * member_staff_roles migration. Rights go through src/lib/permissions.ts, which reads both.
   */
  staffRoles?: StaffRole[]
  /**
   * An owner who also plays (group_members.also_plays, set by each owner for themself): in the team's roster like a
   * player, and like a player-staff never reads teammates' shared wellbeing. Only ever true for an owner. Absent
   * before the member_staff_roles migration. "Does this member play?" goes through `playsInGroup` (permissions.ts).
   */
  alsoPlays?: boolean
  joinedAt: string
}

/** The profile icon and banner a group member picked on their Profile page
 *  (ids from src/lib/profile.ts), shown on the roster's player cards. */
export interface MemberLook {
  userId: string
  riotId: string | null
  iconId: string | null
  bannerId: string | null
}

export interface GroupSharing {
  shareReviews: boolean
  shareStats: boolean
  /** Defaults to false since S19-17: team data is shared with the staff only when turned on. */
  shareTeam: boolean
  /** Like shareTeam, this defaults to false — wellbeing is opt-in. */
  shareWellbeing: boolean
}

export interface Group {
  id: string
  name: string
  kind: GroupKind
  myRole: GroupRole
  /** #39: my staff roles on top of `myRole` (see GroupMember.staffRoles). Absent before the migration. */
  myStaffRoles?: StaffRole[]
  /** Whether I, as an owner, also play (see GroupMember.alsoPlays). Absent before the migration. */
  myAlsoPlays?: boolean
  members: GroupMember[]
  sharing: GroupSharing
  /** The team's logo (public URL in the group-logos bucket), set by the
   *  group's management from Coaching → Groupes. Null without one. */
  logoUrl?: string | null
}

/** A logo image ready to upload: the app sends a 256 px WebP. */
export interface GroupLogoImage {
  bytes: Uint8Array
  contentType: 'image/webp' | 'image/png' | 'image/jpeg'
}

export interface ReviewComment {
  id: string
  groupId: string
  playerId: string
  reviewId: string
  gameId: string | null
  authorId: string | null // null once the author deleted their account (S19-16 / #33)
  parentId: string | null
  videoTimeSec: number | null
  body: string
  resolved: boolean
  createdAt: string
}

export interface AssignedObjective {
  id: string
  groupId: string
  playerId: string
  assignedBy: string | null // null once the author deleted their account (S19-16 / #33)
  objectiveIds: string[]
  kpiIds: string[]
  note: string | null
  dueDate: string | null
  status: 'open' | 'done' | 'dismissed'
  createdAt: string
}

export interface PlayerReviewView {
  id: string
  freeText: string | null
  kpiScores: Record<string, number>
  timelineNotes: Array<{ time: string; note: string }>
  objectiveRespected: boolean | null
}

export interface PlayerGameView {
  id: string
  matchId: string
  champion: string
  role: string | null
  win: boolean
  kills: number
  deaths: number
  assists: number
  gameEndAt: number | string | null
  review: PlayerReviewView | null
}

export interface PlayerSessionView {
  id: string
  date: number | string | null
  objectiveIds: string[]
  status: string | null
  sessionConclusion: string | null
  games: PlayerGameView[]
}

export interface CollabApi extends DevPlanApi {
  collabListGroups: () => Promise<Group[]>
  collabCreateGroup: (name: string, kind: GroupKind) => Promise<string>
  collabCreateInvite: (groupId: string, role: Exclude<GroupRole, 'owner'>, days: number) => Promise<string>
  /** `riotId` ("Name#TAG") only where the app has no Riot account of its
   *  own (the web); joining needs one either way. */
  collabJoin: (code: string, riotId?: string | null) => Promise<string>
  collabLeave: (groupId: string) => Promise<void>
  collabDeleteGroup: (groupId: string, confirm: 'DELETE') => Promise<void>
  collabRemoveMember: (groupId: string, userId: string) => Promise<void>
  /** Owner-only; see src/lib/permissions.ts for what the flag grants. */
  collabSetCaptain: (groupId: string, userId: string, isCaptain: boolean) => Promise<void>
  /** Owner-only; the owner's own role never changes from here. */
  collabSetMemberRole: (groupId: string, userId: string, role: Exclude<GroupRole, 'owner'>) => Promise<void>
  /**
   * #39, owner only: sets a member's whole list of extra staff roles ([] clears it) and returns it as stored
   * (sorted, without the member's main role). Notifies the member, and the group when a role is added.
   * Errors: FORBIDDEN (not the owner), INVALID_ROLE, OWNER_HAS_ALL_ROLES, NOT_FOUND.
   */
  collabSetMemberStaffRoles?: (groupId: string, userId: string, roles: StaffRole[]) => Promise<StaffRole[]>
  /**
   * An owner says whether they also play, for themself only, and gets the stored value back. Nobody is notified.
   * Errors: FORBIDDEN (not an owner of the group). Optional: absent on an app or web build without it.
   */
  collabSetMyAlsoPlays?: (groupId: string, plays: boolean) => Promise<boolean>
  collabSetSharing: (groupId: string, s: GroupSharing) => Promise<void>
  collabPlayerSessions: (playerId: string) => Promise<PlayerSessionView[]>
  /** Shares my profile icon and banner with my groups; false when signed out or refused. */
  collabSetMyLook: (look: { iconId: string; bannerId: string }) => Promise<boolean>
  /** Looks of everyone in my groups (player cards); empty when signed out. */
  collabListMemberLooks: () => Promise<MemberLook[]>
  /** Management only (owner, coach, manager, captain). Null clears the logo;
   *  returns the new logo's URL. */
  collabSetGroupLogo: (groupId: string, image: GroupLogoImage | null) => Promise<string | null>
  /** #34: unlinks the group's Discord server. Owner, coach or manager of the group only (rejects with FORBIDDEN otherwise). */
  discordUnlinkGuild: (groupId: string) => Promise<{ unlinked: boolean }>
  collabListComments: (reviewId: string, playerId?: string) => Promise<ReviewComment[]>
  collabMyOpenComments: () => Promise<ReviewComment[]>
  collabAddComment: (c: {
    groupId: string; playerId?: string; reviewId: string; gameId?: string | null
    parentId?: string | null; videoTimeSec?: number | null; body: string
  }) => Promise<ReviewComment>
  collabResolveComment: (id: string, resolved: boolean) => Promise<void>
  collabDeleteComment: (id: string) => Promise<void>
  collabListAssignments: (playerId?: string, onlyOpen?: boolean) => Promise<AssignedObjective[]>
  collabAssignObjective: (a: {
    groupId: string; playerId: string; objectiveIds: string[]; kpiIds?: string[]; note?: string | null; dueDate?: string | null
  }) => Promise<AssignedObjective>
  collabSetAssignmentStatus: (id: string, status: AssignedObjective['status']) => Promise<void>
  collabStaffDashboard: (groupId: string) => Promise<PlayerDashboardRow[]>
}

/** Stable error codes thrown by the main process → i18n keys. */
export function collabErrorKey(err: unknown): string {
  const msg = (err as Error)?.message ?? ''
  // #39 adds INVALID_ROLE, OWNER_HAS_ALL_ROLES, NOT_FOUND (set_member_staff_roles).
  for (const code of ['INVITE_INVALID', 'NOT_CONCERNED', 'EVENT_OVER', 'FORBIDDEN', 'TOO_MANY_GROUPS', 'LOGIN_REQUIRED', 'RIOT_ACCOUNT_REQUIRED', 'INVALID_ROLE', 'OWNER_HAS_ALL_ROLES', 'NOT_FOUND']) {
    if (msg.includes(code)) return `coaching.errors.${code}`
  }
  if (msg.includes('invalid code')) return 'coaching.errors.INVITE_INVALID'
  return 'coaching.errors.generic'
}
