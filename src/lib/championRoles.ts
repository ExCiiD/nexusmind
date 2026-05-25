/**
 * Maps each champion to the role(s) they're commonly played in.
 *
 * Why hardcoded?
 *   Data Dragon's `champion.tags` exposes class info (Fighter/Tank/Mage/…)
 *   not positional roles. Pro-style draft tools (drafter.lol, lolalytics)
 *   all maintain a curated catalog like this one. The list rarely needs
 *   updating — only when a champion is reworked into a new role.
 *
 * Coverage:
 *   - ~170 champions as of Season 15
 *   - Each champion can map to multiple roles (e.g. Lulu = MID + SUPPORT,
 *     Pantheon = TOP + JUNGLE + SUPPORT)
 *   - Unknown champions fall through to a tag-based heuristic in
 *     `getChampionRoles` so new releases are never invisible — just rough.
 */

export type Role = 'TOP' | 'JUNGLE' | 'MID' | 'ADC' | 'SUPPORT'

/**
 * Canonical role order — used for sorting member lists, draft slots, and
 * anywhere we want roles in their natural lane sequence rather than
 * alphabetical or DB insertion order.
 */
export const ROLE_ORDER: Role[] = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT']

/**
 * Sort comparator for a `role` field on any object. Unknown / unset roles
 * sink to the end so the main 5-stack stays at the top.
 */
export function compareByRole<T extends { role?: string | null }>(a: T, b: T): number {
  const ai = ROLE_ORDER.indexOf((a.role ?? '') as Role)
  const bi = ROLE_ORDER.indexOf((b.role ?? '') as Role)
  // -1 (not found) means "unknown role" — push to the bottom rather than top.
  const norm = (i: number) => (i === -1 ? Number.MAX_SAFE_INTEGER : i)
  return norm(ai) - norm(bi)
}

