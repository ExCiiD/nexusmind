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

/**
 * Attack type in the laning phase, for the range-vs-melee duel detector.
 * Riot `championName` keys, lower-cased; a champion in neither list (a new
 * release) is unknown and the detector stays silent. Forms count as they are
 * played early: Gnar, Elise, Nidalee and Jayce as ranged, Kayle as melee
 * (ranged only from level 6).
 */
export const MELEE_CHAMPIONS: ReadonlySet<string> = new Set([
  'aatrox', 'akali', 'alistar', 'ambessa', 'amumu', 'belveth', 'blitzcrank', 'braum', 'briar', 'camille', 'chogath',
  'darius', 'diana', 'drmundo', 'ekko', 'evelynn', 'fiora', 'fizz', 'galio', 'gangplank', 'garen', 'gragas', 'gwen',
  'hecarim', 'illaoi', 'irelia', 'ivern', 'jarvaniv', 'jax', 'kassadin', 'katarina', 'kayle', 'kayn', 'khazix', 'kled',
  'ksante', 'leesin', 'leona', 'lillia', 'malphite', 'maokai', 'masteryi', 'monkeyking', 'mordekaiser', 'naafiri', 'nasus',
  'nautilus', 'nilah', 'nocturne', 'nunu', 'olaf', 'ornn', 'pantheon', 'poppy', 'pyke', 'qiyana', 'rammus', 'reksai', 'rell',
  'renekton', 'rengar', 'riven', 'rumble', 'sejuani', 'sett', 'shaco', 'shen', 'shyvana', 'singed', 'sion', 'skarner',
  'sylas', 'tahmkench', 'talon', 'taric', 'trundle', 'tryndamere', 'udyr', 'vi', 'viego', 'volibear', 'warwick', 'xinzhao',
  'yasuo', 'yone', 'yorick', 'zaahen', 'zac', 'zed',
])
export const RANGED_CHAMPIONS: ReadonlySet<string> = new Set([
  'ahri', 'akshan', 'anivia', 'annie', 'aphelios', 'ashe', 'aurelionsol', 'aurora', 'azir', 'bard', 'brand', 'caitlyn',
  'cassiopeia', 'corki', 'draven', 'elise', 'ezreal', 'fiddlesticks', 'gnar', 'graves', 'heimerdinger', 'hwei', 'janna',
  'jayce', 'jhin', 'jinx', 'kaisa', 'kalista', 'karma', 'karthus', 'kennen', 'kindred', 'kogmaw', 'leblanc', 'lissandra',
  'lucian', 'lulu', 'lux', 'malzahar', 'mel', 'milio', 'missfortune', 'morgana', 'nami', 'neeko', 'nidalee', 'orianna',
  'quinn', 'rakan', 'renata', 'ryze', 'samira', 'senna', 'seraphine', 'sivir', 'smolder', 'sona', 'soraka', 'swain',
  'syndra', 'taliyah', 'teemo', 'thresh', 'tristana', 'twistedfate', 'twitch', 'urgot', 'varus', 'vayne', 'veigar',
  'velkoz', 'vex', 'viktor', 'vladimir', 'xayah', 'xerath', 'yunara', 'yuumi', 'zeri', 'ziggs', 'zilean', 'zoe', 'zyra',
])

export function attackTypeOf(championName: string | null | undefined): 'melee' | 'ranged' | null {
  const c = String(championName ?? '').toLowerCase()
  return MELEE_CHAMPIONS.has(c) ? 'melee' : RANGED_CHAMPIONS.has(c) ? 'ranged' : null
}
