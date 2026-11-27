/**
 * Team management IPC: rosters, champion pools, draft prep, opponent scouting.
 *
 * All operations are scoped to the currently-active user. Storage is local
 * SQLite via Prisma. Future cloud sync would migrate the underlying store
 * but keep this IPC surface stable.
 */

import { ipcMain, dialog, BrowserWindow } from 'electron'
import { inBackground, withRiotPriority } from '../riotPriority'
import { readFileSync, existsSync } from 'node:fs'
import { basename } from 'node:path'
import { getPrisma } from '../database'
import { getMatchIds, getMatch, getAccountByRiotId, getChampionMasteries, getSeasonMatchIds, RiotNotFoundError } from '../riotClient'
import { RiotAuthError } from '../riotTransport'
import { runScout, toTeamResult, registerScout, releaseScout, MAX_SCOUT_MEMBERS, type ScoutDeps, type ScoutMember, type ScoutResult } from '../../../src/lib/scoutEngine'
import { getChampionIdToKey } from '../dataDragon'
import { championPlaysRole, type Role } from '../../../src/lib/championRoles'
import { tierPool, NEW_PICK_DAYS } from '../../../src/lib/threatCore'
import { normalizeSlots, groupDuplicates, normalizeRole } from '../../../src/lib/teamIdentity'
import {
  matchStartOf, mergeMatchIdsByRecency, teamListWhere, teamLinkReleaseWhere,
  aggregateMatchLike, matchLikeFromRiot, matchLikeFromCustom, indexMatchIds, sharedMatchIds, matchIdsByRegion, combinedSources,
} from '../../../src/lib/scoutingCore'
import { RIOT_LIMITS } from '../../../src/lib/riotLimits'
import { refreshTeamMemberRiotIds } from '../teamMemberRefresh'
import { getSupabase, isCloudConfigured, getSessionUserId } from '../cloud/supabase'
import * as customGamesCore from '../../../src/lib/teamCustomGamesCore'
import { importGroupOpponents, rememberDismissedOpponent } from '../cloud/opponentImport'
import { importGroupPools, publishOwnPoolIfMine } from '../cloud/poolImport'
import { z } from 'zod'
import { validatedHandle, id as idSchema, shortText } from './validate'

/** Games per member of a scout: -1 / 0 = the whole season, else a count (RIOT_LIMITS.MAX_MATCH_IDS_PER_CALL at most). */
const scoutCountSchema = z.number().int().min(-1).max(RIOT_LIMITS.MAX_MATCH_IDS_PER_CALL)

/** Cloud group ids (uuid). */
const groupIdSchema = z.string().uuid()

const teamListOpts = z.object({
  isOpponent: z.boolean().optional(),
  groupId: groupIdSchema.optional(),
  includeUnassigned: z.boolean().optional(),
}).strict()

const teamMemberPatch = z.object({
  displayName: z.string().trim().min(1).max(64),
  ign: shortText(64).nullable(),
  tagLine: shortText(16).nullable(),
  region: shortText(8).nullable(),
  role: shortText(16),
  puuid: z.string().regex(/^[A-Za-z0-9_-]{20,100}$/).nullable(),
  // #38: set by a group-sync rename, cleared (null) once the staff saw it.
  previousRiotId: shortText(100).nullable(),
}).partial().strict()

const teamCreateInput = z.object({
  name: z.string().trim().min(1).max(100),
  tag: shortText(16).optional(),
  logo: shortText(200_000).optional(),
  notes: shortText(10_000).optional(),
  isOpponent: z.boolean().optional(),
  /** #7: the group an opponent is scouted for (own teams use team:link-group). */
  groupId: groupIdSchema.optional(),
}).strict()

async function getActiveUser() {
  const prisma = getPrisma()
  const user = await prisma.user.findFirst({ where: { isActive: true } })
  if (!user) throw new Error('No active user')
  return user
}

/**
 * Bulk match fetcher with persistent MatchCache + bounded concurrency.
 *
 * The naive `Promise.all(matchIds.map(getMatch))` over a season's worth
 * of games means 300-800 parallel Riot calls per player — every request
 * goes through the rate limiter so the user waits 30-60s per scout, with
 * 100% of that cost paid AGAIN on the next scout (no cross-session reuse).
 *
 * This helper:
 *   1. Reads any matches we already have in `MatchCache.matchJson` in a
 *      single DB query (free, microseconds).
 *   2. Fetches only the missing IDs from Riot, in batches of 8 (keeps the
 *      rate limiter happy while staying ~8x faster than serial fetch).
 *   3. Upserts new matches into `MatchCache` so subsequent scouts of the
 *      same player (or any roster member who shared a flex game) are
 *      instant.
 *
 * Returns a Map<matchId, parsed match-V5 object>. Missing IDs (failed
 * fetch + not cached) are simply absent from the map — callers should
 * treat that as "skip this match".
 */
/** Games being downloaded right now (key region:matchId), shared by the scouts that run at the same time. */
const inFlightMatches = new Map<string, Promise<any>>()

/** Games Riot does not have (404), remembered for a few hours so a repeat scout does not ask again. */
const missingMatches = new Map<string, { firstAt: number; checkedAt: number }>()
const MISSING_TTL_MS = 6 * 3_600_000
/** A game that just ended can 404 for a while (Riot's delay): it is asked again until a check made at least this long after the first 404 still finds it missing. */
const MISSING_SETTLE_MS = 30 * 60_000
const MISSING_MAX_ENTRIES = 5_000

/**
 * One game from Riot, shared with the scouts running at the same time (same in-flight map as getMatchesBulkCached).
 * null = Riot does not have it. Throws on any other failure.
 */
async function fetchMatchShared(id: string, region: string): Promise<any | null> {
  const missed = missingMatches.get(id)
  if (missed && missed.checkedAt - missed.firstAt >= MISSING_SETTLE_MS && Date.now() - missed.checkedAt < MISSING_TTL_MS) return null
  const flightKey = `${region}:${id}`
  let flight = inFlightMatches.get(flightKey)
  if (!flight) {
    flight = getMatch(id, region)
    inFlightMatches.set(flightKey, flight)
    const clear = () => { inFlightMatches.delete(flightKey) }
    flight.then(clear, clear)
  }
  try {
    const match = await flight
    missingMatches.delete(id) // it exists after all (Riot's delay): forget the 404
    return match
  } catch (err) {
    if (err instanceof RiotNotFoundError) {
      const now = Date.now()
      missingMatches.delete(id) // re-inserted last: the oldest entries are the first to go
      missingMatches.set(id, { firstAt: missed?.firstAt ?? now, checkedAt: now })
      if (missingMatches.size > MISSING_MAX_ENTRIES) missingMatches.delete(missingMatches.keys().next().value as string)
      return null
    }
    throw err
  }
}

async function getMatchesBulkCached(
  matchIds: string[],
  region: string,
  // The rate limiter (MultiWindowLimiter in riotClient.ts) is the real
  // bottleneck here — it serializes acquire() calls so the actual
  // request throughput is bound by `min(app-tier, method-tier)`. For a
  // Personal key that's 100/120s = ~0.83 req/s sustained; for a
  // Production key it auto-tunes to ~150 req/s from response headers.
  //
  // Concurrency here just controls how many requests we queue up behind
  // the limiter. 10 is enough to:
  //   - keep the burst-window fully utilized (20/s) when budget is fresh
  //   - never overwhelm the Undici connection pool (50 conn max)
  //   - keep the SQLite upsert queue bounded so other IPC handlers stay
  //     responsive while a long scout runs
  // Bumping this number above 10 doesn't make scouts any faster on a
  // Personal key (it's already gated by the long-window 100/120s rule)
  // and just risks more 429s if the limiter has a bug.
  concurrency = RIOT_LIMITS.MATCH_FETCH_CONCURRENCY,
): Promise<Map<string, any>> {
  if (matchIds.length === 0) return new Map()
  const prisma = getPrisma()
  const cached = await prisma.matchCache.findMany({
    where: { matchId: { in: matchIds } },
    select: { matchId: true, matchJson: true },
  })
  const out = new Map<string, any>()
  for (const row of cached) {
    try {
      out.set(row.matchId, JSON.parse(row.matchJson))
    } catch {
      // Corrupt cache row — treat as miss, the fetch loop below will refresh it
    }
  }
  const missing = matchIds.filter((id) => !out.has(id))
  if (missing.length === 0) return out

  let cursor = 0
  const worker = async () => {
    while (true) {
      const i = cursor++
      if (i >= missing.length) break
      const id = missing[i]
      try {
        // L5 (26/11/2026): scouts of several opponents run side by side and share games (a flex or scrim lobby). A
        // game being downloaded by one scout is awaited by the others instead of being asked of Riot again.
        const flightKey = `${region}:${id}`
        let flight = inFlightMatches.get(flightKey)
        const owner = !flight
        if (!flight) {
          flight = getMatch(id, region)
          inFlightMatches.set(flightKey, flight)
          flight.then(() => inFlightMatches.delete(flightKey), () => inFlightMatches.delete(flightKey))
        }
        const match = await flight
        out.set(id, match)
        if (!owner) continue // the scout that downloaded it writes the cache row
        // AWAIT the upsert (was fire-and-forget). Without await, 1500
        // simultaneous SQLite writes from a 5-player auto-fill pile up,
        // starving every other IPC handler (listChampionPool,
        // listTeams, …). SQLite serializes writes anyway, so awaiting
        // doesn't slow us down — it just keeps the queue bounded so
        // the rest of the renderer stays responsive while a long scout
        // runs. Failures are non-fatal — match is already in out map.
        try {
          await prisma.matchCache.upsert({
            where: { matchId: id },
            create: { matchId: id, matchJson: JSON.stringify(match) },
            update: { matchJson: JSON.stringify(match) },
          })
        } catch (dbErr) {
          console.warn('[getMatchesBulkCached] cache write failed for', id, (dbErr as Error)?.message)
        }
      } catch (err) {
        // Riot can 404 old/deleted matches or temp-fail on outages.
        // Silently skip so a single bad ID doesn't kill the whole scout.
        console.warn('[getMatchesBulkCached] fetch failed for', id, (err as Error)?.message)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, missing.length) }, () => worker()))
  return out
}

