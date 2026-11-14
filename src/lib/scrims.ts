/** Renderer-side mirror of the (web-managed) `scrims` table — read-only here. */

export interface ScrimSummary {
  id: string
  title: string
  opponent: string | null
  scheduledAt: string
  durationMin: number
}

/**
 * Server-only, read-only: lets desktop (which has no scrim-management UI of
 * its own, see web/src/scrims.ts for that) show "link to a scrim" pickers
 * like the VOD review session form (E5).
 */
export interface ScrimsReadApi {
  scrimsListForGroup: (groupId: string) => Promise<ScrimSummary[]>
}
