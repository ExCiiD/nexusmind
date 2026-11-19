/**
 * #40 analyst features: storage and orchestration, shared by the desktop (electron/main/cloud/analyst.ts) and the
 * web (web/src/api.ts). Everything that is not a Riot call lives here; the platform passes its Riot fetchers in.
 * Pure computations: teamTimelineCore.ts (§ 10), draftLogCore.ts (§ 11), opponentDossierCore.ts (§ 12).
 * Tables: team_session_games.timeline_summary, draft_log, opponent_dossiers (20261119290000).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  DossierSnapshot, DraftLogEntry, DraftLogInput, DraftLogPatch, OpponentDossier, OpponentDossierInput, OpponentDossierView,
  TeamGameSource, TeamGameTimeline, TeamObjectivesFilters, TeamObjectivesGameRef, TeamTimelineUnavailable,
} from './analyst'
import { opponentKeyOf } from './analyst'
import { extractTeamTimeline, isCurrentTimeline, summarizeTeamObjectives } from './teamTimelineCore'
import { draftFromMatch, draftOpponentKey } from './draftLogCore'
import {
  assembleDossierView, DOSSIER_SNAPSHOT_VERSION, duosOf, poolChangeOf, recentFormOf, scoutingFor, type PlayerRankedGame,
} from './opponentDossierCore'
import { resolveOurTeamId } from './matchSide'
import { getSharedTeam } from './teamCore'

/** What the platform reads from Riot (through its own limiter and cache). */
export interface RiotMatchFetchers {
  fetchMatch: (matchId: string) => Promise<any>
  fetchTimeline: (matchId: string) => Promise<any>
}

export interface RiotPlayerFetchers {
  /** null when the Riot ID does not exist. */
  accountByRiotId: (gameName: string, tagLine: string, region: string) => Promise<{ puuid: string } | null>
  /** e.g. "Emerald II · 54 LP", null when unranked. */
  rankOf: (puuid: string, region: string) => Promise<string | null>
  /** The player's last `count` ranked games, as the dossier needs them. */
  rankedGames: (puuid: string, region: string, count: number) => Promise<PlayerRankedGame[]>
}

function fail(error: { message?: string; code?: string } | null, what: string): never {
  const msg = error?.message ?? 'unknown error'
  if (error?.code === '42501' || /row-level security|permission denied|FORBIDDEN/i.test(msg)) throw new Error('FORBIDDEN')
  throw new Error(`${what}: ${msg}`)
}

// ── § 10 Objectives ──────────────────────────────────────────────────────

/** Where a team game comes from: a tournament event, else the queue (440 Flex, 700 Clash = tournament), else a scrim. */
export function sourceOf(eventKind: string | null | undefined, queueId: number | null | undefined): TeamGameSource {
  if (eventKind === 'tournament' || queueId === 700) return 'tournament'
  if (queueId === 440) return 'flex'
  return 'scrim'
}

interface SessionGameRow {
  id: string; session_id: string; match_id: string; created_at: string
  queue: number | string | null; start: number | string | null; summary_version: number | string | null
}

/** The group's team games (team sessions), newest first, with what the filters can tell before any Riot call. */
export async function listTeamObjectivesGames(sb: SupabaseClient, groupId: string, filters: TeamObjectivesFilters): Promise<TeamObjectivesGameRef[]> {
  const { data: sessions, error: sErr } = await sb.from('team_sessions').select('id, calendar_event_id').eq('group_id', groupId)
  if (sErr) fail(sErr, 'sessions')
  if (!sessions?.length) return []
  const eventIds = [...new Set(sessions.map((s: any) => s.calendar_event_id).filter(Boolean))]
  const { data: events, error: eErr } = eventIds.length
    ? await sb.from('calendar_events').select('id, kind').in('id', eventIds)
    : { data: [] as any[], error: null }
  if (eErr) fail(eErr, 'events')
  const kindOfEvent = new Map((events ?? []).map((e: any) => [e.id, e.kind as string]))
  const kindOfSession = new Map(sessions.map((s: any) => [s.id, kindOfEvent.get(s.calendar_event_id) ?? null]))

  const { data: games, error: gErr } = await sb.from('team_session_games')
    .select('id, session_id, match_id, created_at, queue:match_json->info->queueId, start:match_json->info->gameStartTimestamp, summary_version:timeline_summary->version')
    .in('session_id', sessions.map((s: any) => s.id))
  if (gErr) fail(gErr, 'games')

  const from = filters.from ? Date.parse(filters.from.slice(0, 10)) : -Infinity
  const to = filters.to ? Date.parse(filters.to.slice(0, 10)) + 86_400_000 - 1 : Infinity
  return ((games ?? []) as unknown as SessionGameRow[])
    .map((g) => {
      const start = g.start !== null && g.start !== undefined ? Number(g.start) : NaN
      return {
        gameId: g.id,
        matchId: g.match_id,
        playedAt: Number.isFinite(start) ? new Date(start).toISOString() : g.created_at,
        source: sourceOf(kindOfSession.get(g.session_id), g.queue === null || g.queue === undefined ? null : Number(g.queue)),
        cached: g.summary_version !== null && g.summary_version !== undefined,
      }
    })
    .filter((g) => { const t = Date.parse(g.playedAt); return t >= from && t <= to && filters.sources.includes(g.source) })
    .sort((a, b) => Date.parse(b.playedAt) - Date.parse(a.playedAt))
}

