/** Renderer-side mirror of the shared team tables (E1). */

/** Matches the local TeamMember/ChampionPoolEntry convention (src/pages/Team), not Riot's teamPosition. */
export type TeamRole = 'TOP' | 'JUNGLE' | 'MID' | 'ADC' | 'SUPPORT'
export type RosterStatus = 'starter' | 'substitute' | 'trial'
export type PoolTier = 'main' | 'comfort' | 'flex' | 'learning'

export interface SharedPoolEntry {
  id: string
  rosterId: string
  championKey: string
  role: TeamRole
  tier: PoolTier
  notes: string | null
  playRate: number | null
  winRate: number | null
  masteryPoints: number | null
  /** See ChampionPoolEntry.kda (src/lib/ipc.ts) / threatCore.ts (E12). */
  kda: number | null
  updatedAt: string
}

export interface SharedRosterMember {
  id: string
  groupId: string
  userId: string | null
  displayName: string
  ign: string | null
  tagLine: string | null
  region: string | null
  role: TeamRole
  status: RosterStatus
  puuid: string | null
  /** Null for the group's own roster; set to a SharedScoutingEntry.id for a
   *  scouted opponent's roster member (E14). */
  scoutingId: string | null
  pool: SharedPoolEntry[]
  createdAt: string
  updatedAt: string
}

export interface SharedScoutingEntry {
  id: string
  groupId: string
  name: string
  tag: string | null
  scoutNotes: string | null
  /** The scouted opponent's own roster + pools (E14) — empty until either
   *  platform adds members to it. */
  roster: SharedRosterMember[]
  createdAt: string
  updatedAt: string
}

export interface SharedDraft {
  id: string
  groupId: string
  name: string
  vsScoutingId: string | null
  bluePicks: string[]
  blueBans: string[]
  redPicks: string[]
  redBans: string[]
  myTeamSide: 'blue' | 'red'
  notes: string | null
  createdAt: string
  updatedAt: string
}

interface PublishPoolEntry {
  championKey: string
  role: TeamRole
  tier: PoolTier
  notes: string | null
  playRate: number | null
  winRate: number | null
  masteryPoints: number | null
  kda: number | null
}

interface PublishRosterMember {
  displayName: string
  ign: string | null
  tagLine: string | null
  region: string | null
  role: TeamRole
  puuid: string | null
  pool: PublishPoolEntry[]
}

export interface PublishTeamInput {
  roster: PublishRosterMember[]
  drafts: Array<{
    name: string
    bluePicks: string[]
    blueBans: string[]
    redPicks: string[]
    redBans: string[]
    myTeamSide: 'blue' | 'red'
    notes: string | null
  }>
  /** Scouted opponent teams. `roster` is empty when the desktop app hasn't
   *  scouted any members for that opponent yet (or on a publish from before
   *  E14) — still published as a name-only stub, same as before. */
  scouting: Array<{ name: string; tag: string | null; scoutNotes: string | null; roster: PublishRosterMember[] }>
}

export interface TeamShareApi {
  /**
   * Snapshots a local team (roster + pools + drafts + scouting) into the
   * group's shared space. Overwrites the group's previous publish —
   * "dernier qui écrit gagne". Desktop only: the web app has no local team
   * data to read, so it doesn't implement this.
   */
  teamPublishToGroup?: (groupId: string, teamId: string) => Promise<{ published: number }>
  teamGetShared: (groupId: string) => Promise<{
    roster: SharedRosterMember[]
    drafts: SharedDraft[]
    scouting: SharedScoutingEntry[]
  }>
  /**
   * #46: the group's staff links a row of the published roster (SharedRosterMember.id, own roster only) to a member
   * of the group, or unlinks it (null). The row takes the member's account; another row linked to that member is
   * unlinked. For the players the publish could not match by itself.
   * Returns true when the row also took the member's current Riot ID and puuid (the server verified them), false
   * when the member's Riot ID is not verified yet: the row keeps its own Riot ID, show "Riot ID not verified".
   * Errors: FORBIDDEN, NOT_FOUND, NOT_A_MEMBER. Optional: absent before the roster_member_link migration's app.
   */
  teamLinkRosterMember?: (rosterId: string, userId: string | null) => Promise<boolean>
}
