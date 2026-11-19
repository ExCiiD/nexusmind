import { riotIdKey, riotIdKeyOf } from './playerCard'

/** The five lanes a roster slot can hold, in the order free slots are filled. */
export const LANES = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'] as const
export type Lane = (typeof LANES)[number]

export interface SyncGroupMember {
  role: string
  displayName: string | null
  riotId: string | null
}

export interface SyncTeamMember {
  id: string
  ign?: string | null
  tagLine?: string | null
  role: string
}

export interface MemberToAdd {
  displayName: string
  ign: string
  tagLine: string | undefined
  role: Lane
}

export interface GroupTeamSyncPlan {
  add: MemberToAdd[]
  /** Team member ids no longer matching a player of the group. */
  remove: string[]
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
 */
export function planGroupTeamSync(
  groupMembers: SyncGroupMember[],
  teamMembers: SyncTeamMember[],
  preferredLane: (riotIdKey: string) => string | null | undefined = () => null,
): GroupTeamSyncPlan {
  const players = new Map<string, SyncGroupMember>()
  for (const m of groupMembers) {
    if (m.role !== 'player' || !m.riotId) continue
    const key = riotIdKeyOf(m.riotId)
    if (key && !players.has(key)) players.set(key, m)
  }

  const remove: string[] = []
  const kept = new Set<string>()
  const taken = new Set<string>()
  for (const tm of teamMembers) {
    const key = riotIdKey(tm.ign, tm.tagLine)
    if (!key || !players.has(key) || kept.has(key)) { remove.push(tm.id); continue }
    kept.add(key)
    taken.add(tm.role)
  }

  const add: MemberToAdd[] = []
  for (const [key, m] of players) {
    if (kept.has(key)) continue
    const [ign, tagLine] = splitRiotId(m.riotId as string)
    const wanted = preferredLane(key)
    const lane = (LANES as readonly string[]).includes(wanted ?? '') && !taken.has(wanted as string)
      ? wanted as Lane
      : LANES.find((l) => !taken.has(l)) ?? 'TOP'
    taken.add(lane)
    add.push({ displayName: m.displayName || ign, ign, tagLine, role: lane })
  }
  return { add, remove }
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
