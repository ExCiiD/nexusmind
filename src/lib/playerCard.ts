/**
 * Player cards of Team → Roster: which champions a card shows, and which
 * profile look (the icon and banner picked on the Profile page) belongs to
 * a roster member. Pure: the champions come from the team's champion pools
 * (written by auto-fill and scouting), the looks from the cloud groups the
 * coach shares with the players (`group_members.profile_icon/_banner`).
 */
import type { ChampionPoolEntry } from './ipc'
import type { MemberLook } from './collab'

/** How many champions a card shows. */
export const CARD_CHAMPIONS = 5
/** The most-played champions the best win rates are picked from. */
export const MOST_PLAYED_POOL = 10
/** Under this many games a win rate says little: such a champion only
 *  fills an empty spot, after the others. */
export const MIN_GAMES = 3

export interface CardChampion {
  championKey: string
  games: number
  wins: number
  winRate: number
  /** Fewer than MIN_GAMES games: listed last, its win rate only a hint. */
  lowSample: boolean
}

export interface CardChampions {
  champions: CardChampion[]
  /** Games behind the pool entries, every champion counted. */
  games: number
}

/**
 * The 5 best win rates among the player's 10 most-played champions (3 games
 * or more), best first. A champion played in several roles counts once, its
 * games added up. Entries without games (added by hand, or mastery only)
 * are left out. When fewer than 5 champions qualify, the next most-played
 * ones fill the card, after the others.
 */
export function bestChampions(pool: ChampionPoolEntry[] | null | undefined, count = CARD_CHAMPIONS): CardChampions {
  const byKey = new Map<string, { championKey: string; games: number; wins: number }>()
  let total = 0
  for (const e of pool ?? []) {
    const games = e.playRate ?? 0
    if (games <= 0 || e.winRate == null) continue
    // The pool stores a rounded percentage; this gives the wins back.
    const wins = Math.round((games * e.winRate) / 100)
    total += games
    const c = byKey.get(e.championKey)
    if (c) {
      c.games += games
      c.wins += wins
    } else {
      byKey.set(e.championKey, { championKey: e.championKey, games, wins })
    }
  }

  const played: CardChampion[] = [...byKey.values()]
    .map((c) => ({ ...c, winRate: Math.round((c.wins / c.games) * 100), lowSample: c.games < MIN_GAMES }))
    .sort((a, b) => b.games - a.games || a.championKey.localeCompare(b.championKey))

  const best = played
    .filter((c) => !c.lowSample)
    .slice(0, MOST_PLAYED_POOL)
    .sort((a, b) => b.winRate - a.winRate || b.games - a.games)
    .slice(0, count)
  for (const c of played) {
    if (best.length >= count) break
    if (!best.includes(c)) best.push(c)
  }
  return { champions: best, games: total }
}

/** A Riot ID folded for comparison: case and spaces don't matter. Without
 *  a tag, the name alone. */
export function riotIdKey(name: string | null | undefined, tag?: string | null): string | null {
  const fold = (s: string) => s.normalize('NFKC').toLowerCase().replace(/\s+/g, '')
  const n = fold(name ?? '')
  if (!n) return null
  const t = fold(tag ?? '')
  return t ? `${n}#${t}` : n
}

/** Same as riotIdKey, from a "Name#TAG" string. */
export function riotIdKeyOf(riotId: string | null | undefined): string | null {
  if (!riotId) return null
  const i = riotId.lastIndexOf('#')
  return i < 0 ? riotIdKey(riotId) : riotIdKey(riotId.slice(0, i), riotId.slice(i + 1))
}

/** Ids of the app's own artwork (src/lib/profile.ts); null when not chosen. */
export interface Look {
  iconId: string | null
  bannerId: string | null
}

export interface LookSources {
  /** The player using this PC: their own look, read locally. */
  me?: { puuid?: string | null; riotId: string | null; look: Look | null } | null
  /** Looks shared by the members of the user's cloud groups. */
  looks?: MemberLook[] | null
}

/**
 * The profile look of a roster member: the local player's own when the card
 * is theirs, else the one a group member with the same Riot ID shared. A
 * member without a tag is matched on the name alone, only when a single
 * group member has it. Null when nobody matches: the card falls back to
 * initials and the default banner.
 */
export function lookForMember(
  member: { ign?: string | null; tagLine?: string | null; puuid?: string | null },
  { me, looks }: LookSources,
): Look | null {
  const key = riotIdKey(member.ign, member.tagLine)
  if (me?.look) {
    const samePuuid = !!member.puuid && !!me.puuid && member.puuid === me.puuid
    if (samePuuid || (key && key === riotIdKeyOf(me.riotId))) return me.look
  }
  if (!key) return null
  const shared = (looks ?? []).filter((l) => l.iconId || l.bannerId)
  const exact = shared.find((l) => riotIdKeyOf(l.riotId) === key)
  const match = exact ?? (() => {
    if (member.tagLine?.trim()) return undefined
    const byName = shared.filter((l) => riotIdKeyOf(l.riotId)?.split('#')[0] === key)
    return byName.length === 1 ? byName[0] : undefined
  })()
  return match ? { iconId: match.iconId, bannerId: match.bannerId } : null
}

/** Two letters for a player without a look: "Kaito" → "KA", "Le Chef" → "LC". */
export function initialsOf(name: string): string {
  const words = name.trim().split(/[\s._-]+/).filter(Boolean)
  if (words.length === 0) return '?'
  const letters = words.length > 1 ? words[0][0] + words[1][0] : words[0].slice(0, 2)
  return letters.toUpperCase()
}