/** The Riot IDs of a group's members (to tell our side in a match). */
async function memberRiotIds(sb: SupabaseClient, groupId: string): Promise<string[]> {
  const { data, error } = await sb.from('group_members').select('riot_id').eq('group_id', groupId)
  if (error) fail(error, 'members')
  return (data ?? []).map((m: any) => m.riot_id).filter(Boolean)
}

/**
 * One team game's summary. The cached one when current; else the match (cached on the game too), our side (cached
 * once resolved from the roster's Riot IDs) and the timeline, extracted, then cached for the whole group.
 */
export async function loadTeamGameTimeline(sb: SupabaseClient, gameId: string, riot: RiotMatchFetchers): Promise<TeamGameTimeline | TeamTimelineUnavailable> {
  const { data: game, error } = await sb.from('team_session_games')
    .select('id, session_id, match_id, match_json, our_team_id, enemy_team_name, timeline_summary').eq('id', gameId).maybeSingle()
  if (error) fail(error, 'game')
  if (!game) throw new Error('NOT_FOUND')
  if (isCurrentTimeline(game.timeline_summary)) return game.timeline_summary

  const { data: session, error: sErr } = await sb.from('team_sessions').select('group_id, calendar_event_id').eq('id', game.session_id).maybeSingle()
  if (sErr) fail(sErr, 'session')
  if (!session) throw new Error('NOT_FOUND')

  let match = game.match_json
  try {
    if (!match) {
      match = await riot.fetchMatch(game.match_id)
      await sb.from('team_session_games').update({ match_json: match, status: 'fetched' }).eq('id', gameId)
    }
  } catch (err) {
    return { unavailable: 'riot-error', message: (err as Error)?.message }
  }

  let ourTeamId = game.our_team_id as 100 | 200 | null
  if (ourTeamId !== 100 && ourTeamId !== 200) {
    ourTeamId = resolveOurTeamId(match?.info?.participants ?? [], await memberRiotIds(sb, session.group_id))
    if (!ourTeamId) return { unavailable: 'no-side' }
    await sb.from('team_session_games').update({ our_team_id: ourTeamId }).eq('id', gameId)
  }

  let timeline: any
  try {
    timeline = await riot.fetchTimeline(game.match_id)
  } catch (err) {
    return { unavailable: 'riot-error', message: (err as Error)?.message }
  }
  const { data: event } = session.calendar_event_id
    ? await sb.from('calendar_events').select('kind').eq('id', session.calendar_event_id).maybeSingle()
    : { data: null }
  const summary = extractTeamTimeline(match, timeline, {
    gameId, matchId: game.match_id, ourTeamId, opponentName: game.enemy_team_name ?? null,
    source: sourceOf(event?.kind, match?.info?.queueId),
  })
  if (!summary) return { unavailable: 'no-timeline' }
  // Best effort: the next reader extracts again if this write fails.
  await sb.from('team_session_games').update({ timeline_summary: summary }).eq('id', gameId)
  return summary
}

// ── § 11 Draft log ───────────────────────────────────────────────────────

const DRAFT_SELECT = 'id, group_id, match_id, source, played_at, patch, opponent_name, opponent_key, side, win, duration_sec, our_picks, their_picks, our_bans, their_bans, pick_order, notes, created_by, created_at, updated_at'

