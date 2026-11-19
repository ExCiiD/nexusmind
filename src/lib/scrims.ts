/** Renderer-side mirror of the (web-managed) `scrims` table — read-only here. */

export interface ScrimSummary {
  id: string
  title: string
  opponent: string | null
  scheduledAt: string
  durationMin: number
  /** 'bo1' | 'bo3' | 'bo5', or null if not set. */
  boFormat: string | null
  /** The scouted opponent team (team_scouting.id) this scrim is against,
   *  if linked — lets the Discord bot (E11) derive real OP.GG links from
   *  that team's roster instead of the free-text `opponent` name. */
  opponentScoutingId: string | null
  /** #49: the Planning slot this scrim is the detail of. Null before the scrims_in_planning migration. */
  calendarEventId: string | null
  /** #49: 'official' for a match planned as "Officiel". 'scrim' before the migration. */
  kind: 'scrim' | 'official'
  /** #49: the opponent's key in the group's scouting (analyst.ts opponentKeyOf). Null before the migration. */
  opponentKey: string | null
}

/**
 * Server-only, read-only: lets desktop (which has no scrim-management UI of
 * its own, see web/src/scrims.ts for that) show "link to a scrim" pickers
 * like the VOD review session form (E5).
 */
export interface ScrimsReadApi {
  scrimsListForGroup: (groupId: string) => Promise<ScrimSummary[]>
}
