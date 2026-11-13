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
}
