/**
 * Which side of a match is "ours", from the group's Riot IDs. Pure, without dependencies, so the main process can
 * import it (teamSessionStatsCore.ts, where it lived, imports renderer types). teamSessionStatsCore re-exports it.
 */

/** The fields of a match-v5 participant read here. */
export interface SideParticipant {
  teamId: number
  riotIdGameName?: string
  summonerName?: string
}

export function participantName(p: SideParticipant): string {
  return p.riotIdGameName || p.summonerName || 'Unknown'
}

export const normName = (s: string) => s.trim().toLowerCase()

/**
 * Which of the two Riot `teamId`s (100/200) is "ours", based on how many
 * participants' in-game names match one of the group's stored Riot IDs
 * (the `GameName` part, before the `#tag` — group members have no cached
 * puuid, unlike the local roster `aggregateMatchLike` matches in
 * team.ipc.ts). Returns null when neither side has any match — e.g. the
 * group's Riot IDs aren't filled in yet — so the caller can fall back to
 * showing both sides unlabeled rather than guessing.
 */
export function resolveOurTeamId(participants: SideParticipant[], memberRiotIds: string[]): 100 | 200 | null {
  const names = new Set(memberRiotIds.filter(Boolean).map((id) => normName(id.split('#')[0])))
  const score: Record<100 | 200, number> = { 100: 0, 200: 0 }
  for (const p of participants) {
    if (p.teamId !== 100 && p.teamId !== 200) continue
    if (names.has(normName(participantName(p)))) score[p.teamId as 100 | 200]++
  }
  if (score[100] === 0 && score[200] === 0) return null
  return score[100] >= score[200] ? 100 : 200
}
