import { sb } from './supabase'
import * as riot from './riotWeb'
import { aggregateChampionPlays, winRateOf, kdaOf } from '@/lib/scoutingCore'
import { tierPool } from '@/lib/threatCore'
import { championPlaysRole, type Role } from '@/lib/championRoles'
import { updateRosterMember, upsertPoolEntry, listPoolForMember, removePoolEntry } from '@/lib/teamCore'
import { RIOT_LIMITS } from '@/lib/riotLimits'
import { runScout, toTeamResult, registerScout, releaseScout, assertScoutMemberCount, type ScoutDeps, type ScoutEvent, type ScoutMember, type ScoutTeamResult } from '@/lib/scoutEngine'

/**
 * Web equivalents of team.ipc.ts's `team:scout-member` / `team:auto-fill-pool`
 * (E14) — same tiering (threatCore.tierPool, v2) except the "new" tier,
 * which the shared tables (team_pool_entries.tier) don't accept yet,
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
  const acct = await riot.getAccountByRiotId(member.ign, member.tagLine, region, riot.BACKGROUND)
  await updateRosterMember(sb, member.id, { puuid: acct.puuid })
  return { puuid: acct.puuid, region }
}

/**
 * One member, same shape as before (the single-member screens): runs through the SAME engine as the team scout
 * (scoutTeamWeb), so it has the same pacing, cancel and error classification. A member error is thrown, like the desktop handler does.
 */
export async function scoutMemberWeb(
  member: RosterLike,
  count: number = RIOT_LIMITS.QUICK_SCOUT_MATCH_COUNT,
  opts: { roleOnly?: boolean; scoutId?: string } = {},
): Promise<{ upserted: number; totalMatches: number; sameRoleCount: number }> {
  const r = await scoutTeamWeb([member], { count, roleOnly: opts.roleOnly, scoutId: opts.scoutId })
  const m = r.members[0]
  if (!m?.ok) {
    if (m?.error?.code === 'RIOT_RATE_LIMITED') throw new riot.RiotWebError(m.error.message, 'rate-limited')
    throw new Error(m?.error?.message ?? 'Scout failed')
  }
  return { upserted: m.upserted, totalMatches: m.totalMatches, sameRoleCount: m.sameRoleCount }
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
    riot.getSeasonMatchIds(puuid, region, undefined, riot.BACKGROUND).catch(() => [] as string[]),
    riot.getChampionMasteries(puuid, region, masteryCount, riot.BACKGROUND).catch(() => [] as Array<{ championId: number; championPoints: number }>),
    riot.getChampionIdToKey(),
  ])
  const matchIds = allSeasonIds.slice(0, matchCount)

  const matches = matchIds.length > 0 ? await riot.getMatchesBulk(matchIds, region, undefined, riot.BACKGROUND) : new Map<string, any>()
  const { agg, history } = aggregateChampionPlays(matches, matchIds, puuid, { roleOnly, memberRole: member.role })

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

  const entries = Array.from(agg.values())
  const tiers = tierPool(entries.map((e) => ({
    championKey: e.championKey, role: e.role, games: e.count, winRate: e.count > 0 ? winRateOf(e) : null,
    masteryPoints: e.masteryPoints || null, firstPlayedAt: e.firstAt ?? null, lastPlayedAt: e.lastAt ?? null,
  })), { historyFrom: history.from, historyTo: history.to, allowNew: false })

  let upserted = 0
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    const winRate = entry.count > 0 ? winRateOf(entry) : null
    const kda = entry.count > 0 ? kdaOf(entry) : null
    const masteryPoints = entry.masteryPoints > 0 ? entry.masteryPoints : null
    await upsertPoolEntry(sb, member.id, entry.championKey, entry.role, { tier: tiers[i], playRate: entry.count, winRate, masteryPoints, kda })
    upserted++
  }
  return { upserted, matchesUsed: matchIds.length, masteriesUsed: masteries.length }
}

// ── Progressive team scout (27/11/2026, docs/contracts/scouting-progressive.md) ──────────────────────────────
// Same engine as the desktop (src/lib/scoutEngine.ts): masteries first, one download list for the whole team, most
// recent games first, events to the screen. The browser has no persistent match cache (the proxy's shared store
// answers games anyone already read without touching Riot's budget), so `loadCached` is empty here.

