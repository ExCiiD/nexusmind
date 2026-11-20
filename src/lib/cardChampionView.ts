/**
 * Team Lobby cards, champion and skin picker (docs/DESIGN_STATE.md § 14): which card is mine, the champion and skin
 * each member picked (MemberLook.card), what the front of a card shows, and the skin grid of the pop-up. Pure, tested.
 */
import type { CardChampion, CardSkin, MemberLook } from './collab'
import { riotIdKey, riotIdKeyOf } from './playerCard'

/** The roster member is the signed-in player (same puuid, else same Riot ID). */
export function isOwnMember(
  member: { ign?: string | null; tagLine?: string | null; puuid?: string | null },
  me: { puuid?: string | null; riotId: string | null } | null | undefined,
): boolean {
  if (!me) return false
  if (member.puuid && me.puuid && member.puuid === me.puuid) return true
  const key = riotIdKey(member.ign, member.tagLine)
  return !!key && key === riotIdKeyOf(me.riotId)
}

/** The champion and skin a roster member picked for their card (their shared look, matched by Riot ID), or null. */
export function cardChoiceOf(
  member: { ign?: string | null; tagLine?: string | null },
  looks: ReadonlyArray<Pick<MemberLook, 'riotId' | 'card'>> | null | undefined,
): CardChampion | null {
  const key = riotIdKey(member.ign, member.tagLine)
  if (!key) return null
  return (looks ?? []).find((l) => riotIdKeyOf(l.riotId) === key)?.card ?? null
}

/**
 * What the front of a card shows: the picked champion and skin while that champion is still one of the card's top
 * champions; otherwise (no choice, or it left the top) the automatic one, base skin. Null without any champion.
 */
export function frontChampion(choice: CardChampion | null, topKeys: readonly string[], autoKey: string | null): CardChampion | null {
  if (choice && topKeys.includes(choice.championId)) return choice
  return autoKey ? { championId: autoKey, skinNum: 0 } : null
}

/**
 * The cut-outs a card tries, in order (never the raw art): the picked skin, then the champion's other skins with a
 * hosted cut-out, base skin first. While the hosted list is unknown (null), only the picked skin; when it is known
 * and the picked skin is not in it, that skin is skipped (no request bound to fail). Empty: the neutral glow only.
 */
export function cutoutCandidates(skinNum: number, hosted: readonly number[] | null): number[] {
  if (!hosted) return [skinNum]
  const sorted = [...hosted].sort((a, b) => a - b)
  return sorted.includes(skinNum) ? [skinNum, ...sorted.filter((n) => n !== skinNum)] : sorted
}

/** One tile of the pop-up's grid. */
export interface SkinTile {
  num: number
  /** Data Dragon's name; null for the base skin (the screen names it after the champion). */
  name: string | null
  /** The hosted cut-out; null when the skin has none. */
  cutoutUrl: string | null
  selectable: boolean
}

/**
 * The pop-up's grid: the base skin first, then the skins with a hosted cut-out, in Data Dragon's order; the skins
 * without one apart, at the end, not selectable. When no skin of the champion has a cut-out, the base skin stays
 * selectable (the card then shows its faded art).
 */
export function skinTiles(
  hosted: ReadonlyArray<Pick<CardSkin, 'num' | 'name' | 'url'>>,
  all: ReadonlyArray<{ num: number; name: string | null }>,
): { withCutout: SkinTile[]; without: SkinTile[] } {
  const byNum = new Map(hosted.map((s) => [s.num, s]))
  const names = new Map(all.map((s) => [s.num, s.name]))
  const withCutout: SkinTile[] = [...hosted]
    .sort((a, b) => a.num - b.num)
    .map((s) => ({ num: s.num, name: s.num === 0 ? null : s.name ?? names.get(s.num) ?? null, cutoutUrl: s.url, selectable: true }))
  const without: SkinTile[] = all
    .filter((s) => !byNum.has(s.num))
    .sort((a, b) => a.num - b.num)
    .map((s) => ({ num: s.num, name: s.num === 0 ? null : s.name, cutoutUrl: null, selectable: false }))
  if (withCutout.length === 0) {
    const base = without.find((s) => s.num === 0)
    return {
      withCutout: [{ num: 0, name: null, cutoutUrl: null, selectable: true }],
      without: base ? without.filter((s) => s !== base) : without,
    }
  }
  return { withCutout, without }
}

/** Data Dragon locale for the app's language. */
export const skinLocale = (language: string | undefined): 'fr_FR' | 'en_US' => (language?.startsWith('fr') ? 'fr_FR' : 'en_US')
