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
): { agg: Map<string, ChampionAgg>; sameRoleCount: number; failed: number } {
  const agg = new Map<string, ChampionAgg>()
  let sameRoleCount = 0
  let failed = 0
  const memberRole = (opts.memberRole || '').toUpperCase()
  for (const id of matchIds) {
    const match = matches.get(id)
    if (!match) { failed++; continue }
    const p = participantFor(match, puuid)
    if (!p) continue
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
    } else {
      agg.set(key, {
        championKey: p.championName, role, count: 1, wins: p.win ? 1 : 0,
        kills: p.kills ?? 0, deaths: p.deaths ?? 0, assists: p.assists ?? 0, masteryPoints: 0,
      })
    }
  }
  return { agg, sameRoleCount, failed }
}

export function winRateOf(a: { wins: number; count: number }): number {
  return a.count > 0 ? Math.round((a.wins / a.count) * 100) : 0
}

export function kdaOf(a: { kills: number; assists: number; deaths: number }): number {
  return (a.kills + a.assists) / Math.max(1, a.deaths)
}
