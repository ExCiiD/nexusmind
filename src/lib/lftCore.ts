/**
 * Looking-for-team announcements (Coaching & Management → Espace d'équipe):
 * the image a roster player, or several of them together ("multi search"),
 * post to find a team. Pure parts: which champions an announcement lists,
 * the seats of the multi-search lobby and the role swaps of the selection,
 * the formats, the clean-up of what the user typed, and the file name.
 * Ranks come from src/lib/rankCore.ts.
 */
import { normalizeRole } from './teamIdentity'
import { ROLES, type Role } from './championRoles'

/** The fields of a champion-pool entry (ChampionPoolEntry in ipc.ts) read
 *  here; kept apart so the main process can import this module. */
export interface LftPoolEntry {
  championKey: string
  role: string
  tier?: string | null
  playRate?: number | null
  winRate?: number | null
  masteryPoints?: number | null
}

/** Lobby seat order, as in the client: the app's role list (championRoles.ts), same values, same order. */
export const LFT_ROLES: readonly Role[] = ROLES
export type LftRole = Role

/** A roster or Riot role name as an LFT role; null when it isn't one. */
export function asLftRole(role: string | null | undefined): LftRole | null {
  const r = normalizeRole(role)
  return (LFT_ROLES as readonly string[]).includes(r) ? (r as LftRole) : null
}

export type LftMode = 'solo' | 'multi'
export type LftFormat = 'banner' | 'card'

/** Exported size of each format, in pixels. */
export const LFT_FORMATS: Record<LftFormat, { width: number; height: number }> = {
  banner: { width: 1920, height: 1080 },
  card: { width: 1200, height: 600 },
}

/** A lobby has 5 seats and at least one is searched. */
export const MAX_SEARCHERS = LFT_ROLES.length - 1
/** Champions an announcement lists per player. */
export const LFT_CHAMPIONS = 5

// ── Main champions ─────────────────────────────────────────────────────────

export interface LftChampion {
  championKey: string
  games: number
  wins: number
  /** Rounded %, null without games. */
  winRate: number | null
}

// Same order as the Champion Pool (threatCore TIERS): "new" below "flex".
const TIER_ORDER = ['main', 'comfort', 'flex', 'new', 'learning']
const tierRank = (tier: string | null | undefined) => {
  const i = TIER_ORDER.indexOf(tier ?? '')
  return i < 0 ? TIER_ORDER.length : i
}

/**
 * The champions an announcement lists: the most played in the announced
 * role first, then those of the other roles, each champion once (its games
 * in that group added up). Entries without games (added by hand, mastery
 * only) come last: tier first, then mastery points.
 */
export function mainChampions(
  pool: LftPoolEntry[] | null | undefined,
  role: LftRole | null,
  count = LFT_CHAMPIONS,
): LftChampion[] {
  type Acc = { championKey: string; games: number; wins: number; tier: number; mastery: number }
  const group = (entries: LftPoolEntry[]) => {
    const byKey = new Map<string, Acc>()
    for (const e of entries) {
      const games = Math.max(0, Math.round(e.playRate ?? 0))
      const wins = games > 0 && e.winRate != null ? Math.round((games * e.winRate) / 100) : 0
      const c = byKey.get(e.championKey)
      if (c) {
        c.games += games
        c.wins += wins
        c.tier = Math.min(c.tier, tierRank(e.tier))
        c.mastery = Math.max(c.mastery, e.masteryPoints ?? 0)
      } else {
        byKey.set(e.championKey, { championKey: e.championKey, games, wins, tier: tierRank(e.tier), mastery: e.masteryPoints ?? 0 })
      }
    }
    return [...byKey.values()]
  }
  const order = (a: Acc, b: Acc) =>
    b.games - a.games || a.tier - b.tier || b.mastery - a.mastery || a.championKey.localeCompare(b.championKey)

  const entries = (pool ?? []).filter((e) => e.championKey)
  const inRole = group(entries.filter((e) => role && asLftRole(e.role) === role))
  const others = group(entries.filter((e) => !role || asLftRole(e.role) !== role))
  const played = [...inRole.filter((c) => c.games > 0).sort(order), ...others.filter((c) => c.games > 0).sort(order)]
  const unplayed = [...inRole, ...others].filter((c) => c.games === 0).sort(order)

  const out: LftChampion[] = []
  const seen = new Set<string>()
  for (const c of [...played, ...unplayed]) {
    if (out.length >= count) break
    if (seen.has(c.championKey)) continue
    seen.add(c.championKey)
    out.push({ championKey: c.championKey, games: c.games, wins: c.wins, winRate: c.games > 0 ? Math.round((c.wins / c.games) * 100) : null })
  }
  return out
}