function safeIdArray(raw: string | null): string[] {
  if (!raw) return []
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

/**
 * E15: the incrementally-updated equivalent of `getSeasonMatchIds` — the
 * full season list is still what gets returned (tiering stays a full-
 * season re-walk, same math as before), but a repeat scout only has to
 * ask Riot for games played after the member's last scout instead of
 * re-listing the whole season (up to ~25 paginated calls; most repeats
 * find 0-5 new games). `forceFull` (the "Complete" scope option) always
 * relists from scratch — that mode's whole point is a thorough, from-
 * scratch rescan, not a trust-the-cache shortcut.
 *
 * Callers must persist the result via `saveScoutCache` once they've
 * finished using the ids (not here — some callers filter/slice first).
 */
async function getSeasonMatchIdsIncremental(
  member: { lastScoutedAt: Date | null; seasonMatchIdsJson: string | null },
  puuid: string,
  region: string,
  forceFull: boolean,
): Promise<string[]> {
  if (forceFull || !member.lastScoutedAt) {
    return getSeasonMatchIds(puuid, region)
  }
  const newIds = await getSeasonMatchIds(puuid, region, member.lastScoutedAt)
  const previousIds = safeIdArray(member.seasonMatchIdsJson)
  return mergeMatchIdsByRecency(newIds, previousIds)
}

async function saveScoutCache(memberId: string, matchIds: string[]): Promise<void> {
  try {
    const prisma = getPrisma()
    await prisma.teamMember.update({
      where: { id: memberId },
      data: { lastScoutedAt: new Date(), seasonMatchIdsJson: JSON.stringify(matchIds) },
    })
  } catch (err) {
    console.warn('[team] failed to save scout cache for', memberId, (err as Error)?.message)
  }
}

/**
 * Find an existing member in `teamId` that matches the candidate's Riot
 * identity. Used by `team:add-member` to make adds idempotent.
 */
async function findExistingMember(teamId: string, data: { puuid?: string; ign?: string; tagLine?: string; displayName?: string }) {
  const prisma = getPrisma()
  // Fast path: puuid lookup directly via DB filter.
  if (data.puuid) {
    const byPuuid = await prisma.teamMember.findFirst({ where: { teamId, puuid: data.puuid } })
    if (byPuuid) return byPuuid
  }
  // Slow path: pull the full team once and try progressive matches.
  // SQLite is case-insensitive for ASCII by default but we lower-case
  // explicitly so this stays correct across DB engines.
  const all = await prisma.teamMember.findMany({ where: { teamId } })
  const norm = (s?: string | null) => (s ?? '').toLowerCase().trim()
  if (data.ign && data.tagLine) {
    const match = all.find((m) => norm(m.ign) === norm(data.ign) && norm(m.tagLine) === norm(data.tagLine))
    if (match) return match
  }
  if (data.ign) {
    // Same IGN but possibly missing tag on one side → still a dupe.
    const match = all.find((m) => m.ign && norm(m.ign) === norm(data.ign))
    if (match) return match
  }
  if (data.displayName) {
    // Last resort: exact displayName match. Mainly catches manual re-entry
    // of the same player with no Riot ID information at all.
    const match = all.find((m) => norm(m.displayName) === norm(data.displayName))
    if (match) return match
  }
  return null
}

// ── Champion pool tiering (v2, src/lib/threatCore.ts) ──────────────────────

/** Widens a [from, to] range with one game time. */
function stretch(range: { from: number | null; to: number | null }, t: number | null): void {
  if (t == null) return
  if (range.from == null || t < range.from) range.from = t
  if (range.to == null || t > range.to) range.to = t
}

/** Per-(champion, role) plays gathered by scouting or auto-fill. */
interface PoolAgg {
  championKey: string
  role: string
  count: number
  wins: number
  kills: number
  deaths: number
  assists: number
  /** Lifetime mastery; 0 or null when unknown. */
  masteryPoints: number | null
  /** First and last analysed game on this champion in this role (ms). */
  firstAt: number | null
  lastAt: number | null
}

function addPlay(agg: PoolAgg, participant: any, at: number | null): void {
  agg.count++
  if (participant.win) agg.wins++
  agg.kills += participant.kills ?? 0
  agg.deaths += participant.deaths ?? 0
  agg.assists += participant.assists ?? 0
  if (at != null) {
    agg.firstAt = agg.firstAt == null ? at : Math.min(agg.firstAt, at)
    agg.lastAt = agg.lastAt == null ? at : Math.max(agg.lastAt, at)
  }
}

/**
 * Tiers a member's freshly gathered pool with the shared rule (tierPool:
 * rank and share per role, recency, the "new" tier) and writes it. A tier
 * the user picked by hand (tier ≠ autoTier) stays unless `forceTiers`;
 * autoTier always records what the rule says, so later refreshes can tell
 * the two apart. `history` is the span of every analysed game, any role.
 */
async function writeTieredPool(
  memberId: string,
  entries: PoolAgg[],
  history: { from: number | null; to: number | null },
  forceTiers = false,
): Promise<number> {
  const prisma = getPrisma()
  const winRateOf = (e: PoolAgg) => (e.count > 0 ? Math.round((e.wins / e.count) * 100) : null)
  const tiers = tierPool(
    entries.map((e) => ({
      championKey: e.championKey,
      role: e.role,
      games: e.count,
      winRate: winRateOf(e),
      masteryPoints: e.masteryPoints || null,
      firstPlayedAt: e.firstAt,
      lastPlayedAt: e.lastAt,
    })),
    { historyFrom: history.from, historyTo: history.to },
  )
  let upserted = 0
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    const tier = tiers[i]
    const winRate = winRateOf(e)
    const masteryPoints = e.masteryPoints && e.masteryPoints > 0 ? e.masteryPoints : null
    const kda = e.count > 0 ? (e.kills + e.assists) / Math.max(1, e.deaths) : null
    const firstPlayedAt = e.firstAt != null ? new Date(e.firstAt) : null
    const lastPlayedAt = e.lastAt != null ? new Date(e.lastAt) : null
    const where = { memberId_championKey_role: { memberId, championKey: e.championKey, role: e.role } }
    const existing = await prisma.championPoolEntry.findUnique({ where })
    const handPicked = !!existing && existing.autoTier != null && existing.tier !== existing.autoTier
    await prisma.championPoolEntry.upsert({
      where,
      create: {
        memberId, championKey: e.championKey, role: e.role,
        tier, autoTier: tier, playRate: e.count, winRate, masteryPoints, kda, firstPlayedAt, lastPlayedAt,
      },
      update: {
        ...(forceTiers || !handPicked ? { tier } : {}),
        autoTier: tier,
        playRate: e.count,
        winRate: winRate ?? existing?.winRate ?? null,
        masteryPoints, kda, firstPlayedAt, lastPlayedAt,
      },
    })
    upserted++
  }
  return upserted
}

/**
 * Re-tiers stored auto-filled / scouted entries where the stored tier may be
 * out of date: entries never tiered by the v2 rule (autoTier null) and
 * "new" entries whose first game is now more than NEW_PICK_DAYS old — so a
 * new pick turns into a regular tier by itself, without a new auto-fill.
 * Member by member (rank and share need the whole pool); hand-picked tiers
 * stay. One query when nothing matches: cheap at start-up and on listing.
 */
export async function refreshAutoTiers(): Promise<number> {
  const prisma = getPrisma()
  const expiredBefore = new Date(Date.now() - NEW_PICK_DAYS * 86_400_000)
  const stale = await prisma.championPoolEntry.findMany({
    where: {
      playRate: { not: null },
      OR: [{ autoTier: null }, { autoTier: 'new', firstPlayedAt: { lt: expiredBefore } }],
    },
    select: { memberId: true },
    distinct: ['memberId'],
  })
  let changed = 0
  for (const { memberId } of stale) {
    const pool = await prisma.championPoolEntry.findMany({ where: { memberId, playRate: { not: null } } })
    const tiers = tierPool(pool.map((e) => ({
      championKey: e.championKey,
      role: e.role,
      games: e.playRate ?? 0,
      winRate: e.winRate,
      masteryPoints: e.masteryPoints,
      firstPlayedAt: e.firstPlayedAt?.getTime() ?? null,
      lastPlayedAt: e.lastPlayedAt?.getTime() ?? null,
    })))
    for (let i = 0; i < pool.length; i++) {
      const e = pool[i]
      const next = tiers[i]
      const handPicked = e.autoTier != null && e.tier !== e.autoTier
      if (e.autoTier === next && (handPicked || e.tier === next)) continue
      await prisma.championPoolEntry.update({ where: { id: e.id }, data: { autoTier: next, ...(handPicked ? {} : { tier: next }) } })
      changed++
    }
  }
  return changed
}

