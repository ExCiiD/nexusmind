/**
 * #49: does a Riot ID exist? The Scrim pop-up shows "✓ trouvé" or "Introuvable" next to each opponent's Riot ID
 * (docs/DESIGN_STATE.md section 13.1). Pure: the desktop passes its Riot client (account-v1 by Riot ID), the web its
 * own (riotWeb).
 *
 *   { exists: true, puuid }   the account exists
 *   { exists: false }         Riot answered 404 (no such account) or 400 (not a valid Riot ID), or the value has no tag
 *   throws                    anything else (rate limit, network, session): the screen shows "—", not "Introuvable"
 */
import { splitRiotIdInput } from './matchEvent'

export interface RiotAccountCheck {
  exists: boolean
  puuid?: string
}

export type RiotAccountLookup = (gameName: string, tagLine: string, region: string) => Promise<{ puuid: string }>

/** The Riot client's 404 / 400 errors carry the status in their message ("Account not found (404)."). */
const isNotFound = (err: unknown): boolean => {
  const e = err as { status?: number; message?: string } | null
  return e?.status === 404 || e?.status === 400 || /\((404|400)\)/.test(e?.message ?? '')
}

export async function checkRiotAccount(lookup: RiotAccountLookup, riotId: string, region: string): Promise<RiotAccountCheck> {
  const parts = splitRiotIdInput(riotId)
  if (!parts || !parts[1]) return { exists: false }
  try {
    const account = await lookup(parts[0], parts[1], region)
    return account?.puuid ? { exists: true, puuid: account.puuid } : { exists: false }
  } catch (err) {
    if (isNotFound(err)) return { exists: false }
    throw err
  }
}