type ScoutListener = (event: ScoutEvent) => void
const scoutListeners = new Set<ScoutListener>()
const activeScouts = new Map<string, { cancelled: boolean }>()
/** A cancel that arrives before the scout is registered (the roster is read first) still stops it, like the desktop's. */
const earlyCancels = new Set<string>()

export function onScoutProgressWeb(cb: ScoutListener): () => void {
  scoutListeners.add(cb)
  return () => { scoutListeners.delete(cb) }
}

export function scoutCancelWeb(scoutId: string): { ok: true; found: boolean } {
  const flag = activeScouts.get(scoutId)
  if (flag) flag.cancelled = true
  else {
    earlyCancels.add(scoutId)
    if (earlyCancels.size > 50) earlyCancels.delete(earlyCancels.values().next().value as string)
  }
  return { ok: true, found: !!flag }
}

export async function scoutTeamWeb(
  rosters: RosterLike[],
  opts: { count?: number; roleOnly?: boolean; scoutId?: string } = {},
): Promise<ScoutTeamResult> {
  const roleOnly = opts.roleOnly ?? false
  const scoutId = opts.scoutId ?? `scout-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  const byId = new Map(rosters.map((r) => [r.id, r]))
  assertScoutMemberCount(rosters.length)
  const flag = registerScout(activeScouts, scoutId, earlyCancels.delete(scoutId))
  const idToKey = await riot.getChampionIdToKey().catch(() => ({}) as Record<number, string>)
  const deps: ScoutDeps = {
    resolveMember: (m) => resolvePuuid(byId.get(m.id)!),
    getMasteries: async (_m, r) => {
      const ms = await riot.getChampionMasteries(r.puuid, r.region, RIOT_LIMITS.MAX_MASTERY_COUNT, riot.BACKGROUND).catch(() => [] as Array<{ championId: number; championPoints: number }>)
      return ms.flatMap((m) => (idToKey[m.championId] ? [{ championKey: idToKey[m.championId], championPoints: m.championPoints }] : []))
    },
    getSeasonIds: (_m, r) => riot.getSeasonMatchIds(r.puuid, r.region, undefined, riot.BACKGROUND),
    loadCached: async () => new Map(),
    fetchMatch: async (id, region) => {
      try { return await riot.getMatch(id, region, riot.BACKGROUND) } catch (err) {
        if ((err as { status?: number })?.status === 404) return null
        throw err
      }
    },
    saveMatch: async () => {},
    async finalizeMember(m, _r, snap) {
      const entries = snap.entries
      if (roleOnly) {
        const newKeys = new Set(entries.map((e) => `${e.championKey}|${e.role}`))
        for (const e of await listPoolForMember(sb, m.id)) {
          if (e.playRate != null && !newKeys.has(`${e.championKey}|${e.role}`)) await removePoolEntry(sb, e.id)
        }
      }
      const tiers = tierPool(entries.map((e) => ({
        championKey: e.championKey, role: e.role, games: e.count, winRate: winRateOf(e),
        masteryPoints: e.masteryPoints || null, firstPlayedAt: e.firstAt ?? null, lastPlayedAt: e.lastAt ?? null,
      })), { historyFrom: snap.history.from, historyTo: snap.history.to, allowNew: false })
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i]
        await upsertPoolEntry(sb, m.id, e.championKey, e.role, {
          tier: tiers[i], playRate: e.count, winRate: winRateOf(e), masteryPoints: e.masteryPoints > 0 ? e.masteryPoints : null, kda: kdaOf(e),
        })
      }
      return entries.length
    },
    emit: (ev) => { for (const l of scoutListeners) { try { l(ev) } catch { /* a listener must not stop the scout */ } } },
    isCancelled: () => flag.cancelled,
  }
  try {
    const members: ScoutMember[] = rosters.map((r) => ({ id: r.id, displayName: r.ign ?? r.id, role: r.role }))
    const result = await runScout(deps, members, {
      scoutId, count: opts.count ?? RIOT_LIMITS.QUICK_SCOUT_MATCH_COUNT, roleOnly,
      concurrency: RIOT_LIMITS.MATCH_FETCH_CONCURRENCY, maxIds: RIOT_LIMITS.MAX_MATCH_IDS_PER_CALL,
      isFatal: (err) => (err as { status?: number })?.status === 401,
    })
    return toTeamResult(result)
  } finally {
    releaseScout(activeScouts, scoutId, flag)
  }
}
