/**
 * The manager's Organisation dashboard and the player's Scouting (DESIGN_STATE.md § 18, validated 20/11/2026), contract
 * docs/contracts/organisation.md. Computed in organisationCore.ts, shared by the desktop and the web.
 */

export interface RemindResult {
  /** The members reminded now (notification, plus a Discord DM when they linked Discord). */
  reminded: string[]
  /** Reminded less than 6 hours ago: when they can be reminded again. */
  skipped: Array<{ userId: string; nextAt: string }>
}

export interface EventReminder {
  eventId: string
  userId: string
  sentBy: string | null
  sentAt: string
}

/** A published opponent dossier, light (the list of the player's Scouting, § 18.4). */
export interface PublishedDossier {
  opponentKey: string
  name: string
  /** The scouted team's tag, when scouted. */
  tag: string | null
  publishedAt: string
  /** Who published it (the last editor of the dossier), and their name in the group. */
  publishedBy: string | null
  publishedByName: string | null
  /** Our team games against them (team sessions with that opponent): wins and losses. */
  record: { wins: number; losses: number }
}

/**
 * The solo LFT data of a player without a group (desktop only, § 18.2): the poster's member (structurally a TeamMember,
 * pool from their own games) and their rank, for playerView in src/components/lft/useLftData.ts.
 */
export interface SoloLft {
  member: import('./lftCore').SoloLftMember
  rank: import('./rankCore').MemberRankResult
}

export interface OrganisationApi {
  /**
   * "Relancer": reminds the members who have not answered an event (all of them, or `userIds`). The group's calendar
   * managers only. Errors: FORBIDDEN, NOT_FOUND, EVENT_PAST, NOT_AVAILABLE (before migration 20261120190000).
   */
  calendarRemindResponses: (eventId: string, userIds?: string[]) => Promise<RemindResult>
  /** The last reminder per person of these events ("relancé il y a 2 h"); the calendar managers only, empty for others. */
  calendarListReminders: (eventIds: string[]) => Promise<EventReminder[]>
  /** The published opponent dossiers of a group, newest first. */
  opponentDossierListPublished: (groupId: string) => Promise<PublishedDossier[]>
  /** Desktop only. Null when no account is set up. */
  lftMySolo?: (opts?: { force?: boolean }) => Promise<SoloLft | null>
}
