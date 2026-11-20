/**
 * #40 analyst features, desktop side: the shared analystCore with the desktop's Riot plumbing (riotClient.ts, its
 * limiter, the local MatchCache). Every Riot read here is background work (riotPriority.ts, P1-3): a game that just
 * ended goes first. The web adapter does the same with riotWeb.ts.
 */
import { getSupabase, requireSessionUserId } from './supabase'
import { getPrisma } from '../database'
import { readTimeline, saveTimeline } from '../matchStore'
import { getAccountByRiotId, getLeagueEntriesByPuuid, getMatch, getMatchIds, getMatchTimeline } from '../riotClient'
import { getChampionIdToKey } from '../dataDragon'
import { withRiotPriority } from '../riotPriority'
import * as core from '../../../src/lib/analystCore'
import { parseLeagueEntries } from '../../../src/lib/rankCore'
import { DOSSIER_GAMES_PERSONAL_KEY, type PlayerRankedGame } from '../../../src/lib/opponentDossierCore'
import type {
  DraftLogInput, DraftLogPatch, OpponentDossierInput, TeamObjectivesFilters,
} from '../../../src/lib/analyst'

/** Region used to read a match by id when nothing better is known (the id carries its platform anyway). */
const FALLBACK_REGION = 'EUW1'
/** The personal Riot key reads 20 ranked games per player (§ 12 "reduced mode"); the production key will read 50. */
const REDUCED_MODE = true
const isNotFound = (err: unknown) => /\b404\b|not found/i.test((err as Error)?.message ?? '')

const uid = () => requireSessionUserId()

/** A match from the local cache, else Riot (then cached). */
async function cachedMatch(matchId: string, region = FALLBACK_REGION): Promise<any> {
  const prisma = getPrisma()
  const row = await prisma.matchCache.findUnique({ where: { matchId } }).catch(() => null)
  if (row?.matchJson) { try { return JSON.parse(row.matchJson) } catch { /* fetched again */ } }
  const data = await getMatch(matchId, region)
  const matchJson = JSON.stringify(data)
  await prisma.matchCache.upsert({ where: { matchId }, create: { matchId, matchJson }, update: { matchJson } }).catch(() => {})
  return data
}

/** A timeline from the local cache, else Riot (kept with the match for the other screens). */
async function cachedTimeline(matchId: string): Promise<any> {
  const prisma = getPrisma()
  // AUDIT_PERF_2 gain 6: compressed timelines (matchStore); only the timeline column is read.
  const kept = await readTimeline(prisma, matchId)
  if (kept) return kept
  const data = await getMatchTimeline(matchId, FALLBACK_REGION)
  const exists = await prisma.matchCache.findUnique({ where: { matchId }, select: { id: true } }).catch(() => null)
  if (exists) await saveTimeline(prisma, matchId, data).catch(() => {})
  return data
}

const matchFetchers: core.RiotMatchFetchers = {
  fetchMatch: (matchId) => cachedMatch(matchId),
  fetchTimeline: (matchId) => cachedTimeline(matchId),
}

async function championNameById(): Promise<(id: number) => string | null> {
  const map = await getChampionIdToKey().catch(() => ({} as Record<number, string>))
  return (id) => map[id] ?? null
}

const playerFetchers: core.RiotPlayerFetchers = {
  accountByRiotId: async (gameName, tagLine, region) => {
    try { return await getAccountByRiotId(gameName, tagLine, region) } catch (err) { if (isNotFound(err)) return null; throw err }
  },
  rankOf: async (puuid, region) => {
    const solo = parseLeagueEntries(await getLeagueEntriesByPuuid(puuid, region)).solo
    if (!solo) return null
    return `${solo.tier[0]}${solo.tier.slice(1).toLowerCase()}${solo.division ? ` ${solo.division}` : ''} · ${solo.lp} LP`
  },
  rankedGames: async (puuid, region, count) => {
    const ids = await getMatchIds(puuid, region, count, 0, 'soloq')
    const out: PlayerRankedGame[] = []
    for (const id of ids) {
      const m = await cachedMatch(id, region).catch(() => null)
      const p = m?.info?.participants?.find((x: any) => x.puuid === puuid)
      if (!p) continue
      out.push({ matchId: id, win: !!p.win, champion: String(p.championName ?? ''), at: Number(m.info.gameStartTimestamp ?? m.info.gameCreation ?? 0) })
    }
    return out
  },
}

const background = <T>(fn: () => Promise<T>) => withRiotPriority('background', fn)

// § 10
export const teamObjectivesGames = (groupId: string, filters: TeamObjectivesFilters) => core.listTeamObjectivesGames(getSupabase(), groupId, filters)
export const teamObjectivesGameTimeline = (gameId: string) => background(() => core.loadTeamGameTimeline(getSupabase(), gameId, matchFetchers))

// § 11
export const draftLogList = (groupId: string) => core.listDrafts(getSupabase(), groupId)
export const draftLogSyncFromGames = async (groupId: string) => core.syncDraftsFromGames(getSupabase(), groupId, await uid(), await championNameById())
export const draftLogCreate = async (groupId: string, input: DraftLogInput) => core.createDraft(getSupabase(), groupId, await uid(), input)
export const draftLogUpdate = (id: string, patch: DraftLogPatch) => core.updateDraft(getSupabase(), id, patch)
export const draftLogDelete = (id: string) => core.deleteDraft(getSupabase(), id)

// § 12
export const opponentDossierGet = (groupId: string, opponentKey: string) => core.getDossierView(getSupabase(), groupId, opponentKey, REDUCED_MODE)
export const opponentDossierSave = (groupId: string, opponentKey: string, input: OpponentDossierInput) => core.saveDossier(getSupabase(), groupId, opponentKey, input)
export const opponentDossierPublish = (groupId: string, opponentKey: string) => core.setDossierStatus(getSupabase(), groupId, opponentKey, 'published')
export const opponentDossierUnpublish = (groupId: string, opponentKey: string) => core.setDossierStatus(getSupabase(), groupId, opponentKey, 'draft')
export const opponentDossierRefresh = (groupId: string, opponentKey: string) => background(() =>
  core.refreshDossier(getSupabase(), groupId, opponentKey, playerFetchers, { gamesPerPlayer: DOSSIER_GAMES_PERSONAL_KEY, reducedMode: REDUCED_MODE }))
