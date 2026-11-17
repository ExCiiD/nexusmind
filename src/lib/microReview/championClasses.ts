/**
 * Mid-lane mages whose job at an epic objective is to zone the entrance, not
 * to stand in the pit (V4 choke-point detector: "support ou mage de
 * contrôle"). Riot `championName` keys, lower-cased. Supports are covered by
 * their role; this list only matters for a MIDDLE player.
 *
 * Hardcoded for the same reason as src/lib/championRoles.ts: the timeline
 * carries no champion class, and the list only changes when a mage is
 * released or reworked.
 */
export const CONTROL_MAGES: ReadonlySet<string> = new Set([
  'ahri', 'anivia', 'annie', 'aurelionsol', 'aurora', 'azir', 'brand', 'cassiopeia', 'heimerdinger', 'hwei',
  'karma', 'karthus', 'lissandra', 'lulu', 'lux', 'malzahar', 'mel', 'morgana', 'neeko', 'orianna', 'ryze',
  'seraphine', 'swain', 'syndra', 'taliyah', 'twistedfate', 'veigar', 'velkoz', 'vex', 'viktor', 'xerath',
  'ziggs', 'zilean', 'zoe', 'zyra',
])

export const isControlMage = (championName: string | null | undefined): boolean =>
  CONTROL_MAGES.has(String(championName ?? '').toLowerCase())
