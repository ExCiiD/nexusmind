import { getSupabase, getAccessToken } from './supabase'
import { getPrisma } from '../database'
import * as core from '../../../src/lib/teamCore'
import type { PublishTeamInput, TeamRole } from '../../../src/lib/team'

/**
 * Desktop entry points for E1 (shared team workspace). Reads the local
 * Prisma data (Team/TeamMember/ChampionPoolEntry/DraftPrep) and hands a
 * snapshot to teamCore.ts, same split as collab.ts/collabCore.ts.
 */

async function me(): Promise<string> {
  const token = await getAccessToken()
  if (!token) throw new Error('LOGIN_REQUIRED')
  const { data } = await getSupabase().auth.getUser(token)
  if (!data.user) throw new Error('LOGIN_REQUIRED')
  return data.user.id
}

const isTeamRole = (r: string): r is TeamRole => ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'].includes(r)

export async function publishTeamToGroup(groupId: string, teamId: string): Promise<{ published: number }> {
  await me()
  const prisma = getPrisma()

  const team = await prisma.team.findUnique({ where: { id: teamId }, include: { members: { include: { champPool: true } } } })
  if (!team) throw new Error('TEAM_NOT_FOUND')

  const activeUser = await prisma.user.findFirst({ where: { isActive: true } })
  const draftRows = activeUser
    ? await prisma.draftPrep.findMany({ where: { userId: activeUser.id } })
    : []
  const opponentTeams = await prisma.team.findMany({ where: { isOpponent: true, userId: team.userId } })

  const input: PublishTeamInput = {
    roster: team.members
      .filter((m) => isTeamRole(m.role))
      .map((m) => ({
        displayName: m.displayName, ign: m.ign, tagLine: m.tagLine, region: m.region,
        role: m.role as TeamRole, puuid: m.puuid,
        pool: m.champPool
          .filter((p) => isTeamRole(p.role))
          .map((p) => ({
            championKey: p.championKey, role: p.role as TeamRole,
            tier: (p.tier as PublishTeamInput['roster'][number]['pool'][number]['tier']) ?? 'comfort',
            notes: p.notes, playRate: p.playRate, winRate: p.winRate, masteryPoints: p.masteryPoints,
          })),
      })),
    // vs_scouting_id is left unset here — resolving it to a scouting row
    // created in the same publish would need two round trips; deferred.
    drafts: draftRows.map((d) => ({
      name: d.name,
      bluePicks: safeJsonArray(d.bluePicks), blueBans: safeJsonArray(d.blueBans),
      redPicks: safeJsonArray(d.redPicks), redBans: safeJsonArray(d.redBans),
      myTeamSide: d.myTeamSide === 'red' ? 'red' : 'blue',
      notes: d.notes,
    })),
    scouting: opponentTeams.map((t) => ({ name: t.name, tag: t.tag, scoutNotes: t.scoutNotes })),
  }

  return core.publishTeam(getSupabase(), groupId, input)
}

export const getSharedTeam = (groupId: string) => core.getSharedTeam(getSupabase(), groupId)

function safeJsonArray(raw: string): string[] {
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [] } catch { return [] }
}