// ── Multi-search lobby ─────────────────────────────────────────────────────

/** Seat of each selected player, by member id. */
export type SeatRoles = Record<string, LftRole>

/**
 * Seats the player joining the search: their roster role when it's free,
 * else the first free seat. Unchanged when no seat is left.
 */
export function joinLobby(roles: SeatRoles, member: { id: string; role: string | null | undefined }): SeatRoles {
  if (roles[member.id]) return roles
  const taken = new Set(Object.values(roles))
  const own = asLftRole(member.role)
  const seat = own && !taken.has(own) ? own : LFT_ROLES.find((r) => !taken.has(r))
  return seat ? { ...roles, [member.id]: seat } : roles
}

export function leaveLobby(roles: SeatRoles, memberId: string): SeatRoles {
  const next = { ...roles }
  delete next[memberId]
  return next
}

/**
 * Moves a player to `role`. A player already there takes the mover's old
 * seat (a swap), so two players never share a seat.
 */
export function assignSeat(roles: SeatRoles, memberId: string, role: LftRole): SeatRoles {
  const previous = roles[memberId]
  const next: SeatRoles = { ...roles, [memberId]: role }
  const other = Object.keys(roles).find((id) => id !== memberId && roles[id] === role)
  if (other) {
    if (previous) next[other] = previous
    else delete next[other]
  }
  return next
}

/** Searched seats: every free seat the user didn't turn off. */
export function wantedRoles(roles: SeatRoles, unwanted: Iterable<LftRole> = []): LftRole[] {
  const taken = new Set(Object.values(roles))
  const off = new Set(unwanted)
  return LFT_ROLES.filter((r) => !taken.has(r) && !off.has(r))
}

export type LobbySeat<P> =
  | { role: LftRole; kind: 'player'; player: P }
  /** A seat the players search: shown with a "+". */
  | { role: LftRole; kind: 'wanted' }
  /** Neither taken by a searcher nor searched (a player outside the roster). */
  | { role: LftRole; kind: 'open' }

/**
 * The 5 seats in client order: each player on their seat, the searched
 * seats, the rest open. A player whose seat is already taken goes to the
 * first seat left that isn't searched.
 */
export function lobbySeats<P extends { seat: LftRole }>(players: P[], wanted: Iterable<LftRole>): Array<LobbySeat<P>> {
  const want = new Set(wanted)
  const bySeat = new Map<LftRole, P>()
  const extra: P[] = []
  for (const p of players) {
    if (bySeat.has(p.seat)) extra.push(p)
    else bySeat.set(p.seat, p)
  }
  for (const p of extra) {
    const free = LFT_ROLES.find((r) => !bySeat.has(r) && !want.has(r)) ?? LFT_ROLES.find((r) => !bySeat.has(r))
    if (free) bySeat.set(free, p)
  }
  return LFT_ROLES.map((role): LobbySeat<P> => {
    const player = bySeat.get(role)
    if (player) return { role, kind: 'player', player }
    return want.has(role) ? { role, kind: 'wanted' } : { role, kind: 'open' }
  })
}

// ── What the user types ────────────────────────────────────────────────────

