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
