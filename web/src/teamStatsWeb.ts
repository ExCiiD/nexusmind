import * as riot from './riotWeb'
import { sb } from './supabase'
import * as teamCore from '@/lib/teamCore'
import { listGroupCustomGames, fromGroupRow, type CustomGameType } from '@/lib/teamCustomGamesCore'
import {
  aggregateMatchLike, combinedSources, indexMatchIds, matchIdsByRegion, matchLikeFromCustom, matchLikeFromRiot, sharedMatchIds,
  type MatchLike,
} from '@/lib/scoutingCore'
import { RIOT_LIMITS } from '@/lib/riotLimits'
import type { CustomGame, TeamSynergyStats } from '@/lib/ipc'

/**
 * Stats collectives on the web (#41b): the same numbers as the desktop handlers (team:compute-synergy-stats,
 * team:compute-custom-stats, team:compute-combined-stats in electron/main/ipc/team.ipc.ts), from the same pure Core
 * (scoutingCore's "Team stats" section). Only the fetching differs: Riot through the browser proxy client
 * (riotWeb.ts), custom games from team_custom_games.
 *
 * The Riot key is shared by every user of the proxy, so this file keeps the calls down:
 * - match bodies never change: kept in memory for the tab's life (LRU, MATCH_CACHE_MAX), and a body already being
 *   fetched is awaited instead of fetched twice;
 * - match id lists and Riot ID → puuid are kept a few minutes, so switching tabs or minTogether costs nothing;
 * - bodies are fetched with a small concurrency cap (STATS_CONCURRENCY), below the scouting one;
 * - every call is marked background (x-nxm-priority), so a user's direct action goes first at the proxy.
 */

const MATCH_CACHE_MAX = 600
const IDS_TTL_MS = 5 * 60_000
const STATS_CONCURRENCY = Math.min(6, RIOT_LIMITS.MATCH_FETCH_CONCURRENCY)

const bodies = new Map<string, any>()
const inflight = new Map<string, Promise<any>>()
const idLists = new Map<string, { at: number; ids: Promise<string[]> }>()
const puuids = new Map<string, Promise<string | null>>()

function remember(id: string, body: any): void {
  bodies.delete(id)
  bodies.set(id, body)
  while (bodies.size > MATCH_CACHE_MAX) bodies.delete(bodies.keys().next().value as string)
}

/** Match bodies by id, from the cache first; the missing ones fetched per region, a few at a time. */
async function matchBodies(byRegion: Map<string, string[]>): Promise<Map<string, any>> {
  const out = new Map<string, any>()
  const waits: Array<Promise<void>> = []
  for (const [region, ids] of byRegion) {
    const missing: string[] = []
    for (const id of ids) {
      const hit = bodies.get(id)
      if (hit) { remember(id, hit); out.set(id, hit) } else if (inflight.has(id)) {
        waits.push(inflight.get(id)!.then((b) => { if (b) out.set(id, b) }))
      } else missing.push(id)
    }
    if (missing.length === 0) continue
    const batch = riot.getMatchesBulk(missing, region, STATS_CONCURRENCY, riot.BACKGROUND)
    for (const id of missing) {
      const one = batch.then((m) => m.get(id) ?? null).finally(() => inflight.delete(id))
      inflight.set(id, one)
      waits.push(one.then((b) => { if (b) { remember(id, b); out.set(id, b) } }))
    }
  }
  await Promise.all(waits)
  return out
}

function recentFlexIds(puuid: string, region: string, count: number): Promise<string[]> {
  const key = `${puuid}|${region}|${count}`
  const hit = idLists.get(key)
  if (hit && Date.now() - hit.at < IDS_TTL_MS) return hit.ids
  const ids = riot.getRecentMatchIds(puuid, region, count, 440, riot.BACKGROUND)
  idLists.set(key, { at: Date.now(), ids })
  ids.catch(() => idLists.delete(key))
  return ids
}

/** The member's puuid, or one looked up from the Riot ID (kept for the tab's life, like the desktop stores it). */
function puuidOf(m: { puuid?: string | null; ign?: string | null; tagLine?: string | null; region?: string | null }): Promise<string | null> {
  if (m.puuid) return Promise.resolve(m.puuid)
  if (!m.ign || !m.tagLine || !m.region) return Promise.resolve(null)
  const key = `${m.ign}#${m.tagLine}@${m.region}`.toLowerCase()
  let p = puuids.get(key)
  if (!p) {
    p = riot.getAccountByRiotId(m.ign, m.tagLine, m.region, riot.BACKGROUND).then((a) => a?.puuid ?? null, () => null)
    puuids.set(key, p)
  }
  return p
}

