/**
 * Team management IPC: rosters, champion pools, draft prep, opponent scouting.
 *
 * All operations are scoped to the currently-active user. Storage is local
 * SQLite via Prisma. Future cloud sync would migrate the underlying store
 * but keep this IPC surface stable.
 */

import { ipcMain, dialog, BrowserWindow } from 'electron'
import { readFileSync, existsSync } from 'node:fs'
import { basename } from 'node:path'
import { getPrisma } from '../database'
import { getMatchIds, getMatch, getAccountByRiotId, getChampionMasteries } from '../riotClient'
import { getChampionIdToKey } from '../dataDragon'
import { championPlaysRole, type Role } from '../../../src/lib/championRoles'

async function getActiveUser() {
  const prisma = getPrisma()
  const user = await prisma.user.findFirst({ where: { isActive: true } })
  if (!user) throw new Error('No active user')
  return user
}

/**
 * Map Riot's match-V5 position names to our internal role enum.
 *
 *   Riot         → Internal (used everywhere in our app: RosterTab,
 *                  ChampPoolTab, ScoutingTab, DraftTab, championRoles.ts)
 *   TOP          → TOP
 *   JUNGLE       → JUNGLE
 *   MIDDLE       → MID
 *   BOTTOM       → ADC
 *   UTILITY      → SUPPORT
 *
 * Without this normalization, the `roleOnly` filter in scout/auto-fill
 * would reject every MID/ADC/SUPPORT game (since "MIDDLE" !== "MID"), and
 * pool entries would be stored with Riot's names, which never match the
 * Draft Sim's PoolSidebar filter that compares against the internal role.
 */
const RIOT_TO_INTERNAL: Record<string, string> = {
  TOP: 'TOP',
  JUNGLE: 'JUNGLE',
  MIDDLE: 'MID',
  BOTTOM: 'ADC',
  UTILITY: 'SUPPORT',
}
function normalizeRole(role: string | null | undefined): string {
  if (!role) return ''
  const upper = role.toUpperCase()
  return RIOT_TO_INTERNAL[upper] ?? upper
}

/**
 * All candidate identity keys for a member, in priority order. We use a
 * progressive matching strategy (puuid → riot id → ign → displayName) so we
 * catch duplicates created at different points in the workflow, e.g. a member
 * added manually without tagLine then re-imported with the full Riot ID.
 *
 * Mirrors the frontend logic in ChampPoolTab.tsx so the visible warning and
 * the cleanup action always agree on what counts as a duplicate.
 */
