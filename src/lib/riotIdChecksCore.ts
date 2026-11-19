import type { GroupMember } from './collab'

/**
 * #38: what the staff must see from the server's check of the members' Riot IDs (group_members.puuid_status).
 * - conflict: two members (or more) claim the same Riot player: grouped by puuid, the member already holding it
 *   included, so the owner sees both and removes the wrong one;
 * - not_found: the Riot ID does not exist at Riot.
 * 'verified' and null show nothing; the field is absent before the production migration (nothing either). Pure, tested.
 */
export function riotIdIssues(members: GroupMember[]): { conflicts: GroupMember[][]; notFound: GroupMember[] } {
  const conflicts: GroupMember[][] = []
  const seen = new Set<string>()
  for (const m of members) {
    if (m.puuidStatus !== 'conflict' || seen.has(m.userId)) continue
    const same = m.puuid ? members.filter((o) => o.puuid === m.puuid) : [m]
    for (const o of same) seen.add(o.userId)
    conflicts.push(same)
  }
  const notFound = members.filter((m) => m.puuidStatus === 'not_found')
  return { conflicts, notFound }
}