// championKey (Data Dragon `id`) → array of roles where the champion is
// commonly picked. Order matters: primary role first.
const CHAMPION_ROLES: Record<string, Role[]> = {
  Aatrox: ['TOP'],
  Ahri: ['MID'],
  Akali: ['MID', 'TOP'],
  Akshan: ['MID', 'TOP'],
  Alistar: ['SUPPORT'],
  Ambessa: ['TOP', 'MID'],
  Amumu: ['JUNGLE', 'SUPPORT'],
  Anivia: ['MID'],
  Annie: ['MID', 'SUPPORT'],
  Aphelios: ['ADC'],
  Ashe: ['ADC', 'SUPPORT'],
  AurelionSol: ['MID'],
  Aurora: ['MID', 'TOP'],
  Azir: ['MID'],
  Bard: ['SUPPORT'],
  Belveth: ['JUNGLE'],
  Blitzcrank: ['SUPPORT'],
  Brand: ['SUPPORT', 'MID'],
  Braum: ['SUPPORT'],
  Briar: ['JUNGLE'],
  Caitlyn: ['ADC'],
  Camille: ['TOP'],
  Cassiopeia: ['MID', 'TOP'],
  Chogath: ['TOP', 'MID'],
  Corki: ['MID', 'ADC'],
  Darius: ['TOP'],
  Diana: ['JUNGLE', 'MID'],
  DrMundo: ['TOP'],
  Draven: ['ADC'],
  Ekko: ['MID', 'JUNGLE'],
  Elise: ['JUNGLE'],
  Evelynn: ['JUNGLE'],
  Ezreal: ['ADC'],
  Fiddlesticks: ['JUNGLE', 'SUPPORT'],
  Fiora: ['TOP'],
  Fizz: ['MID'],
  Galio: ['MID', 'SUPPORT'],
  Gangplank: ['TOP'],
  Garen: ['TOP'],
  Gnar: ['TOP'],
  Gragas: ['JUNGLE', 'TOP'],
  Graves: ['JUNGLE'],
  Gwen: ['TOP', 'JUNGLE'],
  Hecarim: ['JUNGLE'],
  Heimerdinger: ['MID', 'TOP', 'SUPPORT'],
  Hwei: ['MID', 'SUPPORT'],
  Illaoi: ['TOP'],
  Irelia: ['TOP', 'MID'],
  Ivern: ['JUNGLE'],
  Janna: ['SUPPORT'],
  JarvanIV: ['JUNGLE'],
  Jax: ['TOP', 'JUNGLE'],
  Jayce: ['TOP', 'MID'],
  Jhin: ['ADC'],
  Jinx: ['ADC'],
  KSante: ['TOP'],
  Kaisa: ['ADC'],
  Kalista: ['ADC'],
  Karma: ['SUPPORT', 'MID'],
  Karthus: ['JUNGLE', 'MID'],
  Kassadin: ['MID'],
  Katarina: ['MID'],
  Kayle: ['TOP', 'MID'],
  Kayn: ['JUNGLE'],
  Kennen: ['TOP'],
  Khazix: ['JUNGLE'],
  Kindred: ['JUNGLE'],
  Kled: ['TOP'],
  KogMaw: ['ADC'],
  Leblanc: ['MID'],
  LeeSin: ['JUNGLE'],
  Leona: ['SUPPORT'],
  Lillia: ['JUNGLE', 'TOP'],
  Lissandra: ['MID'],
  Lucian: ['ADC', 'MID'],
  Lulu: ['SUPPORT', 'MID'],
  Lux: ['SUPPORT', 'MID'],
  Malphite: ['TOP', 'SUPPORT'],
  Malzahar: ['MID'],
  Maokai: ['SUPPORT', 'TOP', 'JUNGLE'],
  MasterYi: ['JUNGLE'],
  Mel: ['MID'],
  Milio: ['SUPPORT'],
  MissFortune: ['ADC'],
  MonkeyKing: ['TOP', 'JUNGLE'], // Wukong
  Mordekaiser: ['TOP'],
  Morgana: ['SUPPORT', 'MID'],
  Naafiri: ['MID', 'JUNGLE'],
  Nami: ['SUPPORT'],
  Nasus: ['TOP'],
  Nautilus: ['SUPPORT'],
  Neeko: ['MID', 'SUPPORT'],
  Nidalee: ['JUNGLE'],
  Nilah: ['ADC'],
  Nocturne: ['JUNGLE'],
  Nunu: ['JUNGLE'],
  Olaf: ['JUNGLE', 'TOP'],
  Orianna: ['MID'],
  Ornn: ['TOP'],
  Pantheon: ['SUPPORT', 'TOP', 'JUNGLE'],
  Poppy: ['JUNGLE', 'TOP', 'SUPPORT'],
  Pyke: ['SUPPORT'],
  Qiyana: ['MID'],
  Quinn: ['TOP'],
  Rakan: ['SUPPORT'],
  Rammus: ['JUNGLE'],
  RekSai: ['JUNGLE'],
  Rell: ['SUPPORT'],
  Renata: ['SUPPORT'],
  Renekton: ['TOP'],
  Rengar: ['JUNGLE', 'TOP'],
  Riven: ['TOP'],
  Rumble: ['TOP', 'MID'],
  Ryze: ['MID', 'TOP'],
  Samira: ['ADC'],
  Sejuani: ['JUNGLE'],
  Senna: ['SUPPORT', 'ADC'],
  Seraphine: ['SUPPORT', 'MID'],
  Sett: ['TOP', 'SUPPORT'],
  Shaco: ['JUNGLE', 'SUPPORT'],
  Shen: ['TOP', 'SUPPORT'],
  Shyvana: ['JUNGLE'],
  Singed: ['TOP'],
  Sion: ['TOP'],
  Sivir: ['ADC'],
  Skarner: ['JUNGLE'],
  Smolder: ['ADC', 'MID'],
  Sona: ['SUPPORT'],
  Soraka: ['SUPPORT'],
  Swain: ['SUPPORT', 'MID', 'TOP'],
  Sylas: ['MID', 'TOP'],
  Syndra: ['MID'],
  TahmKench: ['SUPPORT', 'TOP'],
  Taliyah: ['JUNGLE', 'MID'],
  Talon: ['MID', 'JUNGLE'],
  Taric: ['SUPPORT'],
  Teemo: ['TOP', 'SUPPORT'],
  Thresh: ['SUPPORT'],
  Tristana: ['ADC', 'MID'],
  Trundle: ['JUNGLE', 'TOP'],
  Tryndamere: ['TOP'],
  TwistedFate: ['MID'],
  Twitch: ['ADC'],
  Udyr: ['JUNGLE', 'TOP'],
  Urgot: ['TOP'],
  Varus: ['ADC'],
  Vayne: ['ADC', 'TOP'],
  Veigar: ['MID', 'SUPPORT'],
  Velkoz: ['SUPPORT', 'MID'],
  Vex: ['MID'],
  Vi: ['JUNGLE'],
  Viego: ['JUNGLE'],
  Viktor: ['MID'],
  Vladimir: ['MID', 'TOP'],
  Volibear: ['JUNGLE', 'TOP'],
  Warwick: ['JUNGLE', 'TOP'],
  Xayah: ['ADC'],
  Xerath: ['SUPPORT', 'MID'],
  XinZhao: ['JUNGLE'],
  Yasuo: ['MID', 'TOP', 'ADC'],
  Yone: ['MID', 'TOP'],
  Yorick: ['TOP'],
  Yuumi: ['SUPPORT'],
  Zac: ['JUNGLE', 'SUPPORT'],
  Zed: ['MID'],
  Zeri: ['ADC'],
  Ziggs: ['ADC', 'MID'],
  Zilean: ['SUPPORT', 'MID'],
  Zoe: ['MID'],
  Zyra: ['SUPPORT'],
}

/**
 * Tag-based fallback for champions not yet in the curated map.
 * Reflects the most common role for each class.
 */
function rolesFromTags(tags: string[]): Role[] {
  if (tags.includes('Marksman')) return ['ADC']
  if (tags.includes('Support')) return ['SUPPORT']
  if (tags.includes('Mage')) return ['MID', 'SUPPORT']
  if (tags.includes('Assassin')) return ['MID', 'JUNGLE']
  if (tags.includes('Tank')) return ['TOP', 'SUPPORT']
  if (tags.includes('Fighter')) return ['TOP', 'JUNGLE']
  return []
}

/**
 * Returns the list of roles a champion is commonly played in.
 * Uses curated data when available, falls back to tag heuristic otherwise.
 *
 * @param championKey  Data Dragon `id` (e.g. "Aatrox", "MonkeyKing")
 * @param tags         Optional Data Dragon tags for fallback (Fighter, Mage…)
 */
export function getChampionRoles(championKey: string, tags: string[] = []): Role[] {
  return CHAMPION_ROLES[championKey] ?? rolesFromTags(tags)
}

/**
 * Helper for filter UIs: does this champion play this role?
 * Returns true when:
 *   - the champion has the role in their curated list, OR
 *   - the curated list is empty AND the tag fallback matches
 */
export function championPlaysRole(championKey: string, role: Role, tags: string[] = []): boolean {
  return getChampionRoles(championKey, tags).includes(role)
}

export const ROLES: readonly Role[] = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT']

export const ROLE_LABEL_SHORT: Record<Role, string> = {
  TOP: 'Top',
  JUNGLE: 'JG',
  MID: 'Mid',
  ADC: 'ADC',
  SUPPORT: 'Sup',
}