export const LFT_LIMITS = {
  lookingFor: 48,
  languages: 48,
  /** Discord usernames are 2–32 characters. */
  discord: 32,
  tag: 24,
  tags: 4,
  message: 180,
} as const

/** One line: spaces collapsed, cut at `max` characters. */
export function cleanLine(text: string | null | undefined, max: number): string {
  return [...(text ?? '').replace(/\s+/g, ' ').trim()].slice(0, max).join('').trim()
}

/** Tags from free text ("Scrims, Tryhard ranked") or a list: cleaned,
 *  duplicates (any case) dropped, at most LFT_LIMITS.tags. */
export function parseTags(input: string | string[] | null | undefined): string[] {
  const parts = Array.isArray(input) ? input : (input ?? '').split(/[,;\n]/)
  const out: string[] = []
  const seen = new Set<string>()
  for (const p of parts) {
    const tag = cleanLine(p, LFT_LIMITS.tag)
    const key = tag.toLocaleLowerCase()
    if (!tag || seen.has(key)) continue
    seen.add(key)
    out.push(tag)
    if (out.length >= LFT_LIMITS.tags) break
  }
  return out
}

/** Adds or removes one tag (a suggestion chip), keeping the limit. */
export function toggleTag(tags: string[], tag: string): string[] {
  const key = tag.toLocaleLowerCase()
  return tags.some((t) => t.toLocaleLowerCase() === key)
    ? tags.filter((t) => t.toLocaleLowerCase() !== key)
    : parseTags([...tags, tag])
}

// ── Strengths, weaknesses, wanted profile (fundamentals) ───────────────────

/** How many fundamentals each list keeps: few enough to stay readable. */
export const LFT_TRAITS = {
  strengths: 3,
  weaknesses: 2,
  /** Multi search: strengths wanted in the new players. */
  wanted: 3,
  /** Multi search: what they must already know. */
  required: 4,
} as const

export interface TraitPicks {
  strengths: string[]
  weaknesses: string[]
}

/** Adds or removes a fundamental; past `max` the list stays as it is. */
export function toggleTrait(list: string[], id: string, max: number): string[] {
  if (list.includes(id)) return list.filter((x) => x !== id)
  return list.length >= max ? list : [...list, id]
}

/** Known fundamental ids from stored data, no duplicates, at most `max`. */
export function cleanTraits(ids: unknown, known: (id: string) => boolean, max: number): string[] {
  if (!Array.isArray(ids)) return []
  const out: string[] = []
  for (const id of ids) {
    if (typeof id === 'string' && known(id) && !out.includes(id)) out.push(id)
    if (out.length >= max) break
  }
  return out
}

/** A player's picks: a fundamental can't be both a strength and a weakness
 *  (the newest pick wins). */
export function pickTrait(picks: TraitPicks, kind: keyof TraitPicks, id: string): TraitPicks {
  const other: keyof TraitPicks = kind === 'strengths' ? 'weaknesses' : 'strengths'
  const next = toggleTrait(picks[kind], id, LFT_TRAITS[kind])
  if (next === picks[kind]) return picks
  return { ...picks, [kind]: next, [other]: next.includes(id) ? picks[other].filter((x) => x !== id) : picks[other] }
}

// ── Labels and files ───────────────────────────────────────────────────────

const REGION_LABELS: Record<string, string> = {
  BR1: 'BR', EUN1: 'EUNE', EUW1: 'EUW', JP1: 'JP', KR: 'KR', LA1: 'LAN', LA2: 'LAS', ME1: 'ME',
  NA1: 'NA', OC1: 'OCE', PH2: 'PH', RU: 'RU', SG2: 'SG', TH2: 'TH', TR1: 'TR', TW2: 'TW', VN2: 'VN',
}

