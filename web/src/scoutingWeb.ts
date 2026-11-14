import { sb } from './supabase'
import * as riot from './riotWeb'
import { aggregateChampionPlays, winRateOf, kdaOf } from '@/lib/scoutingCore'
import { computeAutoTier } from '@/lib/threatCore'
import { championPlaysRole, type Role } from '@/lib/championRoles'
import { updateRosterMember, upsertPoolEntry, listPoolForMember, removePoolEntry } from '@/lib/teamCore'
import { RIOT_LIMITS } from '@/lib/riotLimits'

/**
 * Web equivalents of team.ipc.ts's `team:scout-member` / `team:auto-fill-pool`
 * (E14) — same combined-signal tiering (threatCore.computeAutoTier, E12),
 * same role normalization and KDA computation (scoutingCore.ts), fetched
 * through the browser Riot client (riotWeb.ts) instead of the desktop's
 * cached, rate-limited one. See riotWeb.ts for why that's intentionally
 * simpler rather than a 1:1 port.
 */

interface RosterLike {
  id: string
  ign?: string | null
  tagLine?: string | null
  region?: string | null
  puuid?: string | null
  role: string
}

async function resolvePuuid(member: RosterLike): Promise<{ puuid: string; region: string }> {
  const region = member.region
  if (!region) throw new Error('Region missing')
  if (member.puuid) return { puuid: member.puuid, region }
  if (!member.ign || !member.tagLine) throw new Error('Member needs IGN + tagLine + region to be scouted')
  const acct = await riot.getAccountByRiotId(member.ign, member.tagLine, region)
  await updateRosterMember(sb, member.id, { puuid: acct.puuid })
  return { puuid: acct.puuid, region }
}

export async function scoutMemberWeb(
  member: RosterLike,
  count: number = RIOT_LIMITS.QUICK_SCOUT_MATCH_COUNT,
  opts: { roleOnly?: boolean } = {},
): Promise<{ upserted: number; totalMatches: number; sameRoleCount: number }> {
  const roleOnly = opts.roleOnly ?? false
  const { puuid, region } = await resolvePuuid(member)

  const noCap = !Number.isFinite(count) || count <= 0 || count > RIOT_LIMITS.MAX_MATCH_IDS_PER_CALL
  const allSeasonIds = await riot.getSeasonMatchIds(puuid, region)
  const matchIds = noCap ? allSeasonIds : allSeasonIds.slice(0, Math.max(1, count))
  if (matchIds.length === 0) return { upserted: 0, totalMatches: 0, sameRoleCount: 0 }

  const [matches, idToKey, masteries] = await Promise.all([
    riot.getMatchesBulk(matchIds, region),
    riot.getChampionIdToKey().catch(() => ({}) as Record<number, string>),
    riot.getChampionMasteries(puuid, region, RIOT_LIMITS.MAX_MASTERY_COUNT).catch(() => [] as Array<{ championId: number; championPoints: number }>),
  ])
  const masteryByKey = new Map<string, number>()
  for (const m of masteries) {
    const key = idToKey[m.championId]
    if (key) masteryByKey.set(key, m.championPoints)
  }

  const { agg, sameRoleCount } = aggregateChampionPlays(matches, matchIds, puuid, { roleOnly, memberRole: member.role })

  // Cleanup: drop previously auto-scouted entries no longer in the fresh
  // scan, same intent as the desktop handler — keeps the pool tight to the
  // member's current meta. Manual entries (playRate=null) are preserved.
  if (roleOnly) {
    const newKeys = new Set(Array.from(agg.values()).map((e) => `${e.championKey}|${e.role}`))
    const existing = await listPoolForMember(sb, member.id)
    for (const e of existing) {
      if (e.playRate == null) continue
      if (!newKeys.has(`${e.championKey}|${e.role}`)) await removePoolEntry(sb, e.id)
    }
  }

  let upserted = 0
  for (const entry of agg.values()) {
    const winRate = winRateOf(entry)
    const masteryPoints = masteryByKey.get(entry.championKey) ?? null
    const kda = kdaOf(entry)
    const tier = computeAutoTier({ games: entry.count, masteryPoints, winRate, isTop5InRole: false })
    await upsertPoolEntry(sb, member.id, entry.championKey, entry.role, { tier, playRate: entry.count, winRate, masteryPoints, kda })
    upserted++
  }
  return { upserted, totalMatches: matchIds.length, sameRoleCount }
}