const toDraft = (r: any): DraftLogEntry => ({
  id: r.id, groupId: r.group_id, matchId: r.match_id, source: r.source, playedAt: r.played_at, patch: r.patch,
  opponentName: r.opponent_name, opponentKey: r.opponent_key, side: r.side, win: r.win, durationSec: r.duration_sec,
  ourPicks: r.our_picks ?? [], theirPicks: r.their_picks ?? [], ourBans: r.our_bans, theirBans: r.their_bans,
  pickOrder: r.pick_order, notes: r.notes, createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at,
})

const draftRow = (input: DraftLogInput) => ({
  source: input.source, played_at: input.playedAt, opponent_name: input.opponentName?.trim() || null,
  opponent_key: draftOpponentKey(input.opponentName), side: input.side, win: input.win,
  our_picks: input.ourPicks, their_picks: input.theirPicks, our_bans: input.ourBans, their_bans: input.theirBans,
  notes: input.notes?.trim() || null,
})

export async function listDrafts(sb: SupabaseClient, groupId: string): Promise<DraftLogEntry[]> {
  const { data, error } = await sb.from('draft_log').select(DRAFT_SELECT).eq('group_id', groupId).order('played_at', { ascending: false }).limit(1000)
  if (error) fail(error, 'draft log')
  return (data ?? []).map(toDraft)
}

export async function createDraft(sb: SupabaseClient, groupId: string, uid: string, input: DraftLogInput): Promise<DraftLogEntry> {
  const { data, error } = await sb.from('draft_log').insert({ group_id: groupId, created_by: uid, ...draftRow(input) }).select(DRAFT_SELECT).single()
  if (error) fail(error, 'add draft')
  return toDraft(data)
}

export async function updateDraft(sb: SupabaseClient, id: string, patch: DraftLogPatch): Promise<DraftLogEntry> {
  const row: Record<string, unknown> = {}
  if ('opponentName' in patch) { row.opponent_name = patch.opponentName?.trim() || null; row.opponent_key = draftOpponentKey(patch.opponentName) }
  if ('win' in patch) row.win = patch.win
  if ('ourBans' in patch) row.our_bans = patch.ourBans
  if ('theirBans' in patch) row.their_bans = patch.theirBans
  if ('pickOrder' in patch) row.pick_order = patch.pickOrder && patch.pickOrder.length > 0 ? patch.pickOrder : null
  if ('notes' in patch) row.notes = patch.notes?.trim() || null
  const { data, error } = await sb.from('draft_log').update(row).eq('id', id).select(DRAFT_SELECT).maybeSingle()
  if (error) fail(error, 'update draft')
  if (!data) throw new Error('NOT_FOUND')
  return toDraft(data)
}

export async function deleteDraft(sb: SupabaseClient, id: string): Promise<void> {
  const { error } = await sb.from('draft_log').delete().eq('id', id)
  if (error) fail(error, 'delete draft')
}

/**
 * Adds the drafts of the group's team games that are not in the log yet: games whose match is cached and whose side
 * is known (the Objectives tab and the per-game stats fill both). Returns how many were added.
 */
