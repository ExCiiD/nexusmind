import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  GroupFundamental, NewGroupFundamentalInput, SessionQueueFilter, TeamSession, TeamSessionGame, TeamSessionObjectives,
} from './teamSessions'
import { fail } from './supabaseErrors'

/**
 * Team sessions (Phase 3, Planning rework — docs/PLAN_GESTION_EQUIPE.md
 * §9), same pattern as calendarCore.ts. Purely server-side — desktop and
 * web call these identically.
 */

interface SessionRow {
  id: string; group_id: string; calendar_event_id: string; status: TeamSession['status']
  responsible_user_ids: string[]; queue_filter: SessionQueueFilter | null
  started_at: string | null; ended_at: string | null; created_at: string
}
interface ObjectivesRow { session_id: string; objective_ids: string[]; kpi_ids: string[]; set_by: string | null; set_at: string }
interface FundamentalRow { id: string; group_id: string; label: string; description: string | null; created_by: string; created_at: string }
interface GameRow {
  id: string; session_id: string; match_id: string; reported_by: string | null; status: TeamSessionGame['status']; created_at: string
  match_json: unknown | null; our_team_id: 100 | 200 | null; enemy_team_name: string | null
}

const SESSION_SELECT = 'id, group_id, calendar_event_id, status, responsible_user_ids, queue_filter, started_at, ended_at, created_at'

const toSession = (r: SessionRow): TeamSession => ({
  id: r.id, groupId: r.group_id, calendarEventId: r.calendar_event_id, status: r.status,
  responsibleUserIds: r.responsible_user_ids, queueFilter: r.queue_filter,
  startedAt: r.started_at, endedAt: r.ended_at, createdAt: r.created_at,
})
const toObjectives = (r: ObjectivesRow): TeamSessionObjectives => ({
  sessionId: r.session_id, objectiveIds: r.objective_ids, kpiIds: r.kpi_ids, setBy: r.set_by, setAt: r.set_at,
})
const toFundamental = (r: FundamentalRow): GroupFundamental => ({
  id: r.id, groupId: r.group_id, label: r.label, description: r.description, createdBy: r.created_by, createdAt: r.created_at,
})
const toGame = (r: GameRow): TeamSessionGame => ({
  id: r.id, sessionId: r.session_id, matchId: r.match_id, reportedBy: r.reported_by, status: r.status, createdAt: r.created_at,
  matchJson: r.match_json, ourTeamId: r.our_team_id, enemyTeamName: r.enemy_team_name,
})
const GAME_SELECT = 'id, session_id, match_id, reported_by, status, created_at, match_json, our_team_id, enemy_team_name'

export async function listSessionsForGroup(sb: SupabaseClient, groupId: string): Promise<TeamSession[]> {
  const { data, error } = await sb.from('team_sessions').select(SESSION_SELECT).eq('group_id', groupId).order('created_at', { ascending: false })
  if (error) fail(error, 'list team sessions')
  return (data as SessionRow[]).map(toSession)
}

/** One session per calendar event (the auto-create trigger enforces this
 *  with a unique constraint) — the natural way PlanningSection/EventPopup
 *  looks up "is there already a session for this event". */
export async function getSessionByEvent(sb: SupabaseClient, calendarEventId: string): Promise<TeamSession | null> {
  const { data, error } = await sb.from('team_sessions').select(SESSION_SELECT).eq('calendar_event_id', calendarEventId).maybeSingle()
  if (error) fail(error, 'get team session')
  return data ? toSession(data as SessionRow) : null
}

/** Transitions 'scheduled' → 'live', capturing the responsible list and
 *  queue filter at this moment (not derived later). */
export async function startSession(sb: SupabaseClient, id: string, responsibleUserIds: string[], queueFilter: SessionQueueFilter | null): Promise<void> {
  const { error } = await sb.from('team_sessions').update({
    status: 'live', responsible_user_ids: responsibleUserIds, queue_filter: queueFilter, started_at: new Date().toISOString(),
  }).eq('id', id)
  if (error) fail(error, 'start session')
}