export async function autoFillPoolWeb(
  member: RosterLike,
  opts: { matchCount?: number; masteryCount?: number; roleOnly?: boolean } = {},
): Promise<{ upserted: number; matchesUsed: number; masteriesUsed: number }> {
  const roleOnly = opts.roleOnly ?? true
  const rawMatchCount = opts.matchCount ?? RIOT_LIMITS.QUICK_SCOUT_MATCH_COUNT
  const matchCountNoCap = !Number.isFinite(rawMatchCount) || rawMatchCount <= 0 || rawMatchCount > RIOT_LIMITS.MAX_MATCH_IDS_PER_CALL
  const matchCount = matchCountNoCap ? RIOT_LIMITS.MAX_MATCH_IDS_PER_CALL : Math.max(1, Math.min(rawMatchCount, RIOT_LIMITS.MAX_MATCH_IDS_PER_CALL))
  const masteryCount = Math.min(opts.masteryCount ?? RIOT_LIMITS.DEFAULT_MASTERY_COUNT, RIOT_LIMITS.MAX_MASTERY_COUNT)

  const { puuid, region } = await resolvePuuid(member)
  const primaryRole = (member.role || 'MID').toUpperCase() as Role

  const [allSeasonIds, masteries, idToKey] = await Promise.all([
    riot.getSeasonMatchIds(puuid, region).catch(() => [] as string[]),
    riot.getChampionMasteries(puuid, region, masteryCount).catch(() => [] as Array<{ championId: number; championPoints: number }>),
    riot.getChampionIdToKey(),
  ])
  const matchIds = allSeasonIds.slice(0, matchCount)

  const matches = matchIds.length > 0 ? await riot.getMatchesBulk(matchIds, region) : new Map<string, any>()
  const { agg } = aggregateChampionPlays(matches, matchIds, puuid, { roleOnly, memberRole: member.role })

  // Mastery-only champions: attach to every role already played this
  // season, or seed a new entry in the primary role when the champion
  // plausibly belongs there (same guard as desktop — a JG main's old ADC
  // mastery shouldn't pollute their current in-role pool).
  for (const m of masteries) {
    const championKey = idToKey[m.championId]
    if (!championKey) continue
    const candidates = Array.from(agg.values()).filter((e) => e.championKey === championKey)
    if (candidates.length > 0) {
      for (const c of candidates) c.masteryPoints = Math.max(c.masteryPoints, m.championPoints)
    } else if (!roleOnly || championPlaysRole(championKey, primaryRole)) {
      agg.set(`${championKey}|${primaryRole}`, {
        championKey, role: primaryRole, count: 0, wins: 0, kills: 0, deaths: 0, assists: 0, masteryPoints: m.championPoints,
      })
    }
  }

  if (agg.size === 0) return { upserted: 0, matchesUsed: matchIds.length, masteriesUsed: masteries.length }

  if (roleOnly) {
    const computed = new Set(Array.from(agg.values()).map((e) => `${e.championKey}|${e.role}`))
    const existing = await listPoolForMember(sb, member.id)
    for (const e of existing) {
      if (e.playRate == null) continue
      if (e.role === primaryRole && !computed.has(`${e.championKey}|${e.role}`)) await removePoolEntry(sb, e.id)
    }
  }

  const top5InRole = new Set(
    Array.from(agg.values())
      .filter((e) => e.role === primaryRole && e.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
      .map((e) => e.championKey),
  )

  let upserted = 0
  for (const entry of agg.values()) {
    const winRate = entry.count > 0 ? winRateOf(entry) : null
    const kda = entry.count > 0 ? kdaOf(entry) : null
    const tier = computeAutoTier({ games: entry.count, masteryPoints: entry.masteryPoints || null, winRate, isTop5InRole: top5InRole.has(entry.championKey) })
    const masteryPoints = entry.masteryPoints > 0 ? entry.masteryPoints : null
    await upsertPoolEntry(sb, member.id, entry.championKey, entry.role, { tier, playRate: entry.count, winRate, masteryPoints, kda })
    upserted++
  }
  return { upserted, matchesUsed: matchIds.length, masteriesUsed: masteries.length }
}