function identityKeys(m: { id: string; puuid?: string | null; ign?: string | null; tagLine?: string | null; displayName?: string | null }): string[] {
  const norm = (s?: string | null) => (s ?? '').toLowerCase().trim()
  const keys: string[] = []
  if (m.puuid) keys.push(`puuid:${m.puuid}`)
  if (m.ign && m.tagLine) keys.push(`riot:${norm(m.ign)}#${norm(m.tagLine)}`)
  if (m.ign) keys.push(`ign:${norm(m.ign)}`)
  if (m.displayName) keys.push(`name:${norm(m.displayName)}`)
  return keys
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

/**
 * Normalize draft slot payloads to the canonical `string[][]` shape.
 * Accepts:
 *   - undefined        → []
 *   - string[]         (legacy single-pick) → [[c1], [c2], ...]
 *   - string[][]       (new multi-option)   → passed through
 *   - mixed array      → entries that are strings get wrapped
 *
 * Strips empty strings inside slot arrays. Returns ALL slots, even empty
 * ones, so downstream readers see consistent positional indices.
 */
function normalizeSlots(input?: string[][] | string[]): string[][] {
  if (!Array.isArray(input)) return []
  return input.map((slot) => {
    if (Array.isArray(slot)) return slot.filter((c): c is string => typeof c === 'string' && c.length > 0)
    if (typeof slot === 'string') return slot.length > 0 ? [slot] : []
    return []
  })
}

export function registerTeamHandlers() {
  // ── Teams ────────────────────────────────────────────────────────────────

  ipcMain.handle('team:list', async (_e, opts?: { isOpponent?: boolean }) => {
    const prisma = getPrisma()
    const user = await getActiveUser()
    return prisma.team.findMany({
      where: {
        userId: user.id,
        ...(opts && typeof opts.isOpponent === 'boolean' ? { isOpponent: opts.isOpponent } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      include: { members: { include: { champPool: true } } },
    })
  })

  ipcMain.handle('team:get', async (_e, id: string) => {
    const prisma = getPrisma()
    return prisma.team.findUnique({
      where: { id },
      include: { members: { include: { champPool: true } } },
    })
  })

  ipcMain.handle('team:create', async (_e, data: {
    name: string
    tag?: string
    logo?: string
    notes?: string
    isOpponent?: boolean
  }) => {
    const prisma = getPrisma()
    const user = await getActiveUser()
    return prisma.team.create({
      data: { ...data, userId: user.id },
    })
  })

  ipcMain.handle('team:update', async (_e, id: string, data: Partial<{
    name: string
    tag: string | null
    logo: string | null
    notes: string | null
    isOpponent: boolean
    scoutNotes: string | null
  }>) => {
    const prisma = getPrisma()
    return prisma.team.update({ where: { id }, data })
  })

  ipcMain.handle('team:delete', async (_e, id: string) => {
    const prisma = getPrisma()
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

    // Group members by progressive identity matching — each member contributes
    // multiple candidate keys (puuid, ign+tag, ign, displayName). We assign
    // each member to the canonical group of the first earlier member it shares
    // ANY key with; otherwise it starts a new group keyed by its top-priority
    // candidate. This mirrors the frontend detection so the displayed
    // duplicate count matches the cleanup result.
    const keyToCanonical = new Map<string, string>()
    const groups = new Map<string, typeof members>()
    for (const m of members) {
      const candidates = identityKeys(m)
      if (candidates.length === 0) continue // truly anonymous — never merge
      const existingCanonical = candidates.map((c) => keyToCanonical.get(c)).find(Boolean)
      const canonical = existingCanonical ?? candidates[0]
      for (const c of candidates) keyToCanonical.set(c, canonical)
      const arr = groups.get(canonical) ?? []
      arr.push(m)
      groups.set(canonical, arr)
    }

    let removed = 0
    for (const group of groups.values()) {
      if (group.length < 2) continue
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

  ipcMain.handle('team:update-member', async (_e, memberId: string, data: Partial<{
    displayName: string
    ign: string | null
    tagLine: string | null
    region: string | null
    role: string
    puuid: string | null
  }>) => {
    const prisma = getPrisma()
    return prisma.teamMember.update({ where: { id: memberId }, data })
  })

  ipcMain.handle('team:remove-member', async (_e, memberId: string) => {
    const prisma = getPrisma()
    await prisma.teamMember.delete({ where: { id: memberId } })
    return { ok: true }
  })

  // ── Champion pool ────────────────────────────────────────────────────────

  ipcMain.handle('team:pool-list', async (_e, memberId: string) => {
    const prisma = getPrisma()
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

  ipcMain.handle('draft:get', async (_e, id: string) => {
    const prisma = getPrisma()
    return prisma.draftPrep.findUnique({ where: { id }, include: { vsTeam: true } })
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
   * Auto-populates a TeamMember's champion pool by fetching their last N
   * games via the Riot API and aggregating champion plays per role.
   *
   * Requires the member to have `ign` + `tagLine` + `region` set. Returns
   * the number of pool entries created/updated.
   */
  ipcMain.handle('team:scout-member', async (_e, memberId: string, count = 30, opts: { roleOnly?: boolean } = {}) => {
    // Default to role-filtered: scouting an opponent's "TOP laner" should
    // tell us what they pick TOP, not what they flex into ARAM or off-role.
    const roleOnly = opts.roleOnly ?? true
    const prisma = getPrisma()
    const member = await prisma.teamMember.findUnique({ where: { id: memberId } })
    if (!member) throw new Error('Member not found')

    let puuid = member.puuid
    let region = member.region
    if (!puuid) {
      if (!member.ign || !member.tagLine || !member.region) {
        throw new Error('Member needs IGN + tagLine + region to be scouted')
      }
      const acct = await getAccountByRiotId(member.ign, member.tagLine, member.region)
      if (!acct?.puuid) throw new Error('Could not resolve Riot account')
      puuid = acct.puuid
      region = member.region
      await prisma.teamMember.update({ where: { id: memberId }, data: { puuid } })
    }
    if (!region) throw new Error('Region missing')

    // When filtering by role we widen the match window since many games will
    // be discarded (e.g. autofills, ARAM, off-role flex). 50 games typically
    // yields 25-40 same-role games for a primary-role main.
    const fetchCount = roleOnly ? Math.min(count * 2, 50) : Math.min(count, 50)
    const matchIds = await getMatchIds(puuid, region, fetchCount, 0, 'both')
    if (matchIds.length === 0) return { upserted: 0, totalMatches: 0, sameRoleCount: 0 }

    const memberRole = (member.role || '').toUpperCase()
    let sameRoleCount = 0

    // Aggregate champion plays per role
    const playCount = new Map<string, { championKey: string; role: string; count: number; wins: number }>()
    const results = await Promise.allSettled(
      matchIds.map(async (id) => {
        const match = await getMatch(id, region!)
        const participant = match?.info?.participants?.find((p: any) => p.puuid === puuid)
        if (!participant) return
        // Normalize Riot's MIDDLE/BOTTOM/UTILITY → MID/ADC/SUPPORT so the
        // role filter and stored entries use the same vocabulary as the rest
        // of the app (RosterTab, ChampPoolTab, Draft Sim's PoolSidebar).
        const role = normalizeRole(participant.teamPosition || participant.individualPosition)
        if (!role || role === 'UNKNOWN' || role === 'INVALID' || role === 'NONE') return
        // Skip games where the player wasn't on their assigned role. This is
        // why we widened fetchCount above.
        if (roleOnly && memberRole && role !== memberRole) return
        sameRoleCount++
        const key = `${participant.championName}|${role}`
        const existing = playCount.get(key)
        if (existing) {
          existing.count++
          if (participant.win) existing.wins++
        } else {
          playCount.set(key, {
            championKey: participant.championName,
            role,
            count: 1,
            wins: participant.win ? 1 : 0,
          })
        }
      }),
    )
    const failed = results.filter((r) => r.status === 'rejected').length
    if (failed > 0) console.warn(`[team:scout-member] ${failed}/${matchIds.length} matches failed to fetch`)

    // Cleanup pass. Removes:
    //   1. Pre-normalization entries with raw Riot role names
    //      (MIDDLE/BOTTOM/UTILITY) regardless of mode — these are dead data
    //      that the Draft Sim's PoolSidebar can never display anyway.
    //   2. When roleOnly is on, any previously-auto-scouted entry that no
    //      longer appears in the fresh scan — keeps the pool tight to the
    //      member's current meta.
    // Manual entries (playRate=null) are always preserved.
    const newKeys = new Set(Array.from(playCount.values()).map((e) => `${e.championKey}|${e.role}`))
    const existing = await prisma.championPoolEntry.findMany({
      where: { memberId, playRate: { not: null } },
    })
    const toDelete = existing.filter((e) => {
      const isRawRiotRole = e.role === 'MIDDLE' || e.role === 'BOTTOM' || e.role === 'UTILITY'
      if (isRawRiotRole) return true
      if (roleOnly && !newKeys.has(`${e.championKey}|${e.role}`)) return true
      return false
    })
    if (toDelete.length > 0) {
      await prisma.championPoolEntry.deleteMany({
        where: { id: { in: toDelete.map((e) => e.id) } },
      })
      console.log(`[team:scout-member] cleaned ${toDelete.length} stale entries for ${member.displayName}`)
    }

    let upserted = 0
    for (const entry of playCount.values()) {
      // Use the same tier rules as auto-fill-pool to keep scouting consistent
      // with the player's own pool view in the Champion Pool tab.
      const tier =
        entry.count >= 5 ? 'main'
        : entry.count >= 3 ? 'comfort'
        : 'flex'
      const winRate = Math.round((entry.wins / entry.count) * 100)
      await prisma.championPoolEntry.upsert({
        where: { memberId_championKey_role: { memberId, championKey: entry.championKey, role: entry.role } },
        create: {
          memberId,
          championKey: entry.championKey,
          role: entry.role,
          tier,
          playRate: entry.count,
          winRate,
        },
        update: { playRate: entry.count, winRate },
      })
      upserted++
    }

    return { upserted, totalMatches: matchIds.length, sameRoleCount }
  })

  /**
   * Full auto-fill of a member's champion pool: combines mastery points
   * (long-term skill signal) with recent match history (current meta /
   * season picks). Smarter than `scout-member` for your own roster since
   * it considers both lifetime mastery and current play patterns.
   *
   * Tier classification (per champion+role):
   *   main     = 5+ recent plays OR 500k+ mastery
   *   comfort  = 3+ recent plays OR 100k+ mastery
   *   flex     = 1+ recent play   OR 30k+ mastery
   *   learning = mastery only, < 30k points
   *
   * Mastery-only champions (no recent games) are bucketed into the member's
   * primary role since the API doesn't tie mastery to a role.
   *
   * Existing entries with `pinnedTier` (set manually by the user) are
   * preserved — auto-fill only refreshes the playRate/winRate fields for
   * those, never overriding a user's deliberate classification.
   */
  ipcMain.handle('team:auto-fill-pool', async (_e, memberId: string, opts: {
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
    // We fetch enough matches to make the "50 games on a champ" comfort
    // threshold actually reachable for one-tricks. Riot caps each call at
    // 100 but `getMatchIds` queries SoloQ + Flex in parallel and merges, so
    // the effective ceiling is ~150–200 unique matches — plenty for season
    // coverage on active players.
    const matchCount = Math.min(opts.matchCount ?? 100, 100)
    const masteryCount = Math.min(opts.masteryCount ?? 30, 50)
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

    // Fetch mastery + match list in parallel — these are independent calls
    // and the API has plenty of headroom for both at once.
    const [matchIds, masteries, idToKey] = await Promise.all([
      getMatchIds(puuid, region, matchCount, 0, 'both').catch((err) => {
        console.warn('[auto-fill] match list failed:', err.message)
        return [] as string[]
      }),
      getChampionMasteries(puuid, region, masteryCount).catch((err) => {
        console.warn('[auto-fill] mastery failed:', err.message)
        return [] as Awaited<ReturnType<typeof getChampionMasteries>>
      }),
      getChampionIdToKey(),
    ])

    // Aggregate match data per (championKey, role)
    interface Agg {
      championKey: string
      role: string
      count: number
      wins: number
      masteryPoints: number
    }
    const agg = new Map<string, Agg>()

    if (matchIds.length > 0) {
      const matchResults = await Promise.allSettled(
        matchIds.map(async (id) => {
          const match = await getMatch(id, region)
          const participant = match?.info?.participants?.find((p: any) => p.puuid === puuid)
          if (!participant) return
          // Normalize Riot's MIDDLE/BOTTOM/UTILITY → MID/ADC/SUPPORT so the
          // filter and storage agree with the rest of the app's role enum.
          const role = normalizeRole(participant.teamPosition || participant.individualPosition)
          if (!role || role === 'UNKNOWN' || role === 'INVALID' || role === 'NONE') return
          // Same-role filter — see roleOnly docstring above.
          if (roleOnly && memberRole && role !== memberRole) return
          const key = `${participant.championName}|${role}`
          const existing = agg.get(key)
          if (existing) {
            existing.count++
            if (participant.win) existing.wins++
          } else {
            agg.set(key, {
              championKey: participant.championName,
              role,
              count: 1,
              wins: participant.win ? 1 : 0,
              masteryPoints: 0,
            })
          }
        }),
      )
      const failed = matchResults.filter((r) => r.status === 'rejected').length
      if (failed > 0) console.warn(`[auto-fill] ${failed}/${matchIds.length} matches failed`)
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
        for (const c of candidates) c.masteryPoints = Math.max(c.masteryPoints, m.championPoints)
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
        })
      }
    }

    if (agg.size === 0) {
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

    // Pre-compute top-5 most-played in the primary role for the "main" tier.
    // We only consider entries with >=1 actual game so a 0-count mastery-only
    // entry can't sneak into top-5 just because the player has very few
    // played champions.
    const top5InRole = new Set(
      Array.from(agg.values())
        .filter((e) => e.role === primaryRole && e.count > 0)
        .sort((a, b) => b.count - a.count)
        .slice(0, 5)
        .map((e) => e.championKey),
    )

    let upserted = 0
    for (const entry of agg.values()) {
      // Tier rules (per user spec):
      //   main    : top-5 most-played in role OR mastery >= 300k
      //   comfort : mastery >= 200k OR games >= 50 (SoloQ + Flex combined)
      //   flex    : everything else (low mastery + low games)
      // "learning" is kept as a manual-only tier; auto-fill never assigns it.
      // Note: match history queries SoloQ (420) + Flex (440) already, so the
      // "50 games" threshold covers both queues out of the box.
      let tier: string
      if (top5InRole.has(entry.championKey) || entry.masteryPoints >= 300_000) tier = 'main'
      else if (entry.masteryPoints >= 200_000 || entry.count >= 50) tier = 'comfort'
      else tier = 'flex'

      const winRate = entry.count > 0 ? Math.round((entry.wins / entry.count) * 100) : null

      // Find existing to preserve manual tier if overwriteTiers is false
      const existing = await prisma.championPoolEntry.findUnique({
        where: { memberId_championKey_role: { memberId, championKey: entry.championKey, role: entry.role } },
      })

      // playRate doubles as our "auto-fill provenance" marker for the
      // cleanup pass above — manual adds keep it `null`, auto-fill always
      // writes a number (even 0 for mastery-only entries). Don't change
      // this to `entry.count || null` or stale mastery-only entries would
      // be misclassified as manual and survive forever.
      await prisma.championPoolEntry.upsert({
        where: { memberId_championKey_role: { memberId, championKey: entry.championKey, role: entry.role } },
        create: {
          memberId,
          championKey: entry.championKey,
          role: entry.role,
          tier,
          playRate: entry.count,
          winRate,
        },
        update: {
          ...(overwriteTiers || !existing ? { tier } : {}),
          playRate: entry.count,
          winRate: winRate ?? existing?.winRate ?? null,
        },
      })
      upserted++
    }

    return {
      upserted,
      matchesUsed: matchIds.length,
      masteriesUsed: masteries.length,
    }
  })

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
  ipcMain.handle('team:compute-synergy-stats', async (_e, teamId: string, opts: {
    matchesPerMember?: number
    minTogether?: number
  } = {}) => {
    const matchesPerMember = Math.min(opts.matchesPerMember ?? 100, 100)
    const minTogether = Math.max(2, opts.minTogether ?? 3)

    const prisma = getPrisma()
    const team = await prisma.team.findUnique({
      where: { id: teamId },
      include: { members: true },
    })
    if (!team) throw new Error('Team not found')

    // Step 1 — resolve PUUIDs for every member possible
    const resolvedMembers: Array<{ id: string; displayName: string; role: string; puuid: string; region: string }> = []
    for (const m of team.members) {
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
      if (puuid && region) {
        resolvedMembers.push({ id: m.id, displayName: m.displayName, role: m.role, puuid, region })
      }
    }
    if (resolvedMembers.length < minTogether) {
      throw new Error(`Need at least ${minTogether} members with a resolved Riot ID — currently ${resolvedMembers.length}.`)
    }

    // Step 2 — fetch every member's flex match list (queue 440 only)
    const puuidToMember = new Map(resolvedMembers.map((m) => [m.puuid, m]))
    const matchToPuuids = new Map<string, Set<string>>()
    for (const m of resolvedMembers) {
      try {
        const ids = await getMatchIds(m.puuid, m.region, matchesPerMember, 0, 'flex')
        for (const id of ids) {
          const set = matchToPuuids.get(id) ?? new Set<string>()
          set.add(m.puuid)
          matchToPuuids.set(id, set)
        }
      } catch (err) {
        console.warn('[synergy] match list failed for', m.displayName, err)
      }
    }

    // Pre-filter on appearances. Match-list presence is cheap; we still need a
    // full fetch to confirm same-team and get stats, but this trims by ~70%.
    const candidateMatchIds = Array.from(matchToPuuids.entries())
      .filter(([, puuids]) => puuids.size >= minTogether)
      .map(([id]) => id)

    if (candidateMatchIds.length === 0) {
      return {
        matchCount: 0,
        membersPresent: [],
        players: [],
        fetchedAt: Date.now(),
      }
    }

    // Step 3 + 4 — fetch each match (via cache) and confirm same-team synergy
    // Per-member accumulators
    interface Accum {
      memberId: string
      displayName: string
      role: string
      games: number
      wins: number
      sums: {
        kills: number; deaths: number; assists: number
        cs: number; durationMin: number
        damage: number; damageTaken: number
        ccTime: number; visionScore: number
        wardsPlaced: number; wardsKilled: number; controlWards: number
        gold: number; xp: number
      }
      // Kept separate because shares require per-match relative arithmetic
      // (each game's share, averaged) rather than a sum-then-divide.
      shareSums: { dmg: number; gold: number; vision: number; dmgTaken: number; cc: number; kp: number }
      // championKey → { games, wins }
      byChampion: Map<string, { games: number; wins: number }>
    }
    const accums = new Map<string, Accum>()
    for (const m of resolvedMembers) {
      accums.set(m.puuid, {
        memberId: m.id,
        displayName: m.displayName,
        role: m.role,
        games: 0,
        wins: 0,
        sums: { kills: 0, deaths: 0, assists: 0, cs: 0, durationMin: 0, damage: 0, damageTaken: 0, ccTime: 0, visionScore: 0, wardsPlaced: 0, wardsKilled: 0, controlWards: 0, gold: 0, xp: 0 },
        shareSums: { dmg: 0, gold: 0, vision: 0, dmgTaken: 0, cc: 0, kp: 0 },
        byChampion: new Map(),
      })
    }

    let confirmedMatchCount = 0
    for (const matchId of candidateMatchIds) {
      let matchData: any = null
      try {
        const cached = await prisma.matchCache.findUnique({ where: { matchId } })
        if (cached?.matchJson) {
          matchData = JSON.parse(cached.matchJson)
        } else {
          // Fetch using the region of any member who appeared in this match
          const seeder = puuidToMember.get(Array.from(matchToPuuids.get(matchId)!)[0])!
          matchData = await getMatch(matchId, seeder.region)
          if (matchData) {
            await prisma.matchCache.upsert({
              where: { matchId },
              create: { matchId, matchJson: JSON.stringify(matchData) },
              update: { matchJson: JSON.stringify(matchData) },
            })
          }
        }
      } catch (err) {
        console.warn('[synergy] match fetch failed for', matchId, err)
        continue
      }

      const participants: any[] = matchData?.info?.participants ?? []
      const durationSec: number = matchData?.info?.gameDuration ?? 0
      if (!participants.length || durationSec <= 0) continue
      const durationMin = durationSec / 60

      // Group participants by team (100 = blue, 200 = red), then find the
      // team containing the majority of our roster PUUIDs.
      const byTeam: Record<number, any[]> = { 100: [], 200: [] }
      for (const p of participants) {
        if (p.teamId === 100 || p.teamId === 200) byTeam[p.teamId].push(p)
      }
      const ourTeamId = ([100, 200] as const).find((tid) => {
        const ours = byTeam[tid].filter((p) => puuidToMember.has(p.puuid)).length
        return ours >= minTogether
      })
      if (!ourTeamId) continue // members were present but on opposite teams — not synergy

      const ourSide = byTeam[ourTeamId]
      const ourMembersInGame = ourSide.filter((p) => puuidToMember.has(p.puuid))

      // Team totals for share calculations. teamKills powers kill-participation
      // (KP = (player kills + assists) / team kills), the others are simple
      // % shares of the team's resource pie.
      const teamTotals = {
        dmg: ourSide.reduce((s, p) => s + (p.totalDamageDealtToChampions ?? 0), 0),
        gold: ourSide.reduce((s, p) => s + (p.goldEarned ?? 0), 0),
        vision: ourSide.reduce((s, p) => s + (p.visionScore ?? 0), 0),
        dmgTaken: ourSide.reduce((s, p) => s + (p.totalDamageTaken ?? 0), 0),
        // CC score = the number shown on the end-of-game screen.
        // Riot's match-V5 exposes it as `timeCCingOthers` (an integer
        // number of "CC seconds dealt to enemy champions"). Fall back to
        // `totalTimeCCDealt` for backwards compat with custom games
        // imported before we standardised on the post-game label.
        cc: ourSide.reduce((s, p) => s + (p.timeCCingOthers ?? p.totalTimeCCDealt ?? 0), 0),
        kills: ourSide.reduce((s, p) => s + (p.kills ?? 0), 0),
      }

      confirmedMatchCount++
      for (const p of ourMembersInGame) {
        const acc = accums.get(p.puuid)!
        // Per-role filter: skip this player's contribution when they played
        // off-role in this match. The match still counts as a synergy game
        // (so other on-role teammates' stats are accumulated), but Ayura's
        // SUPPORT games don't pollute her MID averages, etc. We normalize
        // Riot's MIDDLE/BOTTOM/UTILITY to match our internal role enum.
        const playedRole = normalizeRole(p.teamPosition || p.individualPosition)
        const assignedRole = (acc.role || '').toUpperCase()
        if (assignedRole && playedRole && playedRole !== assignedRole) continue
        acc.games++
        if (p.win) acc.wins++
        const cs = (p.totalMinionsKilled ?? 0) + (p.neutralMinionsKilled ?? 0)
        acc.sums.kills += p.kills ?? 0
        acc.sums.deaths += p.deaths ?? 0
        acc.sums.assists += p.assists ?? 0
        acc.sums.cs += cs
        acc.sums.durationMin += durationMin
        acc.sums.damage += p.totalDamageDealtToChampions ?? 0
        acc.sums.damageTaken += p.totalDamageTaken ?? 0
        acc.sums.ccTime += p.timeCCingOthers ?? p.totalTimeCCDealt ?? 0
        acc.sums.visionScore += p.visionScore ?? 0
        acc.sums.wardsPlaced += p.wardsPlaced ?? 0
        acc.sums.wardsKilled += p.wardsKilled ?? 0
        acc.sums.controlWards += p.detectorWardsPurchased ?? p.visionWardsBoughtInGame ?? 0
        acc.sums.gold += p.goldEarned ?? 0
        acc.sums.xp += p.champExperience ?? 0
        // Shares (clamped to avoid div-by-zero pollution). KP is computed
        // against teamKills + 1 instead of teamKills alone so a player with
        // 0 kills/assists in a 0-kill team gets 0 KP, not NaN.
        acc.shareSums.dmg += teamTotals.dmg > 0 ? (p.totalDamageDealtToChampions ?? 0) / teamTotals.dmg : 0
        acc.shareSums.gold += teamTotals.gold > 0 ? (p.goldEarned ?? 0) / teamTotals.gold : 0
        acc.shareSums.vision += teamTotals.vision > 0 ? (p.visionScore ?? 0) / teamTotals.vision : 0
        acc.shareSums.dmgTaken += teamTotals.dmgTaken > 0 ? (p.totalDamageTaken ?? 0) / teamTotals.dmgTaken : 0
        acc.shareSums.cc += teamTotals.cc > 0 ? ((p.timeCCingOthers ?? p.totalTimeCCDealt ?? 0)) / teamTotals.cc : 0
        acc.shareSums.kp += teamTotals.kills > 0 ? ((p.kills ?? 0) + (p.assists ?? 0)) / teamTotals.kills : 0
        // Per-champion breakdown
        const champKey = p.championName ?? 'Unknown'
        const champ = acc.byChampion.get(champKey) ?? { games: 0, wins: 0 }
        champ.games++
        if (p.win) champ.wins++
        acc.byChampion.set(champKey, champ)
      }
    }

    // Step 5 — finalize: averages over each player's own participation count
    const players = Array.from(accums.values())
      .filter((a) => a.games > 0)
      .map((a) => {
        const g = a.games
        const dmin = Math.max(0.001, a.sums.durationMin)
        return {
          memberId: a.memberId,
          displayName: a.displayName,
          role: a.role,
          gamesPlayed: a.games,
          wins: a.wins,
          winRate: Math.round((a.wins / g) * 100),
          averages: {
            kda: a.sums.deaths > 0 ? (a.sums.kills + a.sums.assists) / a.sums.deaths : a.sums.kills + a.sums.assists,
            kills: a.sums.kills / g,
            deaths: a.sums.deaths / g,
            assists: a.sums.assists / g,
            cs: a.sums.cs / g,
            csPerMin: a.sums.cs / dmin,
            damage: a.sums.damage / g,
            damagePerMin: a.sums.damage / dmin,
            damageTaken: a.sums.damageTaken / g,
            ccTime: a.sums.ccTime / g,
            visionScore: a.sums.visionScore / g,
            wardsPlaced: a.sums.wardsPlaced / g,
            wardsKilled: a.sums.wardsKilled / g,
            controlWards: a.sums.controlWards / g,
            gold: a.sums.gold / g,
            goldPerMin: a.sums.gold / dmin,
            xpPerMin: a.sums.xp / dmin,
            // Efficiency: damage produced per gold earned. Gives a quick
            // read on how cost-effective a player's damage output is —
            // typically higher for casters/ADCs, lower for tanks.
            damagePerGold: a.sums.gold > 0 ? a.sums.damage / a.sums.gold : 0,
          },
          shares: {
            damagePct: (a.shareSums.dmg / g) * 100,
            goldPct: (a.shareSums.gold / g) * 100,
            visionPct: (a.shareSums.vision / g) * 100,
            damageTakenPct: (a.shareSums.dmgTaken / g) * 100,
            ccPct: (a.shareSums.cc / g) * 100,
            kpPct: (a.shareSums.kp / g) * 100,
          },
          byChampion: Array.from(a.byChampion.entries())
            .map(([championKey, v]) => ({
              championKey,
              games: v.games,
              wins: v.wins,
              winRate: Math.round((v.wins / v.games) * 100),
            }))
            .sort((x, y) => y.games - x.games),
        }
      })

    return {
      matchCount: confirmedMatchCount,
      candidateCount: candidateMatchIds.length,
      membersResolved: resolvedMembers.length,
      membersWithGames: players.length,
      players,
      fetchedAt: Date.now(),
    }
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
    const normName = (s: string | undefined) => (s ?? '').trim().toLowerCase()
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

    return {
      canceled: false as const,
      gameId: customGame.id,
      gameType,
      participants: participants.length,
      filename,
      win,
    }
  })

  ipcMain.handle('team:list-custom-games', async (_e, teamId: string, gameType?: 'scrim' | 'tournament') => {
    const prisma = getPrisma()
    return prisma.customGame.findMany({
      where: { teamId, ...(gameType ? { gameType } : {}) },
      orderBy: { importedAt: 'desc' },
    })
  })

  ipcMain.handle('team:delete-custom-game', async (_e, id: string) => {
    const prisma = getPrisma()
    await prisma.customGame.delete({ where: { id } })
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

    const games = await prisma.customGame.findMany({
      where: { teamId, ...(gameType === 'all' ? {} : { gameType }) },
    })

    // Build match-like objects compatible with the synergy aggregator
    const matchLike = games.map((g) => ({
      durationSec: g.durationSec,
      participants: JSON.parse(g.participantsJson) as Array<Record<string, any>>,
    }))

    return aggregateMatchLike(team, matchLike)
  })

  /**
   * Combined stats: Riot flex + custom (scrim + tournament). Same shape as
   * the other compute handlers. Caches nothing — UI re-runs on demand.
   */
  ipcMain.handle('team:compute-combined-stats', async (_e, teamId: string, opts: { minTogether?: number } = {}) => {
    const prisma = getPrisma()
    const team = await prisma.team.findUnique({ where: { id: teamId }, include: { members: true } })
    if (!team) throw new Error('Team not found')

    // Pull custom games — these are full-team games by definition so no
    // minTogether check is needed.
    const customs = await prisma.customGame.findMany({ where: { teamId } })
    const customMatchLike = customs.map((g) => ({
      durationSec: g.durationSec,
      participants: JSON.parse(g.participantsJson) as Array<Record<string, any>>,
    }))

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
    const matchToPuuids = new Map<string, Set<string>>()
    for (const m of resolvedMembers) {
      if (!m.puuid || !m.region) continue
      try {
        const ids = await getMatchIds(m.puuid, m.region, 100, 0, 'flex')
        for (const id of ids) {
          const set = matchToPuuids.get(id) ?? new Set<string>()
          set.add(m.puuid)
          matchToPuuids.set(id, set)
        }
      } catch (err) {
        console.warn('[combined] match list failed for', m.displayName, err)
      }
    }
    const candidates = Array.from(matchToPuuids.entries())
      .filter(([, p]) => p.size >= minTogether)
      .map(([id]) => id)

    const flexMatchLike: Array<{ durationSec: number; participants: any[] }> = []
    for (const matchId of candidates) {
      try {
        const cached = await prisma.matchCache.findUnique({ where: { matchId } })
        let matchData: any
        if (cached?.matchJson) {
          matchData = JSON.parse(cached.matchJson)
        } else {
          const seederPuuid = Array.from(matchToPuuids.get(matchId)!)[0]
          const seeder = resolvedMembers.find((m) => m.puuid === seederPuuid)
          if (!seeder?.region) continue
          matchData = await getMatch(matchId, seeder.region)
          if (matchData) {
            await prisma.matchCache.upsert({
              where: { matchId },
              create: { matchId, matchJson: JSON.stringify(matchData) },
              update: { matchJson: JSON.stringify(matchData) },
            })
          }
        }
        const participants: any[] = matchData?.info?.participants ?? []
        const durationSec: number = matchData?.info?.gameDuration ?? 0
        if (participants.length && durationSec > 0) {
          flexMatchLike.push({ durationSec, participants })
        }
      } catch (err) {
        console.warn('[combined] match fetch failed for', matchId, err)
      }
    }

    return aggregateMatchLike(team, [...flexMatchLike, ...customMatchLike], minTogether)
  })
}

/**
 * Generic per-team aggregator. Consumes match-like objects (Riot match-V5
 * shape OR our custom-game participant shape) and produces the same
 * `SynergyPlayerStats[]` payload regardless of source.
 *
 * Roster members are matched by:
 *   - `puuid` for Riot matches (most reliable)
 *   - case-insensitive `ign` / `displayName` for custom games (no puuid)
 */
function aggregateMatchLike(
  team: { id: string; members: Array<{ id: string; displayName: string; ign: string | null; role: string; puuid: string | null }> },
  matches: Array<{ durationSec: number; participants: any[] }>,
  minTogether: number = 1,
) {
  const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase()
  const memberByPuuid = new Map<string, typeof team.members[0]>()
  const memberByName = new Map<string, typeof team.members[0]>()
  for (const m of team.members) {
    if (m.puuid) memberByPuuid.set(m.puuid, m)
    if (m.ign) memberByName.set(norm(m.ign), m)
    if (m.displayName) memberByName.set(norm(m.displayName), m)
  }
  const matchMember = (p: any) => {
    if (p.puuid && memberByPuuid.has(p.puuid)) return memberByPuuid.get(p.puuid)
    if (p.playerName && memberByName.has(norm(p.playerName))) return memberByName.get(norm(p.playerName))
    return undefined
  }

  // Accumulator mirroring the synergy handler's structure
  interface Accum {
    memberId: string; displayName: string; role: string
    games: number; wins: number
    sums: { kills: number; deaths: number; assists: number; cs: number; durationMin: number; damage: number; damageTaken: number; ccTime: number; visionScore: number; wardsPlaced: number; wardsKilled: number; controlWards: number; gold: number; xp: number }
    shareSums: { dmg: number; gold: number; vision: number; dmgTaken: number; cc: number; kp: number }
    byChampion: Map<string, { games: number; wins: number }>
  }
  const accums = new Map<string, Accum>()
  for (const m of team.members) {
    accums.set(m.id, {
      memberId: m.id, displayName: m.displayName, role: m.role,
      games: 0, wins: 0,
      sums: { kills: 0, deaths: 0, assists: 0, cs: 0, durationMin: 0, damage: 0, damageTaken: 0, ccTime: 0, visionScore: 0, wardsPlaced: 0, wardsKilled: 0, controlWards: 0, gold: 0, xp: 0 },
      shareSums: { dmg: 0, gold: 0, vision: 0, dmgTaken: 0, cc: 0, kp: 0 },
      byChampion: new Map(),
    })
  }

  let matchCount = 0
  for (const match of matches) {
    const participants = match.participants
    const durationSec = match.durationSec
    if (!participants?.length || durationSec <= 0) continue
    const durationMin = durationSec / 60

    // Group by team
    const byTeam: Record<number, any[]> = { 100: [], 200: [] }
    for (const p of participants) {
      if (p.teamId === 100 || p.teamId === 200) byTeam[p.teamId].push(p)
    }
    const ourTeamId = ([100, 200] as const).find((tid) => byTeam[tid].filter(matchMember).length >= minTogether)
    if (!ourTeamId) continue
    const ourSide = byTeam[ourTeamId]

    const teamTotals = {
      dmg: ourSide.reduce((s, p) => s + (p.totalDamageDealtToChampions ?? 0), 0),
      gold: ourSide.reduce((s, p) => s + (p.goldEarned ?? 0), 0),
      vision: ourSide.reduce((s, p) => s + (p.visionScore ?? 0), 0),
      dmgTaken: ourSide.reduce((s, p) => s + (p.totalDamageTaken ?? 0), 0),
      cc: ourSide.reduce((s, p) => s + (p.timeCCingOthers ?? p.totalTimeCCDealt ?? 0), 0),
      kills: ourSide.reduce((s, p) => s + (p.kills ?? 0), 0),
    }

    matchCount++
    for (const p of ourSide) {
      const member = matchMember(p)
      if (!member) continue
      const acc = accums.get(member.id)!
      // Per-role filter (same as synergy handler)
      const playedRole = normalizeRole(p.teamPosition || p.individualPosition)
      const assignedRole = (acc.role || '').toUpperCase()
      if (assignedRole && playedRole && playedRole !== assignedRole) continue
      acc.games++
      if (p.win) acc.wins++
      const cs = (p.totalMinionsKilled ?? 0) + (p.neutralMinionsKilled ?? 0)
      acc.sums.kills += p.kills ?? 0
      acc.sums.deaths += p.deaths ?? 0
      acc.sums.assists += p.assists ?? 0
      acc.sums.cs += cs
      acc.sums.durationMin += durationMin
      acc.sums.damage += p.totalDamageDealtToChampions ?? 0
      acc.sums.damageTaken += p.totalDamageTaken ?? 0
      acc.sums.ccTime += p.timeCCingOthers ?? p.totalTimeCCDealt ?? 0
      acc.sums.visionScore += p.visionScore ?? 0
      acc.sums.wardsPlaced += p.wardsPlaced ?? 0
      acc.sums.wardsKilled += p.wardsKilled ?? 0
      acc.sums.controlWards += p.detectorWardsPurchased ?? p.visionWardsBoughtInGame ?? 0
      acc.sums.gold += p.goldEarned ?? 0
      acc.sums.xp += p.champExperience ?? 0
      acc.shareSums.dmg += teamTotals.dmg > 0 ? (p.totalDamageDealtToChampions ?? 0) / teamTotals.dmg : 0
      acc.shareSums.gold += teamTotals.gold > 0 ? (p.goldEarned ?? 0) / teamTotals.gold : 0
      acc.shareSums.vision += teamTotals.vision > 0 ? (p.visionScore ?? 0) / teamTotals.vision : 0
      acc.shareSums.dmgTaken += teamTotals.dmgTaken > 0 ? (p.totalDamageTaken ?? 0) / teamTotals.dmgTaken : 0
      acc.shareSums.cc += teamTotals.cc > 0 ? ((p.timeCCingOthers ?? p.totalTimeCCDealt ?? 0)) / teamTotals.cc : 0
      acc.shareSums.kp += teamTotals.kills > 0 ? ((p.kills ?? 0) + (p.assists ?? 0)) / teamTotals.kills : 0
      const champKey = p.championName ?? 'Unknown'
      const champ = acc.byChampion.get(champKey) ?? { games: 0, wins: 0 }
      champ.games++
      if (p.win) champ.wins++
      acc.byChampion.set(champKey, champ)
    }
  }

  const players = Array.from(accums.values())
    .filter((a) => a.games > 0)
    .map((a) => {
      const g = a.games
      const dmin = Math.max(0.001, a.sums.durationMin)
      return {
        memberId: a.memberId,
        displayName: a.displayName,
        role: a.role,
        gamesPlayed: a.games,
        wins: a.wins,
        winRate: Math.round((a.wins / g) * 100),
        averages: {
          kda: a.sums.deaths > 0 ? (a.sums.kills + a.sums.assists) / a.sums.deaths : a.sums.kills + a.sums.assists,
          kills: a.sums.kills / g,
          deaths: a.sums.deaths / g,
          assists: a.sums.assists / g,
          cs: a.sums.cs / g,
          csPerMin: a.sums.cs / dmin,
          damage: a.sums.damage / g,
          damagePerMin: a.sums.damage / dmin,
          damageTaken: a.sums.damageTaken / g,
          ccTime: a.sums.ccTime / g,
          visionScore: a.sums.visionScore / g,
          wardsPlaced: a.sums.wardsPlaced / g,
          wardsKilled: a.sums.wardsKilled / g,
          controlWards: a.sums.controlWards / g,
          gold: a.sums.gold / g,
          goldPerMin: a.sums.gold / dmin,
          xpPerMin: a.sums.xp / dmin,
          damagePerGold: a.sums.gold > 0 ? a.sums.damage / a.sums.gold : 0,
        },
        shares: {
          damagePct: (a.shareSums.dmg / g) * 100,
          goldPct: (a.shareSums.gold / g) * 100,
          visionPct: (a.shareSums.vision / g) * 100,
          damageTakenPct: (a.shareSums.dmgTaken / g) * 100,
          ccPct: (a.shareSums.cc / g) * 100,
          kpPct: (a.shareSums.kp / g) * 100,
        },
        byChampion: Array.from(a.byChampion.entries())
          .map(([championKey, v]) => ({ championKey, games: v.games, wins: v.wins, winRate: Math.round((v.wins / v.games) * 100) }))
          .sort((x, y) => y.games - x.games),
      }
    })

  return {
    matchCount,
    candidateCount: matches.length,
    membersResolved: team.members.length,
    membersWithGames: players.length,
    players,
    fetchedAt: Date.now(),
  }
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