export async function endSession(sb: SupabaseClient, id: string): Promise<void> {
  const { error } = await sb.from('team_sessions').update({ status: 'ended', ended_at: new Date().toISOString() }).eq('id', id)
  if (error) fail(error, 'end session')
}

export async function getObjectives(sb: SupabaseClient, sessionId: string): Promise<TeamSessionObjectives | null> {
  const { data, error } = await sb.from('team_session_objectives').select('session_id, objective_ids, kpi_ids, set_by, set_at').eq('session_id', sessionId).maybeSingle()
  if (error) fail(error, 'get session objectives')
  return data ? toObjectives(data as ObjectivesRow) : null
}

/** Up to 3 objectives, same cap as the solo session flow — enforced here
 *  (Core), not a DB constraint, matching how objective ids are free-form
 *  strings everywhere else in the app. */
export async function setObjectives(sb: SupabaseClient, sessionId: string, objectiveIds: string[], kpiIds: string[]): Promise<void> {
  if (objectiveIds.length === 0 || objectiveIds.length > 3) throw new Error('INVALID_OBJECTIVE_COUNT')
  const { data: userData } = await sb.auth.getUser()
  const { error } = await sb.from('team_session_objectives').upsert({
    session_id: sessionId, objective_ids: objectiveIds, kpi_ids: kpiIds, set_by: userData.user?.id ?? null, set_at: new Date().toISOString(),
  })
  if (error) fail(error, 'set session objectives')
}

/** Meeting attendance (team_session_attendance): who was there, marked by
 *  the responsible during the meeting. userId → present. */
export async function getAttendance(sb: SupabaseClient, sessionId: string): Promise<Record<string, boolean>> {
  const { data, error } = await sb.from('team_session_attendance').select('user_id, present').eq('session_id', sessionId)
  if (error) fail(error, 'get attendance')
  const out: Record<string, boolean> = {}
  for (const r of (data ?? []) as Array<{ user_id: string; present: boolean }>) out[r.user_id] = r.present
  return out
}

/** Marks one person present or absent (null clears the mark). */
export async function setAttendance(sb: SupabaseClient, sessionId: string, userId: string, present: boolean | null): Promise<void> {
  const q = sb.from('team_session_attendance')
  const { error } = present === null
    ? await q.delete().eq('session_id', sessionId).eq('user_id', userId)
    : await q.upsert({ session_id: sessionId, user_id: userId, present, marked_at: new Date().toISOString() })
  if (error) fail(error, 'set attendance')
}

/** RLS already scopes this to the caller's own groups — a cheap existence
 *  check, used by the fast-poll switch (electron/main/sync/syncService.ts)
 *  and any "you have a live session" banner. */
export async function hasLiveSessionForUser(sb: SupabaseClient): Promise<boolean> {
  const { count, error } = await sb.from('team_sessions').select('id', { count: 'exact', head: true }).eq('status', 'live')
  if (error) fail(error, 'check live session')
  return (count ?? 0) > 0
}

export async function listMyLiveSessions(sb: SupabaseClient): Promise<TeamSession[]> {
  const { data, error } = await sb.from('team_sessions').select(SESSION_SELECT).eq('status', 'live')
  if (error) fail(error, 'list live sessions')
  return (data as SessionRow[]).map(toSession)
}

export async function listGroupFundamentals(sb: SupabaseClient, groupId: string): Promise<GroupFundamental[]> {
  const { data, error } = await sb.from('group_fundamentals').select('id, group_id, label, description, created_by, created_at').eq('group_id', groupId).order('created_at')
  if (error) fail(error, 'list group fundamentals')
  return (data as FundamentalRow[]).map(toFundamental)
}

export async function addGroupFundamental(sb: SupabaseClient, groupId: string, input: NewGroupFundamentalInput): Promise<string> {
  const { data, error } = await sb.from('group_fundamentals').insert({
    group_id: groupId, label: input.label, description: input.description ?? null,
  }).select('id').single()
  if (error) fail(error, 'add group fundamental')
  return data.id
}