export async function syncDraftsFromGames(
  sb: SupabaseClient, groupId: string, uid: string, championName: (id: number) => string | null,
): Promise<{ added: number }> {
  const { data: sessions, error: sErr } = await sb.from('team_sessions').select('id, calendar_event_id').eq('group_id', groupId)
  if (sErr) fail(sErr, 'sessions')
  if (!sessions?.length) return { added: 0 }
  const { data: games, error: gErr } = await sb.from('team_session_games')
    .select('id, session_id, match_id, match_json, our_team_id, enemy_team_name')
    .in('session_id', sessions.map((s: any) => s.id)).not('match_json', 'is', null)
  if (gErr) fail(gErr, 'games')
  const { data: logged, error: lErr } = await sb.from('draft_log').select('match_id').eq('group_id', groupId).not('match_id', 'is', null)
  if (lErr) fail(lErr, 'draft log')
  const have = new Set((logged ?? []).map((r: any) => r.match_id))
  const eventIds = [...new Set(sessions.map((s: any) => s.calendar_event_id).filter(Boolean))]
  const { data: events } = eventIds.length ? await sb.from('calendar_events').select('id, kind').in('id', eventIds) : { data: [] as any[] }
  const kindOfEvent = new Map((events ?? []).map((e: any) => [e.id, e.kind]))
  const kindOfSession = new Map(sessions.map((s: any) => [s.id, kindOfEvent.get(s.calendar_event_id) ?? null]))
  let riotIds: string[] | null = null

  const rows: Record<string, unknown>[] = []
  for (const g of games ?? []) {
    if (have.has(g.match_id)) continue
    let ourTeamId = g.our_team_id as 100 | 200 | null
    if (ourTeamId !== 100 && ourTeamId !== 200) {
      riotIds ??= await memberRiotIds(sb, groupId)
      ourTeamId = resolveOurTeamId(g.match_json?.info?.participants ?? [], riotIds)
      if (!ourTeamId) continue
    }
    const d = draftFromMatch(g.match_json, ourTeamId, {
      matchId: g.match_id, opponentName: g.enemy_team_name ?? null,
      source: sourceOf(kindOfSession.get(g.session_id) as string | null, g.match_json?.info?.queueId),
    }, championName)
    rows.push({ group_id: groupId, created_by: uid, match_id: d.matchId, patch: d.patch, duration_sec: d.durationSec, ...draftRow(d) })
    have.add(g.match_id)
  }
  if (rows.length === 0) return { added: 0 }
  // ignoreDuplicates: another staff member may sync at the same time.
  const { error } = await sb.from('draft_log').upsert(rows, { onConflict: 'group_id,match_id', ignoreDuplicates: true })
  if (error) fail(error, 'sync drafts')
  return { added: rows.length }
}

// ── § 12 Opponent dossier ────────────────────────────────────────────────

const DOSSIER_SELECT = 'id, group_id, opponent_key, opponent_name, how_they_play, suggested_bans, game_plan, status, published_at, snapshot, snapshot_at, updated_at, updated_by'

const toDossier = (r: any): OpponentDossier => ({
  id: r.id, groupId: r.group_id, opponentKey: r.opponent_key, opponentName: r.opponent_name, howTheyPlay: r.how_they_play,
  suggestedBans: r.suggested_bans ?? [], gamePlan: r.game_plan, status: r.status, publishedAt: r.published_at,
  snapshot: r.snapshot?.version === DOSSIER_SNAPSHOT_VERSION ? r.snapshot : null, snapshotAt: r.snapshot_at,
  updatedAt: r.updated_at, updatedBy: r.updated_by,
})

async function dossierRow(sb: SupabaseClient, groupId: string, opponentKey: string): Promise<OpponentDossier | null> {
  const { data, error } = await sb.from('opponent_dossiers').select(DOSSIER_SELECT).eq('group_id', groupId).eq('opponent_key', opponentKey).maybeSingle()
  if (error) fail(error, 'dossier')
  return data ? toDossier(data) : null
}

/** The page. Reads only Supabase: the Riot data is the last refresh's snapshot. */
export async function getDossierView(sb: SupabaseClient, groupId: string, opponentKey: string, reducedMode: boolean): Promise<OpponentDossierView> {
  const [shared, dossier, drafts, vsGames] = await Promise.all([
    getSharedTeam(sb, groupId, { pools: true, drafts: false }),
    dossierRow(sb, groupId, opponentKey),
    listDrafts(sb, groupId),
    cachedTimelinesVs(sb, groupId, opponentKey),
  ])
  const objectivesVsUs = vsGames.length
    ? summarizeTeamObjectives(vsGames, { sources: ['flex', 'scrim', 'tournament'], side: 'both' })
    : null
  return assembleDossierView({ opponentKey, scouting: shared.scouting, dossier, drafts, objectivesVsUs, reducedMode })
}

/** Cached summaries of the group's games against that opponent (no Riot call). */
async function cachedTimelinesVs(sb: SupabaseClient, groupId: string, opponentKey: string): Promise<TeamGameTimeline[]> {
  const { data: sessions, error } = await sb.from('team_sessions').select('id').eq('group_id', groupId)
  if (error) fail(error, 'sessions')
  if (!sessions?.length) return []
  const { data: games, error: gErr } = await sb.from('team_session_games').select('enemy_team_name, timeline_summary')
    .in('session_id', sessions.map((s: any) => s.id)).not('timeline_summary', 'is', null).not('enemy_team_name', 'is', null)
  if (gErr) fail(gErr, 'games')
  return (games ?? [])
    .filter((g: any) => opponentKeyOf(g.enemy_team_name) === opponentKey && isCurrentTimeline(g.timeline_summary))
    .map((g: any) => g.timeline_summary)
}

