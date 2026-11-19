import { normalizeRole } from './teamIdentity'

/**
 * Pure champion-play aggregation shared by the web's scout/auto-fill flow
 * (web/src/scoutingWeb.ts, E14). Desktop's own aggregation loops
 * (electron/main/ipc/team.ipc.ts scout-member / auto-fill-pool) pre-date
 * this file and aren't refactored to use it — they're shipped, tested
 * (E12) code, and the risk of touching them isn't worth it just to share
 * ~20 lines of loop body. Both implementations must stay logically
 * equivalent; see team.ipc.ts's doc comments for the reference behavior.
 */

export interface MatchParticipantSlim {
  championName: string
  teamPosition?: string | null
  individualPosition?: string | null
  win: boolean
  kills?: number
  deaths?: number
  assists?: number
}

export interface ChampionAgg {
  championKey: string
  role: string
  count: number
  wins: number
  kills: number
  deaths: number
  assists: number
  /** Lifetime mastery points, attached separately (see attachMastery). */
  masteryPoints: number
  /** First and last analysed game on this champion in this role (ms), when
   *  the match payloads carry a time — they feed the tier rule's recency. */
  firstAt?: number | null
  lastAt?: number | null
}

/** Start time of a match-v5 game (ms), null when the payload has none. */
export function matchStartOf(match: any): number | null {
  const info = match?.info
  const t = info?.gameStartTimestamp ?? info?.gameCreation ?? info?.gameEndTimestamp
  return typeof t === 'number' && t > 0 ? t : null
}

/** Extracts the participant matching `puuid` from a raw match-v5 payload, or null. */
export function participantFor(match: any, puuid: string): MatchParticipantSlim | null {
  const p = match?.info?.participants?.find((x: any) => x.puuid === puuid)
  if (!p) return null
  return {
    championName: p.championName, teamPosition: p.teamPosition, individualPosition: p.individualPosition,
    win: !!p.win, kills: p.kills, deaths: p.deaths, assists: p.assists,
  }
}

/**
 * Aggregates per-(championKey,role) play stats across already-fetched
 * matches for one puuid. Callers supply the matches (fetched however suits
 * their platform); this just counts kills/deaths/assists/wins per
 * champion+role, applying the same role normalization and `roleOnly`
 * filter as the desktop scout/auto-fill handlers.
 */
export function aggregateChampionPlays(
  matches: Map<string, any>,
  matchIds: string[],
  puuid: string,
  opts: { roleOnly?: boolean; memberRole?: string } = {},
): { agg: Map<string, ChampionAgg>; sameRoleCount: number; failed: number; history: { from: number | null; to: number | null } } {
  const agg = new Map<string, ChampionAgg>()
  let sameRoleCount = 0
  let failed = 0
  // Span of every analysed game, any role (the tier rule's history bounds).
  const history = { from: null as number | null, to: null as number | null }
  const memberRole = (opts.memberRole || '').toUpperCase()
  for (const id of matchIds) {
    const match = matches.get(id)
    if (!match) { failed++; continue }
    const p = participantFor(match, puuid)
    if (!p) continue
    const at = matchStartOf(match)
    if (at != null) {
      history.from = history.from == null ? at : Math.min(history.from, at)
      history.to = history.to == null ? at : Math.max(history.to, at)
    }
    const role = normalizeRole(p.teamPosition || p.individualPosition)
    if (!role || role === 'UNKNOWN' || role === 'INVALID' || role === 'NONE') continue
    if (opts.roleOnly && memberRole && role !== memberRole) continue
    sameRoleCount++
    const key = `${p.championName}|${role}`
    const existing = agg.get(key)
    if (existing) {
      existing.count++
      if (p.win) existing.wins++
      existing.kills += p.kills ?? 0
      existing.deaths += p.deaths ?? 0
      existing.assists += p.assists ?? 0
      if (at != null) {
        existing.firstAt = existing.firstAt == null ? at : Math.min(existing.firstAt, at)
        existing.lastAt = existing.lastAt == null ? at : Math.max(existing.lastAt, at)
      }
    } else {
      agg.set(key, {
        championKey: p.championName, role, count: 1, wins: p.win ? 1 : 0,
        kills: p.kills ?? 0, deaths: p.deaths ?? 0, assists: p.assists ?? 0, masteryPoints: 0,
        firstAt: at, lastAt: at,
      })
    }
  }
  return { agg, sameRoleCount, failed, history }
}

/**
 * Merges two match-id lists (e.g. "already known" + "fetched since last
 * scout"), deduplicated and sorted most-recent-first using the timestamp
 * Riot embeds in a match id's second segment (`EUW1_7123456789`). Used by
 * the desktop's incremental scout/auto-fill (E15,
 * electron/main/ipc/team.ipc.ts's getSeasonMatchIdsIncremental) to combine
 * a cached season list with freshly-listed new games without re-listing
 * the whole season.
 */
