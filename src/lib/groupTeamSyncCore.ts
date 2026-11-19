import { riotIdKey, riotIdKeyOf } from './playerCard'

/** The five lanes a roster slot can hold, in the order free slots are filled. */
export const LANES = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'] as const
export type Lane = (typeof LANES)[number]

export interface SyncGroupMember {
  role: string
  displayName: string | null
  riotId: string | null
  /** #38: the stable key, when the member published it (a Riot ID changes on a rename). */
  puuid?: string | null
}

export interface SyncTeamMember {
  id: string
  ign?: string | null
  tagLine?: string | null
  displayName?: string | null
  puuid?: string | null
  role: string
}

export interface MemberToAdd {
  displayName: string
  ign: string
  tagLine: string | undefined
  role: Lane
  puuid?: string
}

/** #38: a team member kept, with what changed (same row: lane, champion pool and rank stay with the player). */
export interface MemberToUpdate {
  id: string
  ign?: string
  tagLine?: string
  displayName?: string
  puuid?: string
  /** #38: the old Riot ID when this is a rename (the screens show it instead of switching silently). */
  previousRiotId?: string
}

export interface GroupTeamSyncPlan {
  add: MemberToAdd[]
  /** Team member ids no longer matching a player of the group. */
  remove: string[]
  /** Team members matched to a player whose Riot ID or puuid changed. */
  update: MemberToUpdate[]
}

/** "Name#TAG" → ["Name", "TAG"]; the tag is cut at the last '#'. */
export function splitRiotId(riotId: string): [string, string | undefined] {
  const i = riotId.lastIndexOf('#')
  return i < 0 ? [riotId.trim(), undefined] : [riotId.slice(0, i).trim(), riotId.slice(i + 1).trim() || undefined]
}

/**
 * Stats collectives, Espace d'équipe, Champion Pool and Draft Sim read the
 * local team linked to the group; since 19/11/2026 that team is no longer
 * picked or filled by hand — it mirrors the group's players (members with
 * the 'player' role and a Riot account). This works out what to change:
 * players missing from the team are added (lane from `preferredLane` — the
 * roster the group published — else the first free lane), and team members
 * who are not players of the group any more are removed. Lanes already set
 * on the team are left alone, so the staff's choices stick.
 *
 * #38: a player is matched on their puuid first, then on their Riot ID. A
 * puuid match whose Riot ID changed (a rename) updates the same team member
 * instead of removing and re-adding it; a Riot ID match fills a missing puuid.
 */
export function planGroupTeamSync(
  groupMembers: SyncGroupMember[],
  teamMembers: SyncTeamMember[],
  preferredLane: (riotIdKey: string) => string | null | undefined = () => null,
): GroupTeamSyncPlan {
  const players: Array<{ key: string; m: SyncGroupMember }> = []
  const byKey = new Map<string, number>()
  const byPuuid = new Map<string, number>()
  for (const m of groupMembers) {
    if (m.role !== 'player' || !m.riotId) continue
    const key = riotIdKeyOf(m.riotId)
    if (!key || byKey.has(key) || (m.puuid && byPuuid.has(m.puuid))) continue
    byKey.set(key, players.length)
    if (m.puuid) byPuuid.set(m.puuid, players.length)
    players.push({ key, m })
  }

  const remove: string[] = []
  const update: MemberToUpdate[] = []
  const kept = new Set<number>()
  const taken = new Set<string>()
  for (const tm of teamMembers) {
    const viaPuuid = tm.puuid ? byPuuid.get(tm.puuid) : undefined
    const tmKey = riotIdKey(tm.ign, tm.tagLine)
    const viaKey = tmKey ? byKey.get(tmKey) : undefined
    // A different puuid on the same name is another account: no match on the name then.
    const idx = viaPuuid ?? (viaKey !== undefined && !(tm.puuid && players[viaKey].m.puuid && players[viaKey].m.puuid !== tm.puuid) ? viaKey : undefined)
    if (idx === undefined || kept.has(idx)) { remove.push(tm.id); continue }
    kept.add(idx)
    taken.add(tm.role)
    const { key, m } = players[idx]
    const change: MemberToUpdate = { id: tm.id }
    if (key !== tmKey) {
      const [ign, tagLine] = splitRiotId(m.riotId as string)
      change.ign = ign
      if (tagLine) change.tagLine = tagLine
      // A name only (no Riot ID before) is a first link, not a rename.
      if (tmKey) change.previousRiotId = [tm.ign, tm.tagLine].filter(Boolean).join('#')
      const shown = (tm.displayName ?? '').trim()
      if (!shown || shown === (tm.ign ?? '').trim()) change.displayName = m.displayName || ign
    }
    if (m.puuid && m.puuid !== tm.puuid) change.puuid = m.puuid
    if (Object.keys(change).length > 1) update.push(change)
  }

  const add: MemberToAdd[] = []
  players.forEach(({ key, m }, idx) => {
    if (kept.has(idx)) return
    const [ign, tagLine] = splitRiotId(m.riotId as string)
    const wanted = preferredLane(key)
    const lane = (LANES as readonly string[]).includes(wanted ?? '') && !taken.has(wanted as string)
      ? wanted as Lane
      : LANES.find((l) => !taken.has(l)) ?? 'TOP'
    taken.add(lane)
    add.push({ displayName: m.displayName || ign, ign, tagLine, role: lane, ...(m.puuid ? { puuid: m.puuid } : {}) })
  })
  return { add, remove, update }
}

/** A Riot ID typed by hand ("Name#TAG"), or null when it isn't one. */
export function parseRiotIdInput(input: string): string | null {
  const s = input.trim()
  const i = s.lastIndexOf('#')
  if (i <= 0 || i === s.length - 1) return null
  const name = s.slice(0, i).trim()
  const tag = s.slice(i + 1).trim()
  if (name.length < 3 || name.length > 16 || tag.length < 2 || tag.length > 5) return null
  return `${name}#${tag}`
}
