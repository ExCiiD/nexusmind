import { getSupabase, requireSessionUserId } from './supabase'
import { getPrisma } from '../database'
import * as core from '../../../src/lib/teamCore'
import type { PublishTeamInput, TeamRole } from '../../../src/lib/team'
import { tierPool } from '../../../src/lib/threatCore'

/**
 * Desktop entry points for E1 (shared team workspace). Reads the local
 * Prisma data (Team/TeamMember/ChampionPoolEntry/DraftPrep) and hands a
 * snapshot to teamCore.ts, same split as collab.ts/collabCore.ts.
 */

async function me(): Promise<string> {
  // Local session, no server round trip (supabase.ts getSessionUserId).
  return requireSessionUserId()
}

const isTeamRole = (r: string): r is TeamRole => ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'].includes(r)

type SharedTier = PublishTeamInput['roster'][number]['pool'][number]['tier']
const SHARED_TIERS: readonly string[] = ['main', 'comfort', 'flex', 'learning']

interface SharedPoolSource {
  championKey: string; role: string; tier: string | null; notes: string | null
  playRate: number | null; winRate: number | null; masteryPoints: number | null; kda: number | null
  firstPlayedAt: Date | null; lastPlayedAt: Date | null
}

/**
 * The tiers a member's pool is published with. The shared tables have no
 * "new" tier yet (team_pool_entries.tier only accepts main / comfort / flex
 * / learning), so a new pick travels with the tier the rule gives it
 * without the "new" step (tierPool, allowNew: false); a hand-made "new"
 * entry without games goes as flex.
 */
function cloudTiers(pool: SharedPoolSource[]): SharedTier[] {
  const fallback = tierPool(pool.map((p) => ({
    championKey: p.championKey,
    role: p.role,
    games: p.playRate ?? 0,
    winRate: p.winRate,
    masteryPoints: p.masteryPoints,
    firstPlayedAt: p.firstPlayedAt?.getTime() ?? null,
    lastPlayedAt: p.lastPlayedAt?.getTime() ?? null,
  })), { allowNew: false })
  return pool.map((p, i) => {
    if (p.tier && SHARED_TIERS.includes(p.tier)) return p.tier as SharedTier
    if (p.tier === 'new') return ((p.playRate ?? 0) > 0 ? fallback[i] : 'flex') as SharedTier
    return 'comfort'
  })
}

export async function publishTeamToGroup(groupId: string, teamId: string): Promise<{ published: number }> {
  await me()
  const prisma = getPrisma()

  const team = await prisma.team.findUnique({ where: { id: teamId }, include: { members: { include: { champPool: true } } } })
  if (!team) throw new Error('TEAM_NOT_FOUND')

  const activeUser = await prisma.user.findFirst({ where: { isActive: true } })
  const draftRows = activeUser
    ? await prisma.draftPrep.findMany({ where: { userId: activeUser.id } })
    : []
  // Full opponent rosters + pools now travel with the publish (E14) — until
  // now only name/tag/notes were sent, so scouting looked empty on the web.
  const opponentTeams = await prisma.team.findMany({
    where: { isOpponent: true, userId: team.userId },
    include: { members: { include: { champPool: true } } },
  })

  const toSharedMember = (m: { displayName: string; ign: string | null; tagLine: string | null; region: string | null; role: string; puuid: string | null; champPool: SharedPoolSource[] }) => {
    const pool = m.champPool.filter((p) => isTeamRole(p.role))
    const tiers = cloudTiers(pool)
    return {
      displayName: m.displayName, ign: m.ign, tagLine: m.tagLine, region: m.region,
      role: m.role as TeamRole, puuid: m.puuid,
      pool: pool.map((p, i) => ({
        championKey: p.championKey, role: p.role as TeamRole,
        tier: tiers[i],
        notes: p.notes, playRate: p.playRate, winRate: p.winRate, masteryPoints: p.masteryPoints, kda: p.kda,
      })),
    }
  }

  const input: PublishTeamInput = {
    roster: team.members.filter((m) => isTeamRole(m.role)).map(toSharedMember),
    // vs_scouting_id is left unset here — resolving it to a scouting row
    // created in the same publish would need two round trips; deferred.
    drafts: draftRows.map((d) => ({
      name: d.name,
      bluePicks: safeJsonArray(d.bluePicks), blueBans: safeJsonArray(d.blueBans),
      redPicks: safeJsonArray(d.redPicks), redBans: safeJsonArray(d.redBans),
      myTeamSide: d.myTeamSide === 'red' ? 'red' : 'blue',
      notes: d.notes,
    })),
    scouting: opponentTeams.map((t) => ({
      name: t.name, tag: t.tag, scoutNotes: t.scoutNotes,
      roster: t.members.filter((m) => isTeamRole(m.role)).map(toSharedMember),
    })),
  }

  return core.publishTeam(getSupabase(), groupId, input)
}

export const getSharedTeam = (groupId: string) => core.getSharedTeam(getSupabase(), groupId)

function safeJsonArray(raw: string): string[] {
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [] } catch { return [] }
}