// ── Custom games shared with the group (#41a) ──────────────────────────────
// A team linked to a group (own roster, groupId set) publishes its imported scrim / tournament games to
// team_custom_games and reads the group's games back, so the group's players get the Scrim / Tournoi stats too.
// Teams without a group stay local only. Every cloud step is best effort: offline, the local games still work.

/** The group a team's custom games are shared with, or null (opponent, no group, signed out, no cloud). */
async function customGamesGroupOf(team: { groupId: string | null; isOpponent: boolean }): Promise<string | null> {
  if (!team.groupId || team.isOpponent || !isCloudConfigured()) return null
  return (await getSessionUserId().catch(() => null)) ? team.groupId : null
}

/** Earlier imports, published once per team per run (staff only: RLS refuses a player's write, which is ignored). */
const customGamesBackfilled = new Set<string>()
async function backfillCustomGames(teamId: string, groupId: string, local: customGamesCore.LocalCustomGame[]): Promise<void> {
  if (customGamesBackfilled.has(teamId) || local.length === 0) return
  customGamesBackfilled.add(teamId)
  try {
    const sb = getSupabase()
    const published = await customGamesCore.listPublishedLocalIds(sb, groupId)
    for (const g of local) if (!published.has(g.id)) await customGamesCore.publishCustomGame(sb, groupId, g)
  } catch (err) {
    console.warn('[team] custom games backfill failed:', (err as Error)?.message)
  }
}

/** The team's custom games: local ones, plus the group's (without the copies of this PC's own imports). */
async function customGamesOf(team: { id: string; groupId: string | null; isOpponent: boolean }, gameType?: 'scrim' | 'tournament') {
  const local = await getPrisma().customGame.findMany({
    where: { teamId: team.id, ...(gameType ? { gameType } : {}) },
    orderBy: { importedAt: 'desc' },
  })
  const groupId = await customGamesGroupOf(team)
  if (!groupId) return local
  void backfillCustomGames(team.id, groupId, local)
  try {
    const rows = await customGamesCore.listGroupCustomGames(getSupabase(), groupId, gameType)
    return customGamesCore.mergeWithGroupGames(local, rows.map((r) => customGamesCore.fromGroupRow(r, team.id)))
  } catch (err) {
    console.warn('[team] could not read the group custom games:', (err as Error)?.message)
    return local
  }
}

/** P1-3: scouts and synergy read Riot in the background, behind the end of a game and the open screens. */
const handleInBackground = (channel: string, fn: Parameters<typeof ipcMain.handle>[1]) => ipcMain.handle(channel, inBackground(fn))