/** "EUW1" → "EUW", as players write it. */
export function regionLabel(region: string | null | undefined): string | null {
  const r = (region ?? '').trim().toUpperCase()
  if (!r) return null
  return REGION_LABELS[r] ?? r.replace(/\d+$/, '')
}

/** The region an announcement shows: the most common among its players. */
export function commonRegion(regions: Array<string | null | undefined>): string | null {
  const counts = new Map<string, number>()
  for (const r of regions) {
    const label = regionLabel(r)
    if (label) counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  let best: string | null = null
  for (const [label, n] of counts) if (best === null || n > (counts.get(best) ?? 0)) best = label
  return best
}

/** "Name#TAG" without an empty tag; null without a name. */
export function riotIdOf(member: { ign?: string | null; tagLine?: string | null }): { name: string; tag: string | null } | null {
  const name = (member.ign ?? '').trim()
  if (!name) return null
  const tag = (member.tagLine ?? '').trim()
  return { name, tag: tag || null }
}

/** ascend-lft-kaito-vexa-1920x1080.png — accents dropped, other scripts
 *  replaced by "player". */
export function lftFileName(names: string[], format: LftFormat): string {
  const slug = names
    .map((n) => n.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''))
    .filter(Boolean)
    .join('-')
    .slice(0, 48)
    .replace(/-+$/, '')
  const { width, height } = LFT_FORMATS[format]
  return `ascend-lft-${slug || 'player'}-${width}x${height}.png`
}

// ── Text fitting ───────────────────────────────────────────────────────────

const WIDE_CHAR = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]|\p{Extended_Pictographic}/u

/** Rough width of a text in em in the condensed display face (Big
 *  Shoulders Display, heavy): wide scripts (CJK, Hangul) and emoji count 1. */
