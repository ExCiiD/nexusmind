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

export interface PublishTeamInput {
  roster: Array<{
    displayName: string
    ign: string | null
    tagLine: string | null
    region: string | null
    role: TeamRole
    puuid: string | null
    pool: Array<{
      championKey: string
      role: TeamRole
      tier: PoolTier
      notes: string | null
      playRate: number | null
      winRate: number | null
      masteryPoints: number | null
    }>
  }>
  drafts: Array<{
    name: string
    bluePicks: string[]
    blueBans: string[]
    redPicks: string[]
    redBans: string[]
    myTeamSide: 'blue' | 'red'
    notes: string | null
  }>
  scouting: Array<{ name: string; tag: string | null; scoutNotes: string | null }>
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
}