type StatsMember = { id: string; displayName: string; ign: string | null; role: string; puuid: string | null; region: string | null }

/** The group's own roster in the aggregator's shape (only the group's team has stats: teamId === groupId). */
async function rosterOf(groupId: string, teamId: string): Promise<{ id: string; members: StatsMember[] }> {
  if (teamId !== groupId) throw new Error('Team stats are only available for your own team.')
  const [team] = await teamCore.listGroupTeams(sb, groupId)
  const members = await Promise.all((team?.members ?? []).map(async (m) => ({
    id: m.id, displayName: m.displayName, ign: m.ign ?? null, role: m.role,
    puuid: await puuidOf(m), region: m.region ?? null,
  })))
  return { id: teamId, members }
}

/** Flex games where at least `minTogether` members played on the same side (desktop: compute-synergy-stats). */
async function flexMatches(members: StatsMember[], minTogether: number, perMember: number): Promise<{ candidates: string[]; matches: MatchLike[] }> {
  const resolved = members.filter((m): m is StatsMember & { puuid: string; region: string } => !!m.puuid && !!m.region)
  const index = new Map<string, Set<string>>()
  await Promise.all(resolved.map(async (m) => {
    try { indexMatchIds(index, m.puuid, await recentFlexIds(m.puuid, m.region, perMember)) } catch (err) {
      // A rate limit reaches the screen; other failures only drop that member's games.
      if (err instanceof riot.RiotWebError && err.code === 'rate-limited') throw err
      console.warn('[teamStats] match list failed for', m.displayName, (err as Error)?.message)
    }
  }))
  const candidates = sharedMatchIds(index, minTogether)
  if (candidates.length === 0) return { candidates, matches: [] }
  const got = await matchBodies(matchIdsByRegion(candidates, index, resolved))
  return { candidates, matches: candidates.map((id) => matchLikeFromRiot(got.get(id))) }
}

async function customGamesOf(groupId: string, teamId: string, gameType?: CustomGameType) {
  if (teamId !== groupId) return []
  return (await listGroupCustomGames(sb, groupId, gameType)).map((r) => fromGroupRow(r, teamId))
}

export async function computeTeamSynergyStatsWeb(groupId: string, teamId: string, opts: { matchesPerMember?: number; minTogether?: number } = {}): Promise<TeamSynergyStats> {
  const perMember = Math.min(opts.matchesPerMember ?? RIOT_LIMITS.SYNERGY_MATCHES_PER_MEMBER, RIOT_LIMITS.MAX_IDS_PER_REQUEST)
  const minTogether = Math.max(2, opts.minTogether ?? 3)
  const team = await rosterOf(groupId, teamId)
  const resolved = team.members.filter((m) => m.puuid && m.region).length
  if (resolved < minTogether) {
    throw new Error(`Need at least ${minTogether} members with a resolved Riot ID — currently ${resolved}.`)
  }
  const { matches } = await flexMatches(team.members, minTogether, perMember)
  return aggregateMatchLike(team, matches, minTogether) as TeamSynergyStats
}

export async function computeCustomStatsWeb(groupId: string, teamId: string, gameType: CustomGameType | 'all'): Promise<TeamSynergyStats> {
  const [team, games] = await Promise.all([rosterOf(groupId, teamId), customGamesOf(groupId, teamId, gameType === 'all' ? undefined : gameType)])
  return aggregateMatchLike(team, games.map(matchLikeFromCustom)) as TeamSynergyStats
}

export async function computeCombinedStatsWeb(groupId: string, teamId: string, opts: { minTogether?: number } = {}): Promise<TeamSynergyStats> {
  const minTogether = Math.max(2, opts.minTogether ?? 3)
  const [team, customs] = await Promise.all([rosterOf(groupId, teamId), customGamesOf(groupId, teamId)])
  const { matches } = await flexMatches(team.members, minTogether, RIOT_LIMITS.SYNERGY_MATCHES_PER_MEMBER)
  const flex = matches.filter((m) => m.participants.length > 0 && m.durationSec > 0)
  const sources = combinedSources(flex.length, customs)
  return { ...aggregateMatchLike(team, [...flex, ...customs.map(matchLikeFromCustom)], minTogether), sources } as TeamSynergyStats
}

/** The group's scrim / tournament games (read only on the web: the import reads a Replaybook CSV on the desktop). */
export async function listCustomGamesWeb(groupId: string, teamId: string, gameType?: CustomGameType): Promise<CustomGame[]> {
  return (await customGamesOf(groupId, teamId, gameType)) as CustomGame[]
}