export async function saveDossier(sb: SupabaseClient, groupId: string, opponentKey: string, input: OpponentDossierInput): Promise<OpponentDossier> {
  const row = {
    opponent_name: input.opponentName.trim(), how_they_play: input.howTheyPlay?.trim() || null,
    suggested_bans: input.suggestedBans.slice(0, 5), game_plan: input.gamePlan?.trim() || null,
  }
  const existing = await dossierRow(sb, groupId, opponentKey)
  const res = existing
    ? await sb.from('opponent_dossiers').update(row).eq('id', existing.id).select(DOSSIER_SELECT).single()
    : await sb.from('opponent_dossiers').insert({ group_id: groupId, opponent_key: opponentKey, ...row }).select(DOSSIER_SELECT).single()
  if (res.error) fail(res.error, 'save dossier')
  return toDossier(res.data)
}

export async function setDossierStatus(sb: SupabaseClient, groupId: string, opponentKey: string, status: 'draft' | 'published'): Promise<OpponentDossier> {
  const existing = await dossierRow(sb, groupId, opponentKey)
  if (!existing) throw new Error('NOT_FOUND')
  const { data, error } = await sb.rpc('set_opponent_dossier_status', { p_id: existing.id, p_status: status })
  if (error) fail(error, 'dossier status')
  return toDossier(data)
}

/**
 * "Refresh the data": for each starter of the scouted roster, the Riot ID resolved, the rank and the last ranked
 * games (form, pool change, duos), stored on the dossier (created as a draft when there is none yet).
 */
export async function refreshDossier(
  sb: SupabaseClient, groupId: string, opponentKey: string, riot: RiotPlayerFetchers,
  opts: { gamesPerPlayer: number; reducedMode: boolean; now?: number },
): Promise<OpponentDossierView> {
  const shared = await getSharedTeam(sb, groupId, { pools: false, drafts: false })
  const scouted = scoutingFor(shared.scouting, opponentKey)
  if (!scouted) throw new Error('NOT_FOUND')
  const starters = scouted.roster.filter((m) => m.status === 'starter' || !m.status)
  const now = opts.now ?? Date.now()

  const players: DossierSnapshot['players'] = []
  const forDuos: Array<{ displayName: string; games: PlayerRankedGame[] }> = []
  for (const m of starters) {
    const riotId = m.ign ? `${m.ign}${m.tagLine ? `#${m.tagLine}` : ''}` : null
    const base = { role: m.role, displayName: m.displayName, riotId }
    if (!m.ign || !m.tagLine) { players.push({ ...base, status: 'not_found', rank: null, recentForm: [], poolChange: null }); continue }
    const region = m.region ?? 'EUW1'
    const puuid = m.puuid ?? (await riot.accountByRiotId(m.ign, m.tagLine, region))?.puuid ?? null
    if (!puuid) { players.push({ ...base, status: 'not_found', rank: null, recentForm: [], poolChange: null }); continue }
    const [rank, games] = await Promise.all([riot.rankOf(puuid, region), riot.rankedGames(puuid, region, opts.gamesPerPlayer)])
    players.push({ ...base, status: 'ok', rank, recentForm: recentFormOf(games), poolChange: poolChangeOf(games, now) })
    forDuos.push({ displayName: m.displayName, games })
  }
  const snapshot: DossierSnapshot = { version: DOSSIER_SNAPSHOT_VERSION, players, duos: duosOf(forDuos), gamesPerPlayer: opts.gamesPerPlayer }

  let existing = await dossierRow(sb, groupId, opponentKey)
  if (!existing) {
    existing = await saveDossier(sb, groupId, opponentKey, { opponentName: scouted.name, howTheyPlay: scouted.scoutNotes?.slice(0, 600) ?? null, suggestedBans: [], gamePlan: null })
  }
  const { error } = await sb.from('opponent_dossiers').update({ snapshot, snapshot_at: new Date(now).toISOString() }).eq('id', existing.id)
  if (error) fail(error, 'save snapshot')
  return getDossierView(sb, groupId, opponentKey, opts.reducedMode)
}