export function registerTeamHandlers() {
  // ── Teams ────────────────────────────────────────────────────────────────

  validatedHandle('team:list', z.tuple([teamListOpts.optional()]), async (_e, opts) => {
    const prisma = getPrisma()
    const user = await getActiveUser()
    // A "new" pick older than two weeks turns into a regular tier here.
    await refreshAutoTiers().catch((err) => console.warn('[team] tier refresh failed:', err))
    // #49: a group's opponents include the ones entered in a Planning slot (Scouting tab, Draft Sim). At most once a
    // minute per group, never failing the list.
    if (opts?.isOpponent && opts.groupId) await importGroupOpponents(opts.groupId)
    const listTeams = () => prisma.team.findMany({
      // #7: `groupId` scopes Scouting to the opponents of the chosen group.
      where: teamListWhere(user.id, opts ?? {}),
      orderBy: { updatedAt: 'desc' },
      // seasonMatchIdsJson (up to ~2,500 ids per scouted member) is main-process
      // bookkeeping the renderer never reads: keep it off the IPC payload.
      include: { members: { omit: { seasonMatchIdsJson: true }, include: { champPool: true } } },
    })
    let teams = await listTeams()
    // #46 point 1: a group's own team takes its players' published pools for the pools still empty here, instead
    // of fetching them from Riot again (cloud/poolImport.ts). At most once a minute per group, never failing the list.
    const toFill = teams.filter((t) => !t.isOpponent && t.groupId && t.members.some((m) => m.champPool.length === 0))
    if (toFill.length > 0 && (await Promise.all(toFill.map((t) => importGroupPools(t.groupId as string, t.id)))).some(Boolean)) {
      teams = await listTeams()
    }
    // #38: renamed players get their current Riot ID back (by puuid, once per member per run, in the background).
    void refreshTeamMemberRiotIds(teams.flatMap((t) => t.members)).catch(() => {})
    return teams
  })


  // Whitelisted fields only: the renderer's object used to be spread into
  // prisma.team.create as is.
  validatedHandle('team:create', z.tuple([teamCreateInput]), async (_e, data) => {
    const prisma = getPrisma()
    const user = await getActiveUser()
    return prisma.team.create({
      data: { ...data, userId: user.id },
    })
  })


  /**
   * Makes a local team the roster of a cloud group (or unlinks it with
   * null). One team per group: whichever own team held the group before is
   * released, so the header's group picker always resolves to one team.
   * For an opponent it means "scouted for this group" (#7): any number of
   * opponents per group, nothing released.
   */
  validatedHandle('team:link-group', z.tuple([idSchema, groupIdSchema.nullable()]), async (_e, teamId, groupId) => {
    const prisma = getPrisma()
    const user = await getActiveUser()
    return prisma.$transaction(async (tx) => {
      const team = await tx.team.findFirst({ where: { id: teamId, userId: user.id }, select: { isOpponent: true } })
      if (!team) throw new Error('Team not found')
      const release = groupId ? teamLinkReleaseWhere(user.id, teamId, groupId, team.isOpponent) : null
      if (release) await tx.team.updateMany({ where: release, data: { groupId: null } })
      return tx.team.update({ where: { id: teamId }, data: { groupId } })
    })
  })

  ipcMain.handle('team:delete', async (_e, id: string) => {
    const prisma = getPrisma()
    // #49: a group's opponent deleted here is not brought back by the next import from the group's scouting.
    const team = await prisma.team.findUnique({ where: { id }, select: { isOpponent: true, groupId: true, name: true } })
    if (team?.isOpponent && team.groupId) await rememberDismissedOpponent(team.groupId, team.name).catch(() => {})
    await prisma.team.delete({ where: { id } })
    return { ok: true }
  })

  // ── Members ──────────────────────────────────────────────────────────────

  ipcMain.handle('team:add-member', async (_e, teamId: string, data: {
    displayName: string
    ign?: string
    tagLine?: string
    region?: string
    role: string
    puuid?: string
  }) => {
    const prisma = getPrisma()
    // Idempotent add: if a member with the same Riot identity already exists
    // in this team, update them in place instead of creating a duplicate.
    // Match by puuid first (most reliable), fallback to ign+tagLine (case-insensitive).
    const existing = await findExistingMember(teamId, data)
    if (existing) {
      return prisma.teamMember.update({
        where: { id: existing.id },
        data: {
          // Keep the existing member's role unless the caller specifies one
          // that differs from a placeholder. Role and display name are
          // updated to reflect the most recent input.
          displayName: data.displayName || existing.displayName,
          role: data.role || existing.role,
          ign: data.ign ?? existing.ign,
          tagLine: data.tagLine ?? existing.tagLine,
          region: data.region ?? existing.region,
          puuid: data.puuid ?? existing.puuid,
        },
      })
    }
    return prisma.teamMember.create({ data: { ...data, teamId } })
  })

  /**
   * Remove all duplicate members in a team, keeping the OLDEST entry for each
   * Riot identity (puuid or ign+tagLine pair). Their pool entries are merged
   * onto the kept member; duplicate pool entries (same champion+role) are
   * collapsed by keeping the one with the highest playRate.
   *
   * Returns the number of removed members.
   */
  ipcMain.handle('team:dedupe-members', async (_e, teamId: string) => {
    const prisma = getPrisma()
    const members = await prisma.teamMember.findMany({
      where: { teamId },
      orderBy: { id: 'asc' },
      include: { champPool: true },
    })

    // Group members by progressive identity matching (shared with web team
    // CRUD, src/lib/teamIdentity.ts) so the displayed duplicate count always
    // matches the cleanup result on both platforms.
    const groups = groupDuplicates(members)

    let removed = 0
    for (const group of groups) {
      const [keeper, ...dups] = group
      // Move pool entries from dups onto keeper, deduplicating champion+role
      const keeperKeys = new Set(keeper.champPool.map((e) => `${e.championKey}|${e.role}`))
      for (const dup of dups) {
        for (const entry of dup.champPool) {
          const k = `${entry.championKey}|${entry.role}`
          if (keeperKeys.has(k)) continue
          await prisma.championPoolEntry.update({
            where: { id: entry.id },
            data: { memberId: keeper.id },
          })
          keeperKeys.add(k)
        }
        // Delete the duplicate member (cascade removes remaining pool entries)
        await prisma.teamMember.delete({ where: { id: dup.id } })
        removed++
      }
    }
    return { removed }
  })

  // Whitelisted fields only (the renderer's object used to reach Prisma as is).
  validatedHandle('team:update-member', z.tuple([idSchema, teamMemberPatch]), async (_e, memberId, data) => {
    const prisma = getPrisma()
    return prisma.teamMember.update({ where: { id: memberId }, data })
  })

  validatedHandle('team:remove-member', z.tuple([idSchema]), async (_e, memberId) => {
    const prisma = getPrisma()
    await prisma.teamMember.delete({ where: { id: memberId } })
    return { ok: true }
  })

  // ── Champion pool ────────────────────────────────────────────────────────

  ipcMain.handle('team:pool-list', async (_e, memberId: string) => {
    const prisma = getPrisma()
    await refreshAutoTiers().catch((err) => console.warn('[team] tier refresh failed:', err))
    return prisma.championPoolEntry.findMany({
      where: { memberId },
      orderBy: [{ tier: 'asc' }, { championKey: 'asc' }],
    })
  })

  ipcMain.handle('team:pool-upsert', async (_e, memberId: string, championKey: string, role: string, data: Partial<{
    tier: string
    notes: string | null
    playRate: number | null
    winRate: number | null
    masteryPoints: number | null
    kda: number | null
  }>) => {
    const prisma = getPrisma()
    return prisma.championPoolEntry.upsert({
      where: { memberId_championKey_role: { memberId, championKey, role } },
      create: {
        memberId,
        championKey,
        role,
        tier: data.tier ?? 'comfort',
        notes: data.notes ?? null,
        playRate: data.playRate ?? null,
        winRate: data.winRate ?? null,
      },
      update: data,
    })
  })

  ipcMain.handle('team:pool-remove', async (_e, entryId: string) => {
    const prisma = getPrisma()
    await prisma.championPoolEntry.delete({ where: { id: entryId } })
    return { ok: true }
  })

  // ── Draft prep ───────────────────────────────────────────────────────────

  ipcMain.handle('draft:list', async () => {
    const prisma = getPrisma()
    const user = await getActiveUser()
    return prisma.draftPrep.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: 'desc' },
      include: { vsTeam: true },
    })
  })


  // Each slot now supports MULTIPLE candidate champions (priority-ordered).
  // Storage shape is `string[][]` so each slot is an array. The frontend may
  // still pass legacy `string[]` (single pick per slot) — we normalize either
  // shape into `string[][]` here so callers can mix formats during migration.
  ipcMain.handle('draft:create', async (_e, data: {
    name: string
    vsTeamId?: string | null
    bluePicks?: string[][] | string[]
    blueBans?: string[][] | string[]
    redPicks?: string[][] | string[]
    redBans?: string[][] | string[]
    myTeamSide?: 'blue' | 'red'
    notes?: string
  }) => {
    const prisma = getPrisma()
    const user = await getActiveUser()
    return prisma.draftPrep.create({
      data: {
        userId: user.id,
        name: data.name,
        vsTeamId: data.vsTeamId ?? null,
        bluePicks: JSON.stringify(normalizeSlots(data.bluePicks)),
        blueBans: JSON.stringify(normalizeSlots(data.blueBans)),
        redPicks: JSON.stringify(normalizeSlots(data.redPicks)),
        redBans: JSON.stringify(normalizeSlots(data.redBans)),
        myTeamSide: data.myTeamSide ?? 'blue',
        notes: data.notes ?? null,
      },
    })
  })

  ipcMain.handle('draft:update', async (_e, id: string, data: Partial<{
    name: string
    vsTeamId: string | null
    bluePicks: string[][] | string[]
    blueBans: string[][] | string[]
    redPicks: string[][] | string[]
    redBans: string[][] | string[]
    myTeamSide: 'blue' | 'red'
    notes: string | null
  }>) => {
    const prisma = getPrisma()
    const update: Record<string, unknown> = {}
    if (data.name !== undefined) update.name = data.name
    if (data.vsTeamId !== undefined) update.vsTeamId = data.vsTeamId
    if (data.bluePicks !== undefined) update.bluePicks = JSON.stringify(normalizeSlots(data.bluePicks))
    if (data.blueBans !== undefined) update.blueBans = JSON.stringify(normalizeSlots(data.blueBans))
    if (data.redPicks !== undefined) update.redPicks = JSON.stringify(normalizeSlots(data.redPicks))
    if (data.redBans !== undefined) update.redBans = JSON.stringify(normalizeSlots(data.redBans))
    if (data.myTeamSide !== undefined) update.myTeamSide = data.myTeamSide
    if (data.notes !== undefined) update.notes = data.notes
    return prisma.draftPrep.update({ where: { id }, data: update })
  })

  ipcMain.handle('draft:delete', async (_e, id: string) => {
    const prisma = getPrisma()
    await prisma.draftPrep.delete({ where: { id } })
    return { ok: true }
  })

  ipcMain.handle('draft:duplicate', async (_e, id: string) => {
    const prisma = getPrisma()
    const source = await prisma.draftPrep.findUnique({ where: { id } })
    if (!source) throw new Error('Draft not found')
    return prisma.draftPrep.create({
      data: {
        userId: source.userId,
        name: `${source.name} (copy)`,
        vsTeamId: source.vsTeamId,
        bluePicks: source.bluePicks,
        blueBans: source.blueBans,
        redPicks: source.redPicks,
        redBans: source.redBans,
        myTeamSide: source.myTeamSide,
        notes: source.notes,
      },
    })
  })

  // ── Scouting ─────────────────────────────────────────────────────────────

  /**
   * Progressive scout (27/11/2026, docs/contracts/scouting-progressive.md): one or several members at once, masteries
   * first (instant pool), ONE download list for the whole team (a game two scouted players share is read once), most
   * recent games first, partial pools sent to the renderer as `team:scout-progress` events. Same final write as
   * before (cleanup, tiers, scout cache), per member, the moment their games are all analysed.
   */
  const activeScouts = new Map<string, { cancelled: boolean }>()
  /** A cancel that arrived before its scout was registered (the scout then starts already cancelled). */
  const earlyCancels = new Set<string>()

  async function scoutMembersDesktop(
    sender: Electron.WebContents | null,
    memberIds: string[],
    opts: { count?: number; roleOnly?: boolean; scoutId?: string; emitProgress?: boolean },
  ): Promise<ScoutResult> {
    // Default to UNFILTERED so the champion counts match op.gg's view (a flex player who plays 50 TOP + 34 JG on
    // Aatrox appears as 84 games). Callers can opt back into strict role filtering.
    const roleOnly = opts.roleOnly ?? false
    const count = opts.count ?? RIOT_LIMITS.QUICK_SCOUT_MATCH_COUNT
    const scoutId = opts.scoutId ?? `scout-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    // Registered FIRST: a cancel received while the rows are being read must find the scout.
    // Refuses a duplicate id and more than MAX_ACTIVE_SCOUTS at once (TOO_MANY_SCOUTS).
    const flag = registerScout(activeScouts, scoutId, earlyCancels.delete(scoutId))
    try {
    const prisma = getPrisma()
    memberIds = Array.from(new Set(memberIds)) // the same member twice would be scouted (and written) twice
    const rows = await prisma.teamMember.findMany({ where: { id: { in: memberIds } } })
    const rowById = new Map(rows.map((r) => [r.id, r]))
    const members: ScoutMember[] = memberIds.filter((id) => rowById.has(id)).map((id) => {
      const r = rowById.get(id)!
      return { id, displayName: r.displayName, role: r.role }
    })
    if (members.length === 0) throw new Error('Member not found')
    const noCap = !Number.isFinite(count) || count <= 0 || count > RIOT_LIMITS.MAX_MATCH_IDS_PER_CALL
    const idToKey = await getChampionIdToKey().catch(() => ({} as Record<number, string>))

    const deps: ScoutDeps = {
      async resolveMember(m) {
        const member = rowById.get(m.id)!
        let puuid = member.puuid
        if (!puuid) {
          if (!member.ign || !member.tagLine || !member.region) throw new Error('Member needs IGN + tagLine + region to be scouted')
          const acct = await getAccountByRiotId(member.ign, member.tagLine, member.region)
          if (!acct?.puuid) throw new Error('Could not resolve Riot account')
          puuid = acct.puuid
          await prisma.teamMember.update({ where: { id: m.id }, data: { puuid } })
        }
        if (!member.region) throw new Error('Region missing')
        return { puuid, region: member.region }
      },
      // Same priority as the web (background: the proxy classes the mastery route as background anyway).
      getMasteries: (_m, r) => (async () => {
        const ms = await getChampionMasteries(r.puuid, r.region, RIOT_LIMITS.MAX_MASTERY_COUNT).catch((err) => {
          console.warn('[scout] mastery fetch failed:', (err as Error)?.message)
          return [] as Awaited<ReturnType<typeof getChampionMasteries>>
        })
        return ms.flatMap((m) => (idToKey[m.championId] ? [{ championKey: idToKey[m.championId], championPoints: m.championPoints }] : []))
      })(),
      // E15: incremental, a repeat scout only asks Riot for the games since the last one ("Complete" relists).
      getSeasonIds: (m, r) => getSeasonMatchIdsIncremental(rowById.get(m.id)!, r.puuid, r.region, noCap),
      async loadCached(ids) {
        const out = new Map<string, any>()
        const cached = await prisma.matchCache.findMany({ where: { matchId: { in: ids } }, select: { matchId: true, matchJson: true } })
        for (const row of cached) {
          try { out.set(row.matchId, JSON.parse(row.matchJson)) } catch { /* corrupt row: treated as a miss and downloaded again */ }
        }
        return out
      },
      fetchMatch: (id, region) => fetchMatchShared(id, region),
      async saveMatch(id, match) {
        // AWAITED: SQLite serialises writes anyway, and a fire-and-forget pile of them starves the other IPC handlers.
        try {
          const json = JSON.stringify(match)
          await prisma.matchCache.upsert({ where: { matchId: id }, create: { matchId: id, matchJson: json }, update: { matchJson: json } })
        } catch (dbErr) {
          console.warn('[scout] cache write failed for', id, (dbErr as Error)?.message)
        }
      },
      async finalizeMember(m, _r, snap, allSeasonIds) {
        // Cleanup pass. Removes pre-normalization entries with raw Riot role names (MIDDLE/BOTTOM/UTILITY, dead data
        // the Draft Sim can never show) and, with roleOnly, auto-scouted entries no longer in the fresh scan.
        // Manual entries (playRate=null) are always preserved.
        const newKeys = new Set(snap.entries.map((e) => `${e.championKey}|${e.role}`))
        const existing = await prisma.championPoolEntry.findMany({ where: { memberId: m.id, playRate: { not: null } } })
        const toDelete = existing.filter((e) => {
          if (e.role === 'MIDDLE' || e.role === 'BOTTOM' || e.role === 'UTILITY') return true
          return roleOnly && !newKeys.has(`${e.championKey}|${e.role}`)
        })
        if (toDelete.length > 0) {
          await prisma.championPoolEntry.deleteMany({ where: { id: { in: toDelete.map((e) => e.id) } } })
          console.log(`[team:scout] cleaned ${toDelete.length} stale entries for ${m.displayName}`)
        }
        if (snap.failed > 0) console.warn(`[team:scout] ${m.displayName}: ${snap.failed}/${snap.totalMatches} matches missing (not on Riot or fetch failed)`)
        // Same rule as auto-fill-pool (tierPool: rank and share per role, recency, the "new" tier).
        const upserted = await writeTieredPool(m.id, snap.entries.map((e) => ({ ...e, masteryPoints: e.masteryPoints || null, firstAt: e.firstAt ?? null, lastAt: e.lastAt ?? null })), snap.history)
        await saveScoutCache(m.id, allSeasonIds)
        return upserted
      },
      emit(ev) {
        if (!opts.emitProgress || !sender || sender.isDestroyed()) return
        try { sender.send('team:scout-progress', ev) } catch { /* the window closed meanwhile */ }
      },
      isCancelled: () => flag.cancelled,
    }
    try {
      const result = await runScout(deps, members, {
        scoutId, count, roleOnly, concurrency: RIOT_LIMITS.MATCH_FETCH_CONCURRENCY, maxIds: RIOT_LIMITS.MAX_MATCH_IDS_PER_CALL,
        // A signed-out session fails every call: stop the whole scout instead of counting 1 500 "missing" games.
        isFatal: (err) => err instanceof RiotAuthError,
      })
      const s = result.stats
      console.info(`[scout] ${members.length} member(s): ${s.rawIds} ids, ${s.uniqueIds} distinct (${s.sharedIds} shared), ${s.fromCache} cached, ${s.downloaded} downloaded, ${s.failed} failed (${s.unreadable} unreadable) · first pool ${s.firstPoolMs ?? '-'}ms · total ${(s.totalMs / 1000).toFixed(1)}s`)
      return result
    } finally {
      releaseScout(activeScouts, scoutId, flag)
    }
    } catch (err) {
      releaseScout(activeScouts, scoutId, flag)
      throw err
    }
  }

  // Whole team (or several members): progress events on `team:scout-progress`, see the contract.
  validatedHandle('team:scout-team', z.tuple([z.array(idSchema).min(1).max(MAX_SCOUT_MEMBERS), z.object({
    count: scoutCountSchema.optional(), roleOnly: z.boolean().optional(), scoutId: z.string().min(4).max(64).optional(),
  }).strict().optional()]), inBackground(async (e, memberIds, opts) => {
    const r = await scoutMembersDesktop(e.sender, memberIds, { ...opts, emitProgress: true })
    return toTeamResult(r)
  }))

  validatedHandle('team:scout-cancel', z.tuple([z.string().min(4).max(64)]), (_e, scoutId) => {
    const flag = activeScouts.get(scoutId)
    if (flag) flag.cancelled = true
    else {
      earlyCancels.add(scoutId)
      if (earlyCancels.size > 50) earlyCancels.delete(earlyCancels.values().next().value as string)
    }
    return { ok: true as const, found: !!flag }
  })

  // One member (kept for the screens that scout one by one): same engine, same result shape as before.
  validatedHandle('team:scout-member', z.tuple([idSchema, scoutCountSchema.optional(), z.object({
    roleOnly: z.boolean().optional(), scoutId: z.string().min(4).max(64).optional(),
  }).strict().optional()]), inBackground(async (e, memberId, count, opts) => {
    const r = await scoutMembersDesktop(e.sender, [memberId], { count: count ?? 100, roleOnly: opts?.roleOnly, scoutId: opts?.scoutId, emitProgress: opts?.scoutId != null })
    const m = r.members[0]
    if (!m?.ok) throw (m?.error?.cause instanceof Error ? m.error.cause : new Error(m?.error?.message ?? 'Scout failed'))
    return { upserted: m.upserted, totalMatches: m.totalMatches, sameRoleCount: m.sameRoleCount }
  }))

  /**
   * Full auto-fill of a member's champion pool: combines mastery points
   * (long-term skill signal) with recent match history (current meta /
   * season picks). Smarter than `scout-member` for your own roster since
   * it considers both lifetime mastery and current play patterns.
   *
   * Tier classification is delegated to the shared rule in
   * src/lib/threatCore.ts (`tierPool`, v2) — see there for the exact
   * thresholds, kept in one place so scouting, auto-fill and the Draft Sim
   * can never drift apart.
   *
   * Mastery-only champions (no recent games) are bucketed into the member's
   * primary role since the API doesn't tie mastery to a role.
   *
   * A tier the user picked by hand (tier ≠ autoTier) is preserved — auto-
   * fill only refreshes the stats of those entries, unless the caller
   * passes `overwriteTiers: true`. `overwriteTiers: false` also skips the
   * clean-up of stale auto-filled entries.
   */
  handleInBackground('team:auto-fill-pool', async (_e, memberId: string, opts: {
    matchCount?: number
    masteryCount?: number
    overwriteTiers?: boolean
    roleOnly?: boolean
  } = {}) => {
    // Default to role-filtered: a roster's "TOP laner" pool should reflect
    // their TOP picks, not their off-role flex games. ChampPoolTab can still
    // show all roles separately for flex players, this just biases the
    // auto-seeded entries toward the assigned role.
    const roleOnly = opts.roleOnly ?? true
    // Upper-cap applied AFTER paginating the season match list:
    //   - 100  (default, "quick")    : ~2 min on Personal key
    //   - 500  ("deep")               : ~10 min on Personal key
    //   - <= 0 or huge ("complete")   : no cap, every season game Riot has
    //                                   (~30 min on Personal, fast on Prod)
    // The tier thresholds saturate quickly so the default of 100 is enough
    // for accurate tiering on most ranked accounts. The hard ceiling
    // matches the worst-case payload from getSeasonMatchIds (1000 solo +
    // 1000 flex + 500 clash) and prevents accidental runaway allocations.
    const rawMatchCount = opts.matchCount ?? RIOT_LIMITS.QUICK_SCOUT_MATCH_COUNT
    const matchCountNoCap = !Number.isFinite(rawMatchCount) || rawMatchCount <= 0 || rawMatchCount > RIOT_LIMITS.MAX_MATCH_IDS_PER_CALL
    const matchCount = matchCountNoCap ? RIOT_LIMITS.MAX_MATCH_IDS_PER_CALL : Math.max(1, Math.min(rawMatchCount, RIOT_LIMITS.MAX_MATCH_IDS_PER_CALL))
    const masteryCount = Math.min(opts.masteryCount ?? RIOT_LIMITS.DEFAULT_MASTERY_COUNT, RIOT_LIMITS.MAX_MASTERY_COUNT)
    const overwriteTiers = opts.overwriteTiers ?? true

    const prisma = getPrisma()
    const member = await prisma.teamMember.findUnique({ where: { id: memberId } })
    if (!member) throw new Error('Member not found')

    let puuid = member.puuid
    const region = member.region
    if (!puuid) {
      if (!member.ign || !member.tagLine || !member.region) {
        throw new Error('Member needs IGN + tagLine + region to be auto-filled')
      }
      const acct = await getAccountByRiotId(member.ign, member.tagLine, member.region)
      if (!acct?.puuid) throw new Error('Could not resolve Riot account')
      puuid = acct.puuid
      await prisma.teamMember.update({ where: { id: memberId }, data: { puuid } })
    }
    if (!region) throw new Error('Region missing')

    const memberRole = (member.role || '').toUpperCase()

    // Fetch mastery + season match list in parallel. The match list now
    // covers the full current split (SoloQ + Flex + Clash, paginated) so
    // play-counts shown in the Champion Pool tab reflect the real season.
    // E15: incremental listing (see getSeasonMatchIdsIncremental) — a
    // repeat "quick"/"deep" auto-fill only asks Riot for games since the
    // last one; "Complete" (matchCountNoCap) always relists from scratch.
    let listFailed = false
    const [allSeasonIds, masteries, idToKey] = await Promise.all([
      getSeasonMatchIdsIncremental(member, puuid, region, matchCountNoCap).catch((err) => {
        console.warn('[auto-fill] match list failed:', err.message)
        listFailed = true
        return [] as string[]
      }),
      getChampionMasteries(puuid, region, masteryCount).catch((err) => {
        console.warn('[auto-fill] mastery failed:', err.message)
        return [] as Awaited<ReturnType<typeof getChampionMasteries>>
      }),
      getChampionIdToKey(),
    ])
    const matchIds = allSeasonIds.slice(0, matchCount)

    // Aggregate match data per (championKey, role), with the first and last
    // game of each, and the span of every analysed game (any role).
    const agg = new Map<string, PoolAgg>()
    const history = { from: null as number | null, to: null as number | null }

    if (matchIds.length > 0) {
      // Use the shared MatchCache helper so re-running auto-fill (or having
      // previously scouted the same player) costs essentially zero API calls.
      const matches = await getMatchesBulkCached(matchIds, region)
      let failed = 0
      for (const id of matchIds) {
        const match = matches.get(id)
        if (!match) { failed++; continue }
        const participant = match?.info?.participants?.find((p: any) => p.puuid === puuid)
        if (!participant) continue
        const at = matchStartOf(match)
        stretch(history, at)
        const role = normalizeRole(participant.teamPosition || participant.individualPosition)
        if (!role || role === 'UNKNOWN' || role === 'INVALID' || role === 'NONE') continue
        if (roleOnly && memberRole && role !== memberRole) continue
        const key = `${participant.championName}|${role}`
        let entry = agg.get(key)
        if (!entry) {
          entry = {
            championKey: participant.championName, role, count: 0, wins: 0, kills: 0, deaths: 0, assists: 0,
            masteryPoints: 0, firstAt: null, lastAt: null,
          }
          agg.set(key, entry)
        }
        addPlay(entry, participant, at)
      }
      if (failed > 0) console.warn(`[auto-fill] ${failed}/${matchIds.length} matches missing (cache miss + fetch fail)`)
    }

    // Attach mastery points to existing entries; for mastery-only champions,
    // create a new entry slotted into the member's primary role — but only
    // if the champion is actually played in that role. Without this guard,
    // historical off-role mastery (e.g. a JG main with 100k on Jinx from
    // their old ADC days) pollutes the in-role pool.
    const primaryRole = (member.role || 'MID').toUpperCase() as Role
    for (const m of masteries) {
      const championKey = idToKey[m.championId]
      if (!championKey) continue
      const candidates = Array.from(agg.values()).filter((e) => e.championKey === championKey)
      if (candidates.length > 0) {
        // Apply mastery to ALL roles they've played this champ in this season
        // (one-tricks who flex into other lanes still get full credit).
        for (const c of candidates) c.masteryPoints = Math.max(c.masteryPoints ?? 0, m.championPoints)
      } else if (!roleOnly || championPlaysRole(championKey, primaryRole)) {
        // Mastery-only attribution: skip champions that don't naturally play
        // the member's lane. championPlaysRole already falls back to tag-
        // based inference for newer champions not in the curated list.
        agg.set(`${championKey}|${primaryRole}`, {
          championKey,
          role: primaryRole,
          count: 0,
          wins: 0,
          masteryPoints: m.championPoints,
          kills: 0,
          deaths: 0,
          assists: 0,
          firstAt: null,
          lastAt: null,
        })
      }
    }

    if (agg.size === 0) {
      if (!listFailed) await saveScoutCache(memberId, allSeasonIds)
      return { upserted: 0, matchesUsed: matchIds.length, masteriesUsed: masteries.length }
    }

    // Clean up stale auto-filled entries. Removes:
    //   1. Any pre-normalization entries with raw Riot role names
    //      (MIDDLE/BOTTOM/UTILITY) — dead data the rest of the app can't
    //      match against the internal role enum.
    //   2. Auto-filled entries in the primary role that no longer appear
    //      in the latest match history / mastery scan.
    // Identified by `playRate != null` (manual adds default playRate to
    // null), so user-curated entries are always preserved. Skipped when the
    // user opts out of overwriteTiers or roleOnly.
    if (overwriteTiers && roleOnly) {
      const computed = new Set(Array.from(agg.values()).map((e) => `${e.championKey}|${e.role}`))
      const stalePrior = await prisma.championPoolEntry.findMany({
        where: { memberId, playRate: { not: null } },
      })
      const toDelete = stalePrior.filter((e) => {
        const isRawRiotRole = e.role === 'MIDDLE' || e.role === 'BOTTOM' || e.role === 'UTILITY'
        if (isRawRiotRole) return true
        if (e.role === primaryRole && !computed.has(`${e.championKey}|${e.role}`)) return true
        return false
      })
      if (toDelete.length > 0) {
        await prisma.championPoolEntry.deleteMany({
          where: { id: { in: toDelete.map((e) => e.id) } },
        })
        console.log(`[auto-fill] cleaned ${toDelete.length} stale entries for ${member.displayName}`)
      }
    }

    // Tiering (src/lib/threatCore.ts tierPool): rank and share in the role,
    // an adjusted win rate, recency, mastery as a hint, and the "new" tier.
    // A tier the user picked by hand stays unless the caller explicitly
    // passes overwriteTiers: true. playRate doubles as the "auto-fill
    // provenance" marker for the cleanup pass above: writeTieredPool always
    // writes a number (0 for mastery-only entries), manual adds keep null.
    const upserted = await writeTieredPool(memberId, Array.from(agg.values()), history, opts.overwriteTiers === true)

    if (!listFailed) await saveScoutCache(memberId, allSeasonIds)
    // #46 point 1: my own pool, once filled here, goes to the group so my teammates don't fetch it again.
    void publishOwnPoolIfMine(memberId)
    return {
      upserted,
      matchesUsed: matchIds.length,
      masteriesUsed: masteries.length,
    }
  })

  /**
   * #46 point 2: a Lobby card's champions within seconds. A card whose player has no pool yet used to wait for a
   * full auto-fill (up to 100 games, ~23 uncached Riot calls per 2 minutes per player on the development key: over
   * 4 minutes for Njord). This reads the player's champion masteries only (1 call, plus 1 for the account when the
   * puuid is unknown), at interactive priority, and writes them as a first pool in the player's role. Only when the
   * local pool is still EMPTY: it never overwrites a pool made from games. The full auto-fill can run after it as
   * before and replaces these entries. Returns how many entries were written (0: the pool was not empty, or Riot
   * had nothing).
   */
  validatedHandle('team:card-champions', z.tuple([idSchema]), (_e, memberId) => withRiotPriority('interactive', async () => {
    const prisma = getPrisma()
    const member = await prisma.teamMember.findUnique({ where: { id: memberId } })
    if (!member) throw new Error('Member not found')
    if (await prisma.championPoolEntry.count({ where: { memberId } }) > 0) return { upserted: 0 }
    if (!member.region) throw new Error('Region missing')
    let puuid = member.puuid
    if (!puuid) {
      if (!member.ign || !member.tagLine) throw new Error('Member needs IGN + tagLine + region')
      const acct = await getAccountByRiotId(member.ign, member.tagLine, member.region)
      if (!acct?.puuid) throw new Error('Could not resolve Riot account')
      puuid = acct.puuid
      await prisma.teamMember.update({ where: { id: memberId }, data: { puuid } })
    }
    const [masteries, idToKey] = await Promise.all([
      getChampionMasteries(puuid, member.region, RIOT_LIMITS.DEFAULT_MASTERY_COUNT),
      getChampionIdToKey(),
    ])
    const primaryRole = (member.role || 'MID').toUpperCase() as Role
    const entries: PoolAgg[] = []
    for (const m of masteries) {
      const championKey = idToKey[m.championId]
      if (!championKey || !championPlaysRole(championKey, primaryRole)) continue
      entries.push({ championKey, role: primaryRole, count: 0, wins: 0, kills: 0, deaths: 0, assists: 0, masteryPoints: m.championPoints, firstAt: null, lastAt: null })
    }
    // Filled meanwhile by another fetch: leave it.
    if (entries.length === 0 || await prisma.championPoolEntry.count({ where: { memberId } }) > 0) return { upserted: 0 }
    const upserted = await writeTieredPool(memberId, entries, { from: null, to: null }, false)
    void publishOwnPoolIfMine(memberId)
    return { upserted }
  }))

  /**
   * Team synergy stats: aggregates per-player averages, shares, and per-champion
   * win rate across every flex-queue game where at least N of the roster played
   * together on the same team.
   *
   * Pipeline:
   *   1. Collect PUUIDs for every member that has one (auto-resolves missing
   *      ones from IGN+tag if possible).
   *   2. Fetch each member's recent flex match ID list (queue 440).
   *   3. Bucket match IDs by how many roster PUUIDs appear in them; keep only
   *      those that pass the `minTogether` threshold AND have all qualifying
   *      members on the SAME team (sharing matches against each other doesn't
   *      count as synergy).
   *   4. For each surviving match, pull the cached match JSON (or fetch and
   *      cache it) and compute per-member stats + per-member shares relative
   *      to that match's team totals.
   *   5. Aggregate to averages across each member's participation count.
   *
   * Heavy when run for the first time — typically 100–300 match fetches — but
   * MatchCache makes re-runs nearly free.
   */
  handleInBackground('team:compute-synergy-stats', async (_e, teamId: string, opts: {
    matchesPerMember?: number
    minTogether?: number
  } = {}) => {
    const matchesPerMember = Math.min(opts.matchesPerMember ?? RIOT_LIMITS.SYNERGY_MATCHES_PER_MEMBER, RIOT_LIMITS.MAX_IDS_PER_REQUEST)
    const minTogether = Math.max(2, opts.minTogether ?? 3)

    const prisma = getPrisma()
    const team = await prisma.team.findUnique({
      where: { id: teamId },
      include: { members: true },
    })
    if (!team) throw new Error('Team not found')

    // Step 1 — resolve PUUIDs for every member possible. E15: parallelized
    // (was a sequential for-loop) — each member's resolution is
    // independent, so a 5-member team no longer pays 5x the round-trip
    // latency just to get started. The shared rate limiter still bounds
    // total Riot throughput; this only removes needless serialization.
    const resolvedMembersRaw = await Promise.all(team.members.map(async (m) => {
      let puuid = m.puuid
      const region = m.region
      if (!puuid && m.ign && m.tagLine && region) {
        try {
          const acct = await getAccountByRiotId(m.ign, m.tagLine, region)
          if (acct?.puuid) {
            puuid = acct.puuid
            await prisma.teamMember.update({ where: { id: m.id }, data: { puuid } })
          }
        } catch (err) {
          console.warn('[synergy] could not resolve puuid for', m.displayName, err)
        }
      }
      return puuid && region ? { id: m.id, displayName: m.displayName, role: m.role, puuid, region } : null
    }))
    const resolvedMembers = resolvedMembersRaw.filter((m): m is NonNullable<typeof m> => m !== null)
    if (resolvedMembers.length < minTogether) {
      throw new Error(`Need at least ${minTogether} members with a resolved Riot ID — currently ${resolvedMembers.length}.`)
    }

    // Step 2 — fetch every member's flex match list (queue 440 only).
    // Parallelized for the same reason as step 1; map mutations below are
    // safe since each `await` resolves into its own synchronous callback
    // (no real concurrency in JS's single-threaded event loop).
    const matchToPuuids = new Map<string, Set<string>>()
    await Promise.all(resolvedMembers.map(async (m) => {
      try {
        indexMatchIds(matchToPuuids, m.puuid, await getMatchIds(m.puuid, m.region, matchesPerMember, 0, 'flex'))
      } catch (err) {
        console.warn('[synergy] match list failed for', m.displayName, err)
      }
    }))

    // Pre-filter on appearances. Match-list presence is cheap; we still need a
    // full fetch to confirm same-team and get stats, but this trims by ~70%.
    const candidateMatchIds = sharedMatchIds(matchToPuuids, minTogether)

    if (candidateMatchIds.length === 0) {
      return {
        matchCount: 0,
        membersPresent: [],
        players: [],
        fetchedAt: Date.now(),
      }
    }

    // Step 3 + 4 — fetch each match (via cache), then hand off to the same
    // aggregator the custom-game/combined-stats handlers use (E16: this
    // used to be a ~140-line copy of aggregateMatchLike's logic, duplicated
    // well enough to drift — now there's exactly one implementation of
    // "given match-like objects + a roster, compute averages/shares/
    // byChampion", so a future fix to one stats tab lands on all of them).
    //
    // Group candidate matches by the region of a seeder member so the bulk
    // fetcher can pull each match from the right routing cluster. Different
    // regions live on different Riot endpoints, so we can't mix them in one
    // batched call.
    const allMatches = new Map<string, any>()
    for (const [region, ids] of matchIdsByRegion(candidateMatchIds, matchToPuuids, resolvedMembers)) {
      const fetched = await getMatchesBulkCached(ids, region)
      for (const [id, m] of fetched) allMatches.set(id, m)
    }

    // Keep one entry per candidate (even unresolved ones, as an empty
    // match-like placeholder) so `candidateCount` below still reflects the
    // true number of candidates scanned, matching this handler's previous
    // behavior — aggregateMatchLike already skips empty/zero-duration
    // entries on its own.
    return aggregateMatchLike(team, candidateMatchIds.map((id) => matchLikeFromRiot(allMatches.get(id))), minTogether)
  })

  // ── Custom games (scrim / tournament CSV imports) ───────────────────────

  /**
   * Import a single ROFL-derived CSV (one game's worth of participant rows).
   *
   * Workflow:
   *   1. Show a native file picker (only on `path` not supplied — programmatic
   *      callers can pass a path directly, e.g. drag-and-drop in the future).
   *   2. Validate the filename contains "scrim" or "tournoi" / "tournament".
   *      If not, surface a warning back to the renderer so the user can
   *      explicitly confirm before we save.
   *   3. Parse the CSV using a generic case-insensitive column mapper that
   *      tolerates Replaybook's UPPER_SNAKE_CASE keys.
   *   4. Persist as a `CustomGame` row with participantsJson in a shape
   *      that mirrors Riot's match-V5 participant fields, so the synergy
   *      aggregator can consume both sources interchangeably.
   */
  ipcMain.handle('team:import-custom-game-csv', async (_e, teamId: string, opts: {
    /** Bypass the native file picker (used when caller already has CSV) */
    csvContent?: string
    filename?: string
    /** Override the auto-detected type; useful when the user confirms a
     *  filename-warning dialog on the renderer side. */
    forceType?: 'scrim' | 'tournament'
  } = {}) => {
    let csvText = opts.csvContent
    let filename = opts.filename

    if (!csvText) {
      const parentWindow = BrowserWindow.getFocusedWindow() ?? undefined
      const dialogOptions: Electron.OpenDialogOptions = {
        title: 'Import scrim / tournament CSV',
        filters: [{ name: 'CSV (Replaybook export)', extensions: ['csv'] }],
        properties: ['openFile'],
      }
      const result = parentWindow
        ? await dialog.showOpenDialog(parentWindow, dialogOptions)
        : await dialog.showOpenDialog(dialogOptions)
      if (result.canceled || !result.filePaths[0]) return { canceled: true as const }
      const path = result.filePaths[0]
      if (!existsSync(path)) throw new Error(`File not found: ${path}`)
      csvText = readFileSync(path, 'utf-8')
      filename = basename(path)
    }
    if (!filename) filename = 'imported.csv'

    // Filename-based type detection. Case-insensitive substring match. Accept
    // both "tournoi" (FR) and "tournament" (EN) since the user mixes both.
    const lower = filename.toLowerCase()
    let detectedType: 'scrim' | 'tournament' | null = null
    if (lower.includes('scrim')) detectedType = 'scrim'
    else if (lower.includes('tournoi') || lower.includes('tournament')) detectedType = 'tournament'

    const gameType = opts.forceType ?? detectedType
    if (!gameType) {
      // Renderer should show a warning + ask the user to either rename the
      // file or pick a type explicitly. We don't save anything here.
      return {
        canceled: false as const,
        warning: 'filename-missing-type' as const,
        filename,
      }
    }

    // Parse CSV
    const rows = parseCsv(csvText)
    if (rows.length === 0) throw new Error('CSV appears to be empty (no parseable rows).')

    // Build a key-normalizer so callers can write CSV with either UPPER or
    // lower case headers, and so multiple aliases for the same field work.
    const getField = (row: Record<string, string>, ...keys: string[]): string | undefined => {
      for (const k of keys) {
        const found = Object.keys(row).find((rk) => rk.toLowerCase() === k.toLowerCase())
        if (found && row[found] !== undefined && row[found] !== '') return row[found]
      }
      return undefined
    }
    const num = (v: string | undefined): number => {
      if (v === undefined || v === '') return 0
      const n = Number(v.replace(/[,_\s]/g, ''))
      return Number.isFinite(n) ? n : 0
    }
    const bool = (v: string | undefined): boolean => {
      if (!v) return false
      const t = v.trim().toLowerCase()
      return t === '1' || t === 'true' || t === 'win' || t === 'yes' || t === 'y'
    }

    // Each row = one participant. Map into a shape that mirrors Riot's
    // match-V5 participant object so the synergy aggregator can stay
    // schema-agnostic. We default missing fields to 0 / null.
    const participants = rows.map((row) => {
      const teamRaw = getField(row, 'TEAM', 'teamId', 'team', 'PLAYER_SUBTEAM_ID') ?? '100'
      // Replaybook usually emits 100/200; some tools use 0/1 or "Blue"/"Red".
      const teamNum = Number(teamRaw)
      const teamId = teamNum === 200 || teamRaw.toLowerCase().includes('red') ? 200 : 100
      return {
        playerName: getField(row, 'RIOT_ID_GAME_NAME', 'NAME', 'playerName', 'SUMMONER_NAME', 'summonerName') ?? '',
        riotTagLine: getField(row, 'RIOT_ID_TAG_LINE', 'tagLine'),
        championName: getField(row, 'SKIN', 'championName', 'CHAMPION', 'champion') ?? 'Unknown',
        teamId,
        teamPosition: (getField(row, 'TEAM_POSITION', 'teamPosition', 'INDIVIDUAL_POSITION', 'PLAYER_POSITION', 'position') ?? '').toUpperCase(),
        win: bool(getField(row, 'WIN', 'win', 'won')),
        kills: num(getField(row, 'CHAMPIONS_KILLED', 'kills', 'KILLS')),
        deaths: num(getField(row, 'NUM_DEATHS', 'deaths', 'DEATHS')),
        assists: num(getField(row, 'ASSISTS', 'assists')),
        totalDamageDealtToChampions: num(getField(row, 'TOTAL_DAMAGE_DEALT_TO_CHAMPIONS', 'totalDamageDealtToChampions', 'damageToChampions')),
        totalDamageTaken: num(getField(row, 'TOTAL_DAMAGE_TAKEN', 'totalDamageTaken', 'damageTaken')),
        goldEarned: num(getField(row, 'GOLD_EARNED', 'goldEarned', 'gold')),
        totalMinionsKilled: num(getField(row, 'MINIONS_KILLED', 'totalMinionsKilled', 'cs')),
        neutralMinionsKilled: num(getField(row, 'NEUTRAL_MINIONS_KILLED', 'neutralMinionsKilled')),
        visionScore: num(getField(row, 'VISION_SCORE', 'visionScore')),
        wardsPlaced: num(getField(row, 'WARD_PLACED', 'wardsPlaced')),
        wardsKilled: num(getField(row, 'WARD_KILLED', 'wardsKilled')),
        detectorWardsPurchased: num(getField(row, 'VISION_WARDS_BOUGHT_IN_GAME', 'detectorWardsPurchased', 'controlWards', 'pinkWards')),
        // Stored under the Riot-canonical name so the aggregator picks it
        // up the same way as Riot match data. Replaybook's column is
        // TIME_CCING_OTHERS; older custom rows from earlier imports use
        // totalTimeCCDealt and are handled via fallback in the aggregator.
        timeCCingOthers: num(getField(row, 'TIME_CCING_OTHERS', 'timeCCingOthers', 'TOTAL_TIME_CC_DEALT', 'totalTimeCCDealt', 'TOTAL_TIME_CROWD_CONTROL_DEALT')),
        champExperience: num(getField(row, 'EXP', 'champExperience', 'experience')),
      }
    })

    // Derive game-level metadata from the first participant (TIME_PLAYED is
    // per-player but always equals game duration in standard 5v5).
    const firstRow = rows[0]
    const durationSec = Math.round(num(getField(firstRow, 'TIME_PLAYED', 'gameDuration', 'duration', 'GAME_LENGTH')))
    if (!durationSec || durationSec < 60) {
      throw new Error('Could not determine game duration (TIME_PLAYED column missing or invalid).')
    }

    // Resolve "did our team win?" by matching player names against the team
    // roster (case-insensitive on ign + optional tagLine). The team with the
    // most matched roster members is considered ours.
    const prisma = getPrisma()
    const team = await prisma.team.findUnique({ where: { id: teamId }, include: { members: true } })
    if (!team) throw new Error('Team not found')
    const normName = (s: string | null | undefined) => (s ?? '').trim().toLowerCase()
    const rosterNames = new Set(team.members.flatMap((m) => [normName(m.ign), normName(m.displayName)].filter(Boolean)))
    const blueMatches = participants.filter((p) => p.teamId === 100 && rosterNames.has(normName(p.playerName))).length
    const redMatches = participants.filter((p) => p.teamId === 200 && rosterNames.has(normName(p.playerName))).length
    const ourTeam = blueMatches >= redMatches ? 100 : 200
    const ourPlayer = participants.find((p) => p.teamId === ourTeam && rosterNames.has(normName(p.playerName)))
    const win = ourPlayer ? ourPlayer.win : null

    const customGame = await prisma.customGame.create({
      data: {
        teamId,
        gameType,
        gameDate: null, // ROFL doesn't always expose creation date; null OK
        durationSec,
        win,
        participantsJson: JSON.stringify(participants),
        sourceFile: filename,
      },
    })

    // #41a: shared with the group's players (best effort; the backfill retries an import that failed here).
    let published = false
    const groupId = await customGamesGroupOf(team)
    if (groupId) {
      try {
        await customGamesCore.publishCustomGame(getSupabase(), groupId, customGame)
        published = true
      } catch (err) {
        console.warn('[team] could not publish the custom game to the group:', (err as Error)?.message)
        customGamesBackfilled.delete(teamId)
      }
    }

    return {
      canceled: false as const,
      gameId: customGame.id,
      gameType,
      participants: participants.length,
      filename,
      win,
      published,
    }
  })

  ipcMain.handle('team:list-custom-games', async (_e, teamId: string, gameType?: 'scrim' | 'tournament') => {
    const team = await getPrisma().team.findUnique({ where: { id: teamId }, select: { id: true, groupId: true, isOpponent: true } })
    if (!team) throw new Error('Team not found')
    return customGamesOf(team, gameType)
  })

  // A local game is deleted here and from the group; a group game (`group:<id>`) from the group only (staff).
  // A local id, or `group:<uuid>` for a game shared with the group (teamCustomGamesCore).
  validatedHandle('team:delete-custom-game', z.tuple([z.union([idSchema, z.string().regex(/^group:[0-9a-f-]{36}$/i, 'invalid group game id')])]), async (_e, id) => {
    const prisma = getPrisma()
    if (id.startsWith('group:')) {
      await customGamesCore.deleteGroupCustomGame(getSupabase(), id)
      return { ok: true as const }
    }
    const game = await prisma.customGame.findUnique({ where: { id }, include: { team: { select: { groupId: true, isOpponent: true } } } })
    await prisma.customGame.delete({ where: { id } })
    const groupId = game ? await customGamesGroupOf(game.team) : null
    if (groupId) await customGamesCore.deleteGroupCustomGame(getSupabase(), id, groupId).catch(() => {})
    return { ok: true as const }
  })

  /**
   * Aggregate stats from custom games (scrim/tournament/both) into the same
   * `SynergyPlayerStats` shape as `team:compute-synergy-stats`. Lets the UI
   * reuse the entire StatsTab / DashboardTab layout for custom data.
   *
   * Matching custom-game participants to roster members is by display name /
   * ign (case-insensitive) since custom games don't carry puuids.
   */
  ipcMain.handle('team:compute-custom-stats', async (_e, teamId: string, gameType: 'scrim' | 'tournament' | 'all') => {
    const prisma = getPrisma()
    const team = await prisma.team.findUnique({ where: { id: teamId }, include: { members: true } })
    if (!team) throw new Error('Team not found')

    // #41a: local games plus the group's, so a player gets the games the staff imported.
    const games = await customGamesOf(team, gameType === 'all' ? undefined : gameType)

    return aggregateMatchLike(team, games.map(matchLikeFromCustom))
  })

  /**
   * Combined stats: Riot flex + custom (scrim + tournament). Same shape as
   * the other compute handlers. Caches nothing — UI re-runs on demand.
   */
  handleInBackground('team:compute-combined-stats', async (_e, teamId: string, opts: { minTogether?: number } = {}) => {
    const prisma = getPrisma()
    const team = await prisma.team.findUnique({ where: { id: teamId }, include: { members: true } })
    if (!team) throw new Error('Team not found')

    // Pull custom games — these are full-team games by definition so no
    // minTogether check is needed.
    const customs = await customGamesOf(team)
    const customMatchLike = customs.map(matchLikeFromCustom)

    // Reuse the existing synergy compute path for the flex side by invoking
    // it directly — keeps a single source of truth for the Riot-side logic.
    // We then merge by re-running aggregateMatchLike over the union, which
    // requires us to also pass flex matches through MatchCache.
    // For simplicity, we recompute everything from scratch here using the
    // same aggregator, sourcing flex data through MatchCache when present.
    const minTogether = Math.max(2, opts.minTogether ?? 3)

    // Resolve roster identities (puuid + names)
    const resolvedMembers: Array<{ id: string; displayName: string; ign: string | null; role: string; puuid: string | null; region: string | null }> = team.members.map((m) => ({
      id: m.id, displayName: m.displayName, ign: m.ign, role: m.role, puuid: m.puuid, region: m.region,
    }))

    // Flex side — fetch in the same way as compute-synergy-stats but
    // collect raw match data instead of aggregating immediately.
    // E15: match-id listing parallelized (was sequential per member), and
    // match bodies now go through the shared `getMatchesBulkCached` helper
    // (concurrent + cached) instead of this handler's own one-at-a-time
    // cache-then-fetch loop, which never used the match cache's bulk path
    // at all.
    const matchToPuuids = new Map<string, Set<string>>()
    await Promise.all(resolvedMembers.map(async (m) => {
      if (!m.puuid || !m.region) return
      try {
        indexMatchIds(matchToPuuids, m.puuid, await getMatchIds(m.puuid, m.region, RIOT_LIMITS.SYNERGY_MATCHES_PER_MEMBER, 0, 'flex'))
      } catch (err) {
        console.warn('[combined] match list failed for', m.displayName, err)
      }
    }))
    const candidates = sharedMatchIds(matchToPuuids, minTogether)

    const allMatches = new Map<string, any>()
    for (const [region, ids] of matchIdsByRegion(candidates, matchToPuuids, resolvedMembers)) {
      const fetched = await getMatchesBulkCached(ids, region)
      for (const [id, m] of fetched) allMatches.set(id, m)
    }

    const flexMatchLike = candidates
      .map((id) => matchLikeFromRiot(allMatches.get(id)))
      .filter((m) => m.participants.length > 0 && m.durationSec > 0)

    // The dashboard says what the average is made of.
    const sources = combinedSources(flexMatchLike.length, customs)
    return { ...aggregateMatchLike(team, [...flexMatchLike, ...customMatchLike], minTogether), sources }
  })

}

/**
 * Minimal CSV parser. Handles:
 *   - Quoted fields (double quotes), including escaped quotes ("")
 *   - Commas inside quoted fields
 *   - \r\n or \n line endings
 *   - Empty trailing lines
 * Returns an array of objects keyed by header row, preserving header case.
 */
function parseCsv(text: string): Array<Record<string, string>> {
  const rows: string[][] = []
  let cur: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ }
        else { inQuotes = false }
      } else { field += c }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      cur.push(field); field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      cur.push(field); field = ''
      rows.push(cur); cur = []
    } else {
      field += c
    }
  }
  if (field || cur.length) { cur.push(field); rows.push(cur) }
  // Drop fully-empty rows
  const cleaned = rows.filter((r) => r.some((v) => v !== ''))
  if (cleaned.length < 2) return []
  const headers = cleaned[0]
  return cleaned.slice(1).map((row) => {
    const obj: Record<string, string> = {}
    headers.forEach((h, idx) => { obj[h] = row[idx] ?? '' })
    return obj
  })
}
