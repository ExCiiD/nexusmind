import * as riot from './riotWeb'
import { sb, currentUserId } from './supabase'
import * as analystCore from '@/lib/analystCore'
import { parseLeagueEntries } from '@/lib/rankCore'
import { DOSSIER_GAMES_PERSONAL_KEY, type PlayerRankedGame } from '@/lib/opponentDossierCore'
import type { AnalystApi } from '@/lib/analyst'

/**
 * #40 analyst features, web side: the shared analystCore with the web's Riot client (riotWeb.ts, through the
 * proxy). Same wiring as the desktop (electron/main/cloud/analyst.ts); every Riot read is background work
 * (x-nxm-priority). The proxy keeps finished matches and timelines in its shared store.
 */

/** Region used to read a match by id when nothing better is known (the id carries its platform anyway). */
const FALLBACK_REGION = 'EUW1'
/** The personal Riot key reads 20 ranked games per player (§ 12 "reduced mode"); the production key will read 50. */
const REDUCED_MODE = true
const isNotFound = (err: unknown) => /\b404\b|not found/i.test((err as Error)?.message ?? '')

const analystMatches: analystCore.RiotMatchFetchers = {
  fetchMatch: (matchId) => riot.getMatch(matchId, FALLBACK_REGION, riot.BACKGROUND),
  fetchTimeline: (matchId) => riot.getMatchTimeline(matchId, undefined, riot.BACKGROUND),
}

const analystPlayers: analystCore.RiotPlayerFetchers = {
  accountByRiotId: async (gameName, tagLine, region) => {
    try { return await riot.getAccountByRiotId(gameName, tagLine, region, riot.BACKGROUND) } catch (err) { if (isNotFound(err)) return null; throw err }
  },
  rankOf: async (puuid, region) => {
    const solo = parseLeagueEntries(await riot.getLeagueEntriesByPuuid(puuid, region, riot.BACKGROUND)).solo
    if (!solo) return null
    return `${solo.tier[0]}${solo.tier.slice(1).toLowerCase()}${solo.division ? ` ${solo.division}` : ''} · ${solo.lp} LP`
  },
  rankedGames: async (puuid, region, count) => {
    const ids = await riot.getRankedSoloMatchIds(puuid, region, count, riot.BACKGROUND)
    const out: PlayerRankedGame[] = []
    // One at a time: these are background reads on the shared key.
    for (const id of ids) {
      const m = await riot.getMatch(id, region, riot.BACKGROUND).catch(() => null)
      const p = m?.info?.participants?.find((x: any) => x.puuid === puuid)
      if (!p) continue
      out.push({ matchId: id, win: !!p.win, champion: String(p.championName ?? ''), at: Number(m.info.gameStartTimestamp ?? m.info.gameCreation ?? 0) })
    }
    return out
  },
}

async function championNameById(): Promise<(id: number) => string | null> {
  const map = await riot.getChampionIdToKey().catch(() => ({} as Record<number, string>))
  return (id) => map[id] ?? null
}

export const analystWebApi: AnalystApi = {
  // § 10
  teamObjectivesGames: (groupId, filters) => analystCore.listTeamObjectivesGames(sb, groupId, filters),
  teamObjectivesGameTimeline: (gameId) => analystCore.loadTeamGameTimeline(sb, gameId, analystMatches),
  // § 11
  draftLogList: (groupId) => analystCore.listDrafts(sb, groupId),
  draftLogSyncFromGames: async (groupId) => analystCore.syncDraftsFromGames(sb, groupId, await currentUserId(), await championNameById()),
  draftLogCreate: async (groupId, input) => analystCore.createDraft(sb, groupId, await currentUserId(), input),
  draftLogUpdate: (id, patch) => analystCore.updateDraft(sb, id, patch),
  draftLogDelete: (id) => analystCore.deleteDraft(sb, id),
  // § 12
  opponentDossierGet: (groupId, opponentKey) => analystCore.getDossierView(sb, groupId, opponentKey, REDUCED_MODE),
  opponentDossierSave: (groupId, opponentKey, input) => analystCore.saveDossier(sb, groupId, opponentKey, input),
  opponentDossierPublish: (groupId, opponentKey) => analystCore.setDossierStatus(sb, groupId, opponentKey, 'published'),
  opponentDossierUnpublish: (groupId, opponentKey) => analystCore.setDossierStatus(sb, groupId, opponentKey, 'draft'),
  opponentDossierRefresh: (groupId, opponentKey) =>
    analystCore.refreshDossier(sb, groupId, opponentKey, analystPlayers, { gamesPerPlayer: DOSSIER_GAMES_PERSONAL_KEY, reducedMode: REDUCED_MODE }),
}
