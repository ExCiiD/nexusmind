import { getPrisma } from '../database'
import { getSupabase, getSessionUserId } from './supabase'
import { getSharedTeam, publishMyPool } from '../../../src/lib/teamCore'
import { planPoolImport, type PublishedPlayer } from '../../../src/lib/poolImportCore'

/**
 * #46 point 1: a teammate's champion pool already published in the group (team_pool_entries) fills the EMPTY local
 * pools of this computer's copy of the team, instead of every teammate's app fetching the same player from Riot
 * again (src/lib/poolImportCore.ts). Called from team:list for the group's own team. Best effort, at most once a
 * minute per group: signed out, offline or without a published pool, the local pools stay as they are.
 *
 * And the other way: after a player fills their OWN pool on this computer, it is published on their roster row
 * (the RLS lets a player write the pool of the row linked to their account, #46 point 4 links the rows), so their
 * teammates get it without fetching.
 */

const THROTTLE_MS = 60_000
const lastRun = new Map<string, number>()
const inFlight = new Map<string, Promise<boolean>>()

/** True when it filled at least one local pool. */
export function importGroupPools(groupId: string, teamId: string): Promise<boolean> {
  const running = inFlight.get(groupId)
  if (running) return running
  if (Date.now() - (lastRun.get(groupId) ?? 0) < THROTTLE_MS) return Promise.resolve(false)
  const run = doImport(groupId, teamId)
    .catch((err) => { console.warn('[pools] import skipped:', (err as Error)?.message); return false })
    .finally(() => { inFlight.delete(groupId); lastRun.set(groupId, Date.now()) })
  inFlight.set(groupId, run)
  return run
}

async function doImport(groupId: string, teamId: string): Promise<boolean> {
  if (!(await getSessionUserId())) return false
  const prisma = getPrisma()
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { members: { select: { id: true, ign: true, tagLine: true, puuid: true, _count: { select: { champPool: true } } } } },
  })
  if (!team || !team.members.some((m) => m._count.champPool === 0)) return false

  const shared = await getSharedTeam(getSupabase(), groupId, { pools: true, drafts: false })
  const published: PublishedPlayer[] = shared.roster.map((r) => ({
    ign: r.ign, tagLine: r.tagLine, puuid: r.puuid,
    pool: r.pool.map((p) => ({ championKey: p.championKey, role: p.role, tier: p.tier, notes: p.notes, playRate: p.playRate, winRate: p.winRate, masteryPoints: p.masteryPoints, kda: p.kda })),
  }))
  const plan = planPoolImport(team.members.map((m) => ({ id: m.id, ign: m.ign, tagLine: m.tagLine, puuid: m.puuid, poolSize: m._count.champPool })), published)
  let filled = false
  for (const { memberId, entries } of plan) {
    // Still empty right now (a fetch may have filled it meanwhile): never overwrite a local pool.
    if (await prisma.championPoolEntry.count({ where: { memberId } }) > 0) continue
    await prisma.championPoolEntry.createMany({
      data: entries.map((e) => ({
        memberId, championKey: e.championKey, role: e.role, tier: e.tier ?? 'comfort', notes: e.notes,
        playRate: e.playRate, winRate: e.winRate, masteryPoints: e.masteryPoints, kda: e.kda,
      })),
    })
    filled = true
  }
  if (filled) console.log(`[pools] ${plan.length} pool(s) taken from the group's published team instead of Riot`)
  return filled
}

/**
 * After this computer filled a member's pool: when that member is the signed-in player and the team is a group's,
 * their pool is published on their linked roster row. Best effort (no linked row yet, offline: nothing).
 */
export async function publishOwnPoolIfMine(memberId: string): Promise<void> {
  try {
    const uid = await getSessionUserId()
    if (!uid) return
    const prisma = getPrisma()
    const member = await prisma.teamMember.findUnique({ where: { id: memberId }, include: { team: true, champPool: true } })
    const user = await prisma.user.findFirst({ where: { isActive: true } })
    if (!member?.team.groupId || member.team.isOpponent || !member.puuid || member.puuid !== user?.puuid) return
    const done = await publishMyPool(getSupabase(), member.team.groupId, uid, member.champPool.map((p) => ({
      championKey: p.championKey, role: p.role, tier: p.tier, notes: p.notes, playRate: p.playRate, winRate: p.winRate, masteryPoints: p.masteryPoints, kda: p.kda,
    })))
    if (done) console.log('[pools] own pool published for the group')
  } catch (err) {
    console.warn('[pools] own pool not published:', (err as Error)?.message)
  }
}
