/**
 * #46 point 4 ("ore wa ayura"): the team roster the desktop publishes (team_rosters) was never linked to the group's
 * members. A published row kept the Riot ID the coach typed long ago, with no account (user_id) and no puuid, so a
 * renamed player stayed under their old name for everyone, and nothing could refresh it by puuid (#38).
 *
 * At publish time each roster player is linked to its group member:
 *   1. by puuid (the roster's own one equals the member's), and then the row takes the member's CURRENT Riot ID:
 *      the member republishes it after a rename (#38), the coach's local copy may be old;
 *   2. else by Riot ID (case, spaces and width ignored, playerCard.riotIdKey).
 * The linked row gets the member's account, and the member's puuid only when the server verified it
 * (verify-member-puuid): never a puuid a client typed. One member is linked to one row at most (the first match).
 * A player the publish cannot match is left as it is: the staff links it by hand (link_roster_member).
 *
 * Pure, tested. teamCore.publishTeam applies it.
 */
/** playerCard.riotIdKey / riotIdKeyOf, repeated here: playerCard.ts imports screen assets the main process can't. */
export function riotIdKey(name: string | null | undefined, tag?: string | null): string | null {
  const fold = (s: string) => s.normalize('NFKC').toLowerCase().replace(/\s+/g, '')
  const n = fold(name ?? '')
  if (!n) return null
  const t = fold(tag ?? '')
  return t ? `${n}#${t}` : n
}
function riotIdKeyOf(riotId: string | null | undefined): string | null {
  if (!riotId) return null
  const i = riotId.lastIndexOf('#')
  return i < 0 ? riotIdKey(riotId) : riotIdKey(riotId.slice(0, i), riotId.slice(i + 1))
}

export interface RosterPlayerIdentity {
  ign: string | null
  tagLine: string | null
  puuid: string | null
}

export interface GroupMemberIdentity {
  userId: string
  riotId: string | null
  puuid: string | null
  /** 'verified' when the server derived the puuid from the member's Riot ID. */
  puuidStatus: string | null
}

export interface RosterLink {
  userId: string | null
  /** The puuid to publish: the member's verified one when linked, else the roster's own. */
  puuid: string | null
  /** Set when the row takes the member's current Riot ID (linked by puuid, the member renamed). */
  ign?: string
  tagLine?: string | null
}

function splitRiotId(riotId: string): [string, string | null] {
  const i = riotId.lastIndexOf('#')
  return i < 0 ? [riotId.trim(), null] : [riotId.slice(0, i).trim(), riotId.slice(i + 1).trim() || null]
}

export function linkRosterToMembers(roster: readonly RosterPlayerIdentity[], members: readonly GroupMemberIdentity[]): RosterLink[] {
  const taken = new Set<string>()
  const verifiedPuuid = (m: GroupMemberIdentity) => (m.puuidStatus === 'verified' ? m.puuid : null)
  const pick = (r: RosterPlayerIdentity): { m: GroupMemberIdentity; byPuuid: boolean } | null => {
    if (r.puuid) {
      const m = members.find((x) => !taken.has(x.userId) && x.puuid === r.puuid)
      if (m) return { m, byPuuid: true }
    }
    const key = riotIdKey(r.ign, r.tagLine)
    if (key) {
      const m = members.find((x) => !taken.has(x.userId) && riotIdKeyOf(x.riotId) === key)
      if (m) return { m, byPuuid: false }
    }
    return null
  }
  return roster.map((r) => {
    const found = pick(r)
    if (!found) return { userId: null, puuid: r.puuid }
    taken.add(found.m.userId)
    const link: RosterLink = { userId: found.m.userId, puuid: verifiedPuuid(found.m) ?? r.puuid }
    if (found.byPuuid && found.m.riotId && riotIdKeyOf(found.m.riotId) !== riotIdKey(r.ign, r.tagLine)) {
      const [ign, tagLine] = splitRiotId(found.m.riotId)
      if (ign) { link.ign = ign; link.tagLine = tagLine }
    }
    return link
  })
}
