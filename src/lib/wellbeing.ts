/** Renderer-side mirror of the shared wellbeing table (E6). */

export interface WellbeingCheckin {
  id: string
  userId: string
  /** 1-5. */
  energy: number
  /** 1-5. */
  mood: number
  /** 1-5. */
  sleep: number
  note: string | null
  createdAt: string
}

export interface NewWellbeingCheckinInput {
  energy: number
  mood: number
  sleep: number
  note?: string | null
}

/** A win-rate split by whether the player's energy that day was low (<=2) or not. */
export interface EnergyWinrateCorrelation {
  lowEnergyGames: number
  lowEnergyWinrate: number | null
  otherGames: number
  otherWinrate: number | null
}

/**
 * All of this is server-only (no local Prisma data), so desktop and web
 * implement every method the same way — same pattern as devPlan.ts.
 */
export interface WellbeingApi {
  wellbeingAddCheckin: (input: NewWellbeingCheckinInput) => Promise<void>
  wellbeingListMine: (limit?: number) => Promise<WellbeingCheckin[]>
  /** RLS-filtered: only players who opted in (`share_wellbeing`) for this group are returned. */
  wellbeingListForGroup: (playerIds: string[]) => Promise<WellbeingCheckin[]>
  /** The per-group threshold (hours/week) for the combined load+mood alert (E6 v2). */
  wellbeingGetLoadThreshold: (groupId: string) => Promise<number>
  wellbeingSetLoadThreshold: (groupId: string, hours: number) => Promise<void>
  /** The user's current consent to wellbeing check-ins (legal texts v0.3). */
  wellbeingConsentGet: () => Promise<WellbeingConsent>
  /**
   * Grants or withdraws that consent (server-timestamped, kept as proof). Withdrawing deletes all the user's
   * check-ins and turns `share_wellbeing` off in every group, in one transaction.
   */
  wellbeingConsentSet: (granted: boolean, version: WellbeingConsentVersion) => Promise<WellbeingConsent>
}

/** Text version a consent refers to (the legal texts' version). */
export type WellbeingConsentVersion = 'v0.3'

export interface WellbeingConsent {
  status: 'granted' | 'withdrawn' | 'none'
  version: string | null
  /** Last grant, if any (kept after a withdrawal). */
  grantedAt: string | null
  /** Set when the latest event is a withdrawal. */
  withdrawnAt: string | null
}