export function mergeMatchIdsByRecency(a: string[], b: string[]): string[] {
  const merged = [...new Set([...a, ...b])]
  merged.sort((x, y) => parseInt(y.split('_')[1] ?? '0', 10) - parseInt(x.split('_')[1] ?? '0', 10))
  return merged
}

export function winRateOf(a: { wins: number; count: number }): number {
  return a.count > 0 ? Math.round((a.wins / a.count) * 100) : 0
}

export function kdaOf(a: { kills: number; assists: number; deaths: number }): number {
  return (a.kills + a.assists) / Math.max(1, a.deaths)
}

// ── Scouted opponents per group (#7, 19/11/2026) ─────────────────────────
//
// On the desktop an opponent team (Team.isOpponent) is scouted *for* one
// group: its `groupId` says which. (For the group's own team the same
// column means "the roster of this group", one team per group.) Opponents
// created before this had no group: `includeUnassigned` lists them too,
// so they can be assigned with linkTeamToGroup instead of vanishing.

export interface TeamListOptions {
  isOpponent?: boolean
  /** Only the teams of this cloud group (opponents scouted for it, or its own roster). */
  groupId?: string
  /** With `groupId`: also the teams that have no group yet (pre-#7 opponents). */
  includeUnassigned?: boolean
}

/** Prisma `where` for `team:list`, always scoped to the local user. */
export function teamListWhere(userId: string, opts: TeamListOptions = {}): Record<string, unknown> {
  const where: Record<string, unknown> = { userId }
  if (typeof opts.isOpponent === 'boolean') where.isOpponent = opts.isOpponent
  if (opts.groupId) {
    if (opts.includeUnassigned) where.OR = [{ groupId: opts.groupId }, { groupId: null }]
    else where.groupId = opts.groupId
  }
  return where
}

/**
 * Teams that must give up `groupId` when `teamId` takes it. Only the
 * group's own roster is exclusive (one per group); any number of
 * opponents can be scouted for the same group.
 */
export function teamLinkReleaseWhere(userId: string, teamId: string, groupId: string, isOpponent: boolean): Record<string, unknown> | null {
  if (isOpponent) return null
  return { userId, groupId, isOpponent: false, NOT: { id: teamId } }
}

// ── Team stats (Stats collectives: Flex, Scrim, Tournoi, combined) — #41b, 19/11/2026 ───────────────────────────
// Pure: the desktop (electron/main/ipc/team.ipc.ts) and the web adapter compute the same numbers from the same
// inputs. Fetching (Riot match lists and bodies, custom games) stays with each caller.

/** A match reduced to what the aggregation reads: Riot match-V5 participants, or a custom game's. */
export interface MatchLike { durationSec: number; participants: any[] }

/** Riot match-V5 body → MatchLike (a missing body gives an empty one, skipped by the aggregation). */
export function matchLikeFromRiot(match: any): MatchLike {
  return { durationSec: match?.info?.gameDuration ?? 0, participants: match?.info?.participants ?? [] }
}

/** A custom game (local CustomGame or a group game, participantsJson) → MatchLike. */
export function matchLikeFromCustom(g: { durationSec: number; participantsJson: string }): MatchLike {
  let participants: any[] = []
  try { const p = JSON.parse(g.participantsJson); if (Array.isArray(p)) participants = p } catch { /* empty game */ }
  return { durationSec: g.durationSec, participants }
}

/** Adds one member's match ids to the match → puuids index (several members in a match = a shared game). */
export function indexMatchIds(index: Map<string, Set<string>>, puuid: string, matchIds: string[]): void {
  for (const id of matchIds) {
    const set = index.get(id) ?? new Set<string>()
    set.add(puuid)
    index.set(id, set)
  }
}

/** Matches where at least `minTogether` members appear (cheap pre-filter before fetching the bodies). */
export function sharedMatchIds(index: Map<string, Set<string>>, minTogether: number): string[] {
  return Array.from(index.entries()).filter(([, puuids]) => puuids.size >= minTogether).map(([id]) => id)
}

/** Groups match ids by the region of one member who played it (each region has its own Riot routing). */
export function matchIdsByRegion(
  ids: string[],
  index: Map<string, Set<string>>,
  members: Array<{ puuid: string | null; region: string | null }>,
): Map<string, string[]> {
  const regionOf = new Map(members.filter((m) => m.puuid && m.region).map((m) => [m.puuid as string, m.region as string]))
  const out = new Map<string, string[]>()
  for (const id of ids) {
    const seeder = Array.from(index.get(id) ?? [])[0]
    const region = seeder ? regionOf.get(seeder) : undefined
    if (!region) continue
    const list = out.get(region) ?? []
    list.push(id)
    out.set(region, list)
  }
  return out
}

/** How many games of each kind the combined numbers are made of (shown by the dashboard). */
export function combinedSources(flexCount: number, customs: Array<{ gameType: string }>): { flex: number; scrim: number; tournament: number } {
  return {
    flex: flexCount,
    scrim: customs.filter((g) => g.gameType === 'scrim').length,
    tournament: customs.filter((g) => g.gameType === 'tournament').length,
  }
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
export function aggregateMatchLike(
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