export function displayTextEm(text: string): number {
  let em = 0
  for (const ch of text) {
    if (WIDE_CHAR.test(ch)) em += 1
    else if (ch === ' ') em += 0.24
    else if (/[A-Z0-9#@%&MW]/.test(ch)) em += 0.52
    else em += 0.45
  }
  return em
}

/** The biggest font size (px, between min and max) at which `text` fits in
 *  `width` on one line. Below min, the text is cut by the layout. */
export function fitFontSize(text: string, width: number, max: number, min: number): number {
  const em = displayTextEm(text)
  if (em <= 0) return max
  return Math.max(min, Math.min(max, Math.floor(width / em)))
}

// ── Exported picture ───────────────────────────────────────────────────────

/** Hosts the announcement's pictures may come from, besides the app itself. */
export const LFT_IMAGE_HOSTS = ['https://ddragon.leagueoflegends.com', 'https://raw.communitydragon.org'] as const

/** Is (width, height) the size of one of the formats? */
export function isLftSize(width: number, height: number): boolean {
  return Object.values(LFT_FORMATS).some((f) => f.width === width && f.height === height)
}

/**
 * The page the main process renders off screen into the PNG: the app's
 * stylesheet, the announcement's markup, nothing else. No script can run
 * (the policy allows none, and the window has JavaScript off); pictures come
 * from the app (`self`: its fonts, logo) and the two Riot art hosts.
 */
export function lftPosterDocument(p: { markup: string; css: string; width: number; height: number; self: string }): string {
  // 'self' too: the page has the app's origin, and an explicit origin isn't
  // a valid source when its host is an IPv6 literal ([::1]).
  const policy = [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    `font-src 'self' ${p.self} data:`,
    `img-src 'self' ${p.self} ${LFT_IMAGE_HOSTS.join(' ')} data: blob:`,
  ].join('; ')
  // `</style` can't appear inside the style element; nothing else in the
  // stylesheet can end it early.
  const css = p.css.replace(/<\/style/gi, '<\\/style')
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${policy}">`,
    `<style>${css}</style>`,
    `<style>html,body{margin:0;padding:0;width:${p.width}px;height:${p.height}px;overflow:hidden;background:#000}</style>`,
    `</head><body>${p.markup}</body></html>`,
  ].join('')
}

// ── Champion art (Data Dragon) ─────────────────────────────────────────────

const DDRAGON = 'https://ddragon.leagueoflegends.com/cdn'

/** Square icon (versioned), or the splash (16:9), loading-screen portrait or
 *  small tile of a skin (0: the base skin). */
export function championArtUrl(kind: 'icon' | 'splash' | 'loading' | 'tiles', championKey: string, version: string, skin = 0): string {
  if (kind === 'icon') return `${DDRAGON}/${version}/img/champion/${championKey}.png`
  const num = Number.isInteger(skin) && skin >= 0 ? skin : 0
  return `${DDRAGON}/img/champion/${kind}/${championKey}_${num}.jpg`
}

/** Skin list of a champion (Data Dragon `champion/{Key}.json`): number and
 *  name, the base skin first. Chromas (`parentSkin`) are left out: Data
 *  Dragon has no picture for them. Anything unreadable gives the base skin. */
export function parseChampionSkins(json: unknown, championKey: string): Array<{ num: number; name: string }> {
  const skins = (json as { data?: Record<string, { skins?: unknown }> } | null)?.data?.[championKey]?.skins
  const out = (Array.isArray(skins) ? skins : [])
    .filter((s: { parentSkin?: unknown }) => s?.parentSkin == null)
    .map((s: { num?: unknown; name?: unknown }) => ({ num: typeof s?.num === 'number' ? s.num : -1, name: typeof s?.name === 'string' ? s.name : '' }))
    .filter((s) => Number.isInteger(s.num) && s.num >= 0)
  if (!out.some((s) => s.num === 0)) out.unshift({ num: 0, name: 'default' })
  return out.sort((a, b) => a.num - b.num)
}

// ── Solo LFT for a player without a group (DESIGN_STATE § 18.2, "Je cherche une équipe") ──
// The poster reads a roster member (TeamMember: Riot ID, role, champion pool). A player with no group has no roster:
// their pool comes from their own recorded games instead, in the same shape (playRate = games, winRate in %).

export interface SoloGame { champion: string; role: string | null; win: boolean }

/** The roster member the poster reads (the fields of TeamMember in ipc.ts it uses), built for a player alone. */
export interface SoloLftMember {
  id: string
  teamId: string
  displayName: string
  ign: string | null
  tagLine: string | null
  region: string | null
  role: string
  puuid: string | null
  champPool: Array<LftPoolEntry & { id: string; memberId: string; tier: string }>
}

/** The champion pool of a player's own games: one entry per champion and role, the most played first. */
export function soloPoolFromGames(games: SoloGame[], memberId = 'me'): Array<LftPoolEntry & { id: string; memberId: string; tier: string }> {
  const byKey = new Map<string, { championKey: string; role: string; games: number; wins: number }>()
  for (const g of games) {
    const role = asLftRole(g.role)
    if (!g.champion || !role) continue
    const key = `${g.champion}|${role}`
    const e = byKey.get(key) ?? { championKey: g.champion, role, games: 0, wins: 0 }
    e.games++
    if (g.win) e.wins++
    byKey.set(key, e)
  }
  return [...byKey.values()]
    .sort((a, b) => b.games - a.games || b.wins - a.wins)
    .map((e) => ({
      id: `${memberId}:${e.championKey}:${e.role}`, memberId, championKey: e.championKey, role: e.role, tier: 'comfort',
      playRate: e.games, winRate: Math.round((e.wins / e.games) * 1000) / 10,
    }))
}

/** The player's role: their main role when set, else the role of most of their games. */
export function soloRole(mainRole: string | null | undefined, games: SoloGame[]): LftRole | null {
  const own = asLftRole(mainRole)
  if (own) return own
  const counts = new Map<LftRole, number>()
  for (const g of games) { const r = asLftRole(g.role); if (r) counts.set(r, (counts.get(r) ?? 0) + 1) }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
}