/** Any concerned member's local GameDetector calls this once it has an
 *  enriched matchId — deduped by the DB's unique(session_id, match_id), so
 *  multiple teammates' clients independently reporting the same game never
 *  create duplicates (see electron/main/index.ts's onGameEnriched hook). */
export async function reportSessionGame(sb: SupabaseClient, sessionId: string, matchId: string): Promise<void> {
  const { error } = await sb.from('team_session_games').insert({ session_id: sessionId, match_id: matchId })
  if (error && error.code !== '23505') fail(error, 'report session game')
}

export async function listGames(sb: SupabaseClient, sessionId: string): Promise<TeamSessionGame[]> {
  const { data, error } = await sb.from('team_session_games').select(GAME_SELECT).eq('session_id', sessionId).order('created_at')
  if (error) fail(error, 'list session games')
  return (data as GameRow[]).map(toGame)
}

export async function getGame(sb: SupabaseClient, id: string): Promise<TeamSessionGame | null> {
  const { data, error } = await sb.from('team_session_games').select(GAME_SELECT).eq('id', id).maybeSingle()
  if (error) fail(error, 'get session game')
  return data ? toGame(data as GameRow) : null
}

/** Called once per game, right after the Riot fetch that only happens on
 *  the first viewer (Phase 4) — every later viewer reads this cached copy
 *  instead of re-hitting the Riot API. */
export async function cacheGameMatch(sb: SupabaseClient, gameId: string, matchJson: unknown): Promise<void> {
  const { error } = await sb.from('team_session_games').update({ match_json: matchJson, status: 'fetched' }).eq('id', gameId)
  if (error) fail(error, 'cache match')
}

/** Set once resolved client-side (needs the group's roster, which the core
 *  layer doesn't have) from `resolveOurTeamId` in teamSessionStatsCore.ts. */
export async function setOurTeamId(sb: SupabaseClient, gameId: string, ourTeamId: 100 | 200): Promise<void> {
  const { error } = await sb.from('team_session_games').update({ our_team_id: ourTeamId }).eq('id', gameId)
  if (error) fail(error, 'set our team id')
}

export async function setEnemyTeamName(sb: SupabaseClient, gameId: string, name: string | null): Promise<void> {
  const { error } = await sb.from('team_session_games').update({ enemy_team_name: name }).eq('id', gameId)
  if (error) fail(error, 'set enemy team name')
}

// ── pure helpers (no I/O) ───────────────────────────────────────────────

export interface CountdownState {
  msRemaining: number
  isPast: boolean
  /** Short human label, e.g. "2h 14m", "45s", or "Starting now". */
  label: string
}

/** Pure, rendered identically by desktop/web and by the Discord bot's cron
 *  (same "how long until this starts" calculation, no duplicated logic). */
export function countdownState(startsAtIso: string, now: Date): CountdownState {
  const ms = new Date(startsAtIso).getTime() - now.getTime()
  if (ms <= 0) return { msRemaining: 0, isPast: true, label: 'Starting now' }
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  const label = h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`
  return { msRemaining: ms, isPast: false, label }
}

export type QueueBucket = 'flex' | 'scrim' | 'ranked5' | 'other'

/**
 * Maps an already-resolved Ascend queue type (riotClient.ts's
 * `resolveQueueType`) + how many of the session's own 5-player roster
 * appear in the match to one of the session's filter buckets. `queueType`
 * alone can't distinguish a full 5-stack ranked-flex game from someone
 * solo-queuing flex — Solo/Duo (queueId 420) blocks 5-man premades
 * entirely, so a team's "ranked 5" game is ALSO queueId 440 (flex); the
 * roster-overlap count is what actually separates the two. Needs
 * real-world tuning of the ≥4 threshold once used against live scrim data.
 */
export function queueBucket(queueType: string, rosterOverlap: number): QueueBucket {
  if (queueType === 'custom') return 'scrim'
  if (queueType === 'flex') return rosterOverlap >= 4 ? 'ranked5' : 'flex'
  return 'other'
}

export function matchesQueueFilter(filter: SessionQueueFilter | null, bucket: QueueBucket): boolean {
  if (!filter || filter === 'all') return true
  return filter === bucket
}
