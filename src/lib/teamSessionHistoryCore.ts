import type { SupabaseClient } from '@supabase/supabase-js'
import type { SynergyPlayerStats } from './synergyStats'
import type { TeamGameTimeline } from './analyst'
import type { TeamSessionStatus } from './teamSessions'
import type {
  HistoryGame, HistoryObjective, HistoryPeriod, MatchFormat, MeetingDetail, MeetingScope, ObjectiveCount, PresenceStatus, ScrimNotes, SessionKind, SideTotals,
  TeamSessionHistoryDetail, TeamSessionHistoryFilters, TeamSessionHistoryPage, TeamSessionHistoryRow,
  TeamSessionHistorySummary,
} from './teamSessionHistory'
import { buildDuelRows, buildSideStats, matchParticipantToMember, participantName, type RiotIdMember, type RiotMatchParticipant } from './teamSessionStatsCore'
import { resolveOurTeamId } from './matchSide'
import { isCurrentTimeline } from './teamTimelineCore'
import { getAttendance, getObjectives } from './teamSessionsCore'
import { listFeedbackForSession, listReviewsForSession } from './teamSessionReviewsCore'
import { fail } from './supabaseErrors'

/**
 * Team session history (DESIGN_STATE.md § 15), contract docs/contracts/team-session-history.md. Reads what the team
 * sessions already store (sessions, their calendar slot, games with the cached Riot match and timeline summary,
 * reviews, feedback, attendance, objectives, scrim notes) and the staff's objective verdicts
 * (team_session_objective_results, migration 20261120150000). Never calls Riot.
 */

export const HISTORY_PAGE_SIZE = 20
export const HISTORY_PAGE_MAX = 50
const DAY_MS = 86_400_000

// ── Pure helpers ───────────────────────────────────────────────────────────

/** The session's kind: its calendar slot's, else its games' queue (440 flex, 700 tournament), else other. */
export function sessionKindOf(eventKind: string | null | undefined, queueIds: Array<number | null | undefined>): SessionKind {
  if (eventKind === 'scrim' || eventKind === 'flex' || eventKind === 'tournament' || eventKind === 'meeting') return eventKind
  if (queueIds.some((q) => q === 700)) return 'tournament'
  if (queueIds.some((q) => q === 440)) return 'flex'
  return 'other'
}

/** Start of the period (ms), -Infinity for 'all'. The season starts on 1 January (patch x.1 ships early January). */
export function periodStartMs(period: HistoryPeriod, now: number): number {
  if (period === '30d') return now - 30 * DAY_MS
  if (period === 'season') return Date.UTC(new Date(now).getUTCFullYear(), 0, 1)
  return -Infinity
}

/** Whether our side won, from match-v5 `info.teams` (or the participants) and our team id. Null when unknown. */
export function ourWinOf(teams: unknown, ourTeamId: number | null, participants?: unknown): boolean | null {
  if (ourTeamId !== 100 && ourTeamId !== 200) return null
  if (Array.isArray(teams)) {
    const t = teams.find((x: any) => x?.teamId === ourTeamId) as { win?: unknown } | undefined
    if (typeof t?.win === 'boolean') return t.win
  }
  if (Array.isArray(participants)) {
    const p = participants.find((x: any) => x?.teamId === ourTeamId) as { win?: unknown } | undefined
    if (typeof p?.win === 'boolean') return p.win
  }
  return null
}

/**
 * An objective is held when the staff said so for the whole session; else when it was held in more than half of the
 * games judged. Null without any verdict.
 */
export function objectiveHeld(session: boolean | null | undefined, byGame: Record<string, boolean>): boolean | null {
  if (session === true || session === false) return session
  const verdicts = Object.values(byGame)
  if (verdicts.length === 0) return null
  return verdicts.filter(Boolean).length * 2 > verdicts.length
}

/** Who sees every session of the group: owner, coach, analyst, manager, captain (main or extra staff role). */
export function seesAllSessions(role: string | null | undefined, isCaptain: boolean, staffRoles: readonly string[] = []): boolean {
  return isCaptain || ['owner', 'coach', 'analyst', 'manager'].includes(role ?? '') || staffRoles.some((r) => ['coach', 'analyst', 'manager'].includes(r))
}

const zeroSide = (): SideTotals => ({ kills: 0, deaths: 0, assists: 0, gold: 0, damage: 0, vision: 0 })
function addSide(into: SideTotals, ps: RiotMatchParticipant[]): SideTotals {
  for (const p of ps) {
    into.kills += p.kills ?? 0; into.deaths += p.deaths ?? 0; into.assists += p.assists ?? 0
    into.gold += p.goldEarned ?? 0; into.damage += p.totalDamageDealtToChampions ?? 0; into.vision += p.visionScore ?? 0
  }
  return into
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0)

/**
 * Several games' stats of the same players combined: averages and shares are the mean over the games, games and wins
 * add up. `keyOf` groups the rows (the member for our side, the role for the opponents).
 */
export function mergePlayerStats(lists: SynergyPlayerStats[][], keyOf: (p: SynergyPlayerStats) => string): SynergyPlayerStats[] {
  const groups = new Map<string, SynergyPlayerStats[]>()
  for (const list of lists) for (const p of list) {
    const k = keyOf(p)
    groups.set(k, [...(groups.get(k) ?? []), p])
  }
  const out: SynergyPlayerStats[] = []
  for (const rows of groups.values()) {
    const gamesPlayed = rows.reduce((s, r) => s + r.gamesPlayed, 0)
    const wins = rows.reduce((s, r) => s + r.wins, 0)
    const avg = <T extends Record<string, number>>(pick: (r: SynergyPlayerStats) => T): T => {
      const keys = Object.keys(pick(rows[0])) as Array<keyof T>
      return Object.fromEntries(keys.map((k) => [k, mean(rows.map((r) => pick(r)[k] as number))])) as T
    }
    const roleCount = new Map<string, number>()
    for (const r of rows) roleCount.set(r.role, (roleCount.get(r.role) ?? 0) + r.gamesPlayed)
    const role = [...roleCount.entries()].sort((a, b) => b[1] - a[1])[0][0]
    const champs = new Map<string, { games: number; wins: number }>()
    for (const r of rows) for (const c of r.byChampion) {
      const cur = champs.get(c.championKey) ?? { games: 0, wins: 0 }
      champs.set(c.championKey, { games: cur.games + c.games, wins: cur.wins + c.wins })
    }
    const deaths = rows.reduce((s, r) => s + r.averages.deaths, 0)
    const averages = avg((r) => r.averages)
    // The KDA of several games is (kills + assists) / deaths over all of them, not the mean of each game's KDA.
    const k = rows.reduce((s, r) => s + r.averages.kills, 0), a = rows.reduce((s, r) => s + r.averages.assists, 0)
    averages.kda = deaths > 0 ? (k + a) / deaths : k + a
    out.push({
      memberId: rows[0].memberId,
      displayName: rows[0].displayName,
      role,
      gamesPlayed,
      wins,
      winRate: gamesPlayed > 0 ? (wins / gamesPlayed) * 100 : 0,
      averages,
      shares: avg((r) => r.shares),
      byChampion: [...champs.entries()].map(([championKey, c]) => ({ championKey, games: c.games, wins: c.wins, winRate: c.games ? (c.wins / c.games) * 100 : 0 }))
        .sort((x, y) => y.games - x.games),
    })
  }
  return out
}

export interface HistoryGameInput {
  id: string
  matchId: string
  status: 'pending_fetch' | 'fetched' | 'error'
  matchJson: unknown
  ourTeamId: 100 | 200 | null
  enemyTeamName: string | null
  timelineSummary: unknown
}

/** One game of the detail page from its stored row. Our side: the cached one, else resolved from the members' Riot IDs. */
export function buildHistoryGame(g: HistoryGameInput, index: number, members: RiotIdMember[]): HistoryGame {
  const timeline = isCurrentTimeline(g.timelineSummary) ? (g.timelineSummary as TeamGameTimeline) : null
  const base: HistoryGame = {
    gameId: g.id, index, matchId: g.matchId, stats: 'not-fetched', win: null, durationSec: null,
    enemyTeamName: g.enemyTeamName, team: null, players: [], enemyPlayers: [], duels: [], timeline,
  }
  const match = g.matchJson as { info?: { participants?: RiotMatchParticipant[]; gameDuration?: number; teams?: unknown } } | null
  const participants = match?.info?.participants
  const durationSec = match?.info?.gameDuration
  if (!Array.isArray(participants) || typeof durationSec !== 'number') return { ...base, stats: g.status === 'error' ? 'error' : 'not-fetched' }
  const ourTeamId = g.ourTeamId ?? resolveOurTeamId(participants, members.map((m) => m.riotId ?? '').filter(Boolean))
  if (!ourTeamId) return { ...base, stats: 'no-side', durationSec }
  const ours = participants.filter((p) => p.teamId === ourTeamId)
  const theirs = participants.filter((p) => p.teamId !== ourTeamId && (p.teamId === 100 || p.teamId === 200))
  const players = buildSideStats(ours, durationSec, (p) => {
    const m = matchParticipantToMember(p, members)
    return m ? { id: m.userId, displayName: m.displayName ?? participantName(p) } : { id: participantName(p), displayName: participantName(p) }
  })
  const enemyPlayers = buildSideStats(theirs, durationSec, (p) => ({ id: participantName(p), displayName: participantName(p) }))
  const gold15 = timeline?.goldDiffByMinute?.[15]
  return {
    ...base,
    stats: 'ready',
    win: ourWinOf(match?.info?.teams, ourTeamId, participants),
    durationSec,
    team: { our: addSide(zeroSide(), ours), enemy: addSide(zeroSide(), theirs), avgDurationSec: durationSec, goldDiffAt15: typeof gold15 === 'number' ? gold15 : null },
    players,
    enemyPlayers,
    duels: buildDuelRows(players, enemyPlayers),
  }
}

/** "Whole session": the ready games combined. Null when none is ready. */
export function buildWholeSession(games: HistoryGame[]): TeamSessionHistoryDetail['whole'] {
  const ready = games.filter((g) => g.stats === 'ready' && g.team)
  if (ready.length === 0) return null
  const our = zeroSide(), enemy = zeroSide()
  for (const g of ready) for (const k of Object.keys(our) as Array<keyof SideTotals>) { our[k] += g.team!.our[k]; enemy[k] += g.team!.enemy[k] }
  const golds = ready.map((g) => g.team!.goldDiffAt15).filter((v): v is number => v !== null)
  const players = mergePlayerStats(ready.map((g) => g.players), (p) => p.memberId)
  const enemyPlayers = mergePlayerStats(ready.map((g) => g.enemyPlayers), (p) => p.role).map((p) => ({ ...p, memberId: p.role }))
  return {
    gamesCounted: ready.length,
    team: { our, enemy, avgDurationSec: mean(ready.map((g) => g.durationSec ?? 0)), goldDiffAt15: golds.length ? Math.round(mean(golds)) : null },
    players,
    enemyPlayers,
    duels: buildDuelRows(players, enemyPlayers),
  }
}

export interface ResultRow { objectiveId: string; gameId: string | null; met: boolean }

/** The session's objectives with the staff's verdicts. */
export function buildObjectives(objectiveIds: string[], results: ResultRow[]): HistoryObjective[] {
  return objectiveIds.map((objectiveId) => {
    const mine = results.filter((r) => r.objectiveId === objectiveId)
    const session = mine.find((r) => r.gameId === null)?.met ?? null
    const byGame: Record<string, boolean> = {}
    for (const r of mine) if (r.gameId) byGame[r.gameId] = r.met
    return { objectiveId, session, byGame, held: objectiveHeld(session, byGame) }
  })
}

export function countObjectives(objectives: HistoryObjective[]): ObjectiveCount {
  return { total: objectives.length, held: objectives.filter((o) => o.held === true).length, judged: objectives.filter((o) => o.held !== null).length }
}

export function summarizeHistory(rows: TeamSessionHistoryRow[]): TeamSessionHistorySummary {
  const byKind: Record<SessionKind, number> = { flex: 0, scrim: 0, tournament: 0, meeting: 0, other: 0 }
  for (const r of rows) byKind[r.kind]++
  const wins = rows.reduce((s, r) => s + r.wins, 0), losses = rows.reduce((s, r) => s + r.losses, 0)
  // The game tiles count the game sessions; meetings have their own tiles.
  const played = rows.filter((r) => r.kind !== 'meeting')
  const reviewed = played.filter((r) => r.review === 'done').length
  const meetings = rows.filter((r) => r.meeting)
  const attendance = meetings.filter((r) => r.meeting!.concerned > 0).map((r) => r.meeting!.present / r.meeting!.concerned)
  return {
    sessions: rows.length,
    byKind,
    games: rows.reduce((s, r) => s + r.games.length, 0),
    wins,
    losses,
    winRate: wins + losses > 0 ? Math.round((wins / (wins + losses)) * 1000) / 10 : null,
    objectivesHeld: rows.reduce((s, r) => s + r.objectives.held, 0),
    objectivesTotal: rows.reduce((s, r) => s + r.objectives.total, 0),
    reviewed,
    withoutReview: played.length - reviewed,
    meetings: {
      count: meetings.length,
      averageAttendancePct: attendance.length ? Math.round((attendance.reduce((s, x) => s + x, 0) / attendance.length) * 100) : null,
      summariesDone: meetings.filter((r) => r.meeting!.summary === 'done').length,
      recordedSec: null,
    },
  }
}

// ── Meetings ───────────────────────────────────────────────────────────────

export interface MeetingMember { userId: string; role: string; staffRoles: string[]; alsoPlays: boolean }

/** Who a meeting concerns: the whole team, the players (and an owner who also plays), the staff, or its invitees. */
export function meetingConcerned(scope: string | null | undefined, members: MeetingMember[], invitees: string[]): MeetingMember[] {
  const isStaff = (m: MeetingMember) => ['owner', 'coach', 'analyst', 'manager'].includes(m.role) || m.staffRoles.length > 0
  if (scope === 'whole_team') return members
  if (scope === 'all_players') return members.filter((m) => m.role === 'player' || m.alsoPlays)
  if (scope === 'all_staff') return members.filter(isStaff)
  return members.filter((m) => invitees.includes(m.userId))
}

/**
 * Each person's presence: the mark set during the meeting first (present / absent), else a "declined" answer to the
 * slot (absent, with its note), else no answer.
 */
export function meetingPeople(
  concerned: MeetingMember[],
  marks: Record<string, boolean>,
  responses: Array<{ userId: string; status: string; note: string | null }>,
): MeetingDetail['people'] {
  return concerned.map((m) => {
    const answer = responses.find((r) => r.userId === m.userId)
    const mark = marks[m.userId]
    const status: PresenceStatus = mark === true ? 'present' : mark === false || answer?.status === 'declined' ? 'absent' : 'no-answer'
    return { userId: m.userId, role: m.role, status, absenceNote: status === 'absent' ? answer?.note ?? null : null }
  })
}

function meetingScopeOf(v: unknown): MeetingScope {
  return v === 'whole_team' || v === 'all_players' || v === 'all_staff' ? v : 'custom'
}

// ── Reads ──────────────────────────────────────────────────────────────────

const isMissingRelation = (e: { code?: string } | null) => e?.code === '42P01' || e?.code === 'PGRST205'
const isMissingColumn = (e: { code?: string } | null) => e?.code === '42703'

async function objectiveResults(sb: SupabaseClient, sessionIds: string[]): Promise<Array<ResultRow & { sessionId: string }>> {
  if (sessionIds.length === 0) return []
  const { data, error } = await sb.from('team_session_objective_results').select('session_id, objective_id, game_id, met').in('session_id', sessionIds)
  if (isMissingRelation(error)) return [] // before migration 20261120150000
  if (error) fail(error, 'objective results')
  return (data ?? []).map((r: any) => ({ sessionId: r.session_id, objectiveId: r.objective_id, gameId: r.game_id, met: r.met }))
}

function formatOf(v: unknown): MatchFormat | null {
  return v === 'bo1' || v === 'bo3' || v === 'bo5' ? v : null
}

function checklistOf(v: unknown): ScrimNotes['checklist'] {
  return Array.isArray(v)
    ? v.filter((c: any) => c && typeof c.label === 'string').map((c: any) => ({ label: c.label, done: c.done === true }))
    : []
}

const SESSION_COLS = 'id, group_id, calendar_event_id, status, responsible_user_ids, started_at, ended_at, created_at'
// The session's copy of its slot (migration 20261120160000): kept when the slot is deleted after the session started.
const SNAPSHOT_COLS = 'event_id, event_kind, event_title, event_starts_at, event_ends_at'

/** Sessions with their slot's copy when the column exists, without it before migration 20261120160000. */
async function selectSessions(build: (cols: string) => PromiseLike<{ data: any; error: any }>): Promise<{ data: any; error: any }> {
  const res = await build(`${SESSION_COLS}, ${SNAPSHOT_COLS}`)
  return isMissingColumn(res.error) ? build(SESSION_COLS) : res
}

/** The slot a session reads from: the live one, else the session's copy (slot deleted). */
function slotOf(s: any, live: any | undefined) {
  const deleted = !s.calendar_event_id
  return {
    eventId: (s.calendar_event_id ?? s.event_id ?? '') as string,
    deleted,
    kind: (live?.kind ?? s.event_kind ?? null) as string | null,
    title: (live?.title ?? s.event_title ?? '') as string,
    startsAt: (live?.starts_at ?? s.event_starts_at ?? s.started_at ?? s.created_at) as string,
    endsAt: (live?.ends_at ?? s.event_ends_at ?? s.ended_at ?? s.started_at ?? s.created_at) as string,
    scope: live?.attendee_scope as string | undefined,
    createdBy: (live?.created_by ?? null) as string | null,
    notes: (live?.notes ?? null) as string | null,
  }
}

export async function listTeamSessionHistory(sb: SupabaseClient, uid: string, groupId: string, filters: TeamSessionHistoryFilters, now = Date.now()): Promise<TeamSessionHistoryPage> {
  const limit = Math.min(HISTORY_PAGE_MAX, Math.max(1, filters.limit ?? HISTORY_PAGE_SIZE))
  const empty: TeamSessionHistoryPage = { sessions: [], hasMore: false, summary: summarizeHistory([]) }

  const { data: members, error: mErr } = await sb.from('group_members').select('user_id, role, is_captain, staff_roles, also_plays, display_name').eq('group_id', groupId)
  if (mErr) fail(mErr, 'members')
  const me = (members ?? []).find((m: any) => m.user_id === uid)
  if (!me) return empty
  const all = seesAllSessions(me.role, !!me.is_captain, me.staff_roles ?? [])
  const memberList: MeetingMember[] = (members ?? []).map((m: any) => ({ userId: m.user_id, role: m.role, staffRoles: m.staff_roles ?? [], alsoPlays: !!m.also_plays }))

  const { data: sessions, error } = await selectSessions((cols) => sb.from('team_sessions').select(cols).eq('group_id', groupId).eq('status', 'ended'))
  if (error) fail(error, 'sessions')
  if (!sessions?.length) return empty
  const sessionIds = sessions.map((s: any) => s.id as string)
  const eventIds = sessions.map((s: any) => s.calendar_event_id as string).filter(Boolean)

  const [events, games, scrims, reviews, transcribed, feedback, objectives, results, attendees, attendance, responses] = await Promise.all([
    sb.from('calendar_events').select('id, kind, title, starts_at, ends_at, attendee_scope').in('id', eventIds),
    sb.from('team_session_games').select('id, session_id, created_at, reported_by, our_team_id, enemy_team_name, queue:match_json->info->queueId, duration:match_json->info->gameDuration, teams:match_json->info->teams, start:match_json->info->gameStartTimestamp').in('session_id', sessionIds),
    sb.from('scrims').select('calendar_event_id, bo_format, opponent, prep_notes, review_notes').in('calendar_event_id', eventIds),
    sb.from('team_session_reviews').select('session_id, scope, status, summary, recording_local_path, youtube_url').in('session_id', sessionIds),
    // Which meeting reviews have a transcript, without reading the transcripts themselves.
    sb.from('team_session_reviews').select('session_id').eq('scope', 'meeting').not('transcript', 'is', null).in('session_id', sessionIds),
    sb.from('team_session_feedback').select('session_id').in('session_id', sessionIds),
    sb.from('team_session_objectives').select('session_id, objective_ids').in('session_id', sessionIds),
    objectiveResults(sb, sessionIds),
    sb.from('calendar_event_attendees').select('event_id, user_id').in('event_id', eventIds),
    sb.from('team_session_attendance').select('session_id, user_id, present').in('session_id', sessionIds),
    sb.from('calendar_event_responses').select('event_id, user_id, status, note').in('event_id', eventIds),
  ])
  for (const r of [events, games, scrims, reviews, transcribed, feedback, objectives, attendees, attendance, responses]) if (r.error) fail(r.error, 'history')
  const nameOf = new Map((members ?? []).map((m: any) => [m.user_id as string, (m.display_name ?? null) as string | null]))

  const eventById = new Map((events.data ?? []).map((e: any) => [e.id, e]))
  const scrimByEvent = new Map((scrims.data ?? []).map((s: any) => [s.calendar_event_id, s]))
  const from = periodStartMs(filters.period, now)

  const rows: TeamSessionHistoryRow[] = []
  for (const s of sessions as any[]) {
    const slot = slotOf(s, eventById.get(s.calendar_event_id))
    const myGames = (games.data ?? []).filter((g: any) => g.session_id === s.id)
      .sort((a: any, b: any) => (Number(a.start) || Date.parse(a.created_at)) - (Number(b.start) || Date.parse(b.created_at)))
    const invitees = (attendees.data ?? []).filter((a: any) => a.event_id === s.calendar_event_id).map((a: any) => a.user_id as string)
    const marks: Record<string, boolean> = Object.fromEntries((attendance.data ?? []).filter((a: any) => a.session_id === s.id).map((a: any) => [a.user_id, a.present]))
    if (!all) {
      const mine = slot.scope === 'whole_team' || slot.scope === 'all_players' || invitees.includes(uid)
        || uid in marks || myGames.some((g: any) => g.reported_by === uid)
      if (!mine) continue
    }
    if (Date.parse(slot.startsAt) < from) continue
    const kind = sessionKindOf(slot.kind, myGames.map((g: any) => (g.queue === null || g.queue === undefined ? null : Number(g.queue))))
    if (filters.kind !== 'all' && kind !== filters.kind) continue
    const scrim = scrimByEvent.get(s.calendar_event_id) as any
    const rowGames = myGames.map((g: any) => ({
      gameId: g.id as string,
      win: ourWinOf(g.teams, g.our_team_id),
      durationSec: g.duration === null || g.duration === undefined ? null : Number(g.duration),
    }))
    const sessionReviews = (reviews.data ?? []).filter((r: any) => r.session_id === s.id)
    const objectiveIds: string[] = ((objectives.data ?? []).find((o: any) => o.session_id === s.id) as any)?.objective_ids ?? []
    const counted = countObjectives(buildObjectives(objectiveIds, results.filter((r) => r.sessionId === s.id)))
    const row: TeamSessionHistoryRow = {
      sessionId: s.id,
      calendarEventId: slot.eventId,
      kind,
      title: slot.title,
      opponent: scrim?.opponent ?? myGames.find((g: any) => g.enemy_team_name)?.enemy_team_name ?? null,
      startsAt: slot.startsAt,
      endsAt: slot.endsAt,
      format: formatOf(scrim?.bo_format),
      games: rowGames,
      wins: rowGames.filter((g) => g.win === true).length,
      losses: rowGames.filter((g) => g.win === false).length,
      playedSec: rowGames.reduce((t, g) => t + (g.durationSec ?? 0), 0),
      objectives: counted,
      hasNotes: !!(scrim?.prep_notes || scrim?.review_notes) || (feedback.data ?? []).some((f: any) => f.session_id === s.id),
      review: sessionReviews.some((r: any) => r.status === 'done') ? 'done' : sessionReviews.some((r: any) => r.status !== 'deferred') ? 'pending' : 'none',
      ...(slot.deleted ? { eventDeleted: true } : {}),
    }
    if (kind === 'meeting') {
      const concerned = meetingConcerned(slot.scope, memberList, invitees)
      const review = sessionReviews.find((r: any) => r.scope === 'meeting') as any
      const people = meetingPeople(concerned, marks, (responses.data ?? []).filter((r: any) => r.event_id === s.calendar_event_id)
        .map((r: any) => ({ userId: r.user_id, status: r.status, note: r.note ?? null })))
      row.meeting = {
        present: concerned.filter((m) => marks[m.userId] === true).length,
        concerned: concerned.length,
        scope: meetingScopeOf(slot.scope),
        durationSec: Math.max(0, Math.round((Date.parse(slot.endsAt) - Date.parse(slot.startsAt)) / 1000)),
        recorded: !!(review?.recording_local_path || review?.youtube_url),
        transcript: (transcribed.data ?? []).some((t: any) => t.session_id === s.id),
        summary: review?.summary ? 'done' : review && review.status !== 'deferred' ? 'pending' : 'none',
        people: people.map((p) => ({ userId: p.userId, name: nameOf.get(p.userId) ?? null, status: p.status })),
      }
    }
    rows.push(row)
  }
  rows.sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt))
  const before = filters.before ? Date.parse(filters.before) : Infinity
  const page = rows.filter((r) => Date.parse(r.startsAt) < before)
  return { sessions: page.slice(0, limit), hasMore: page.length > limit, summary: summarizeHistory(rows) }
}

export async function getTeamSessionHistoryDetail(sb: SupabaseClient, sessionId: string): Promise<TeamSessionHistoryDetail> {
  const { data: s, error } = await selectSessions((cols) => sb.from('team_sessions').select(cols).eq('id', sessionId).maybeSingle())
  if (error) fail(error, 'session')
  if (!s) throw new Error('NOT_FOUND')
  const eventId: string | null = s.calendar_event_id ?? null
  const none = Promise.resolve({ data: null, error: null })

  const [event, scrim, gameRows, members, reviews, feedback, attendance, objectives, results] = await Promise.all([
    eventId ? sb.from('calendar_events').select('kind, title, starts_at, ends_at, attendee_scope, created_by, notes').eq('id', eventId).maybeSingle() : none,
    eventId ? sb.from('scrims').select('bo_format, opponent, prep_notes, review_notes, checklist, status').eq('calendar_event_id', eventId).maybeSingle() : none,
    sb.from('team_session_games').select('id, match_id, status, created_at, match_json, our_team_id, enemy_team_name, timeline_summary').eq('session_id', sessionId),
    sb.from('group_members').select('user_id, riot_id, display_name, role, staff_roles, also_plays').eq('group_id', s.group_id),
    listReviewsForSession(sb, sessionId),
    listFeedbackForSession(sb, sessionId),
    getAttendance(sb, sessionId),
    getObjectives(sb, sessionId),
    objectiveResults(sb, [sessionId]),
  ])
  for (const r of [event, scrim, gameRows, members]) if (r.error) fail(r.error, 'session detail')

  const memberList: RiotIdMember[] = (members.data ?? []).map((m: any) => ({ userId: m.user_id, riotId: m.riot_id, displayName: m.display_name }))
  const startOf = (g: any) => Number(g.match_json?.info?.gameStartTimestamp) || Date.parse(g.created_at)
  const ordered = [...(gameRows.data ?? [])].sort((a: any, b: any) => startOf(a) - startOf(b))
  const games = ordered.map((g: any, i) => buildHistoryGame({
    id: g.id, matchId: g.match_id, status: g.status, matchJson: g.match_json, ourTeamId: g.our_team_id,
    enemyTeamName: g.enemy_team_name, timelineSummary: g.timeline_summary,
  }, i + 1, memberList))
  const queueIds = ordered.map((g: any) => (typeof g.match_json?.info?.queueId === 'number' ? g.match_json.info.queueId : null))
  const sc = scrim.data as any
  const slot = slotOf(s, event.data ?? undefined)
  const kind = sessionKindOf(slot.kind, queueIds)

  const detail: TeamSessionHistoryDetail = {
    header: {
      sessionId: s.id,
      calendarEventId: slot.eventId,
      kind,
      title: slot.title,
      opponent: sc?.opponent ?? games.find((g) => g.enemyTeamName)?.enemyTeamName ?? null,
      startsAt: slot.startsAt,
      endsAt: slot.endsAt,
      format: formatOf(sc?.bo_format),
      wins: games.filter((g) => g.win === true).length,
      losses: games.filter((g) => g.win === false).length,
      responsibleUserIds: s.responsible_user_ids ?? [],
      status: s.status as TeamSessionStatus,
      ...(slot.deleted ? { eventDeleted: true } : {}),
    },
    games,
    whole: buildWholeSession(games),
    objectives: buildObjectives(objectives?.objectiveIds ?? [], results),
    kpiIds: objectives?.kpiIds ?? [],
    reviews,
    feedback,
    scrimNotes: sc ? { prepNotes: sc.prep_notes ?? null, reviewNotes: sc.review_notes ?? null, checklist: checklistOf(sc.checklist), status: sc.status ?? 'planned' } : null,
    attendance,
  }

  if (kind === 'meeting') {
    const [invitees, responses] = eventId
      ? await Promise.all([
        sb.from('calendar_event_attendees').select('user_id').eq('event_id', eventId),
        sb.from('calendar_event_responses').select('user_id, status, note').eq('event_id', eventId),
      ])
      : [{ data: [], error: null }, { data: [], error: null }]
    for (const r of [invitees, responses]) if (r.error) fail(r.error, 'meeting')
    const meetingMembers: MeetingMember[] = (members.data ?? []).map((m: any) => ({ userId: m.user_id, role: m.role, staffRoles: m.staff_roles ?? [], alsoPlays: !!m.also_plays }))
    // A deleted slot no longer says who it concerned: the people marked during the meeting.
    const concerned = eventId
      ? meetingConcerned(slot.scope, meetingMembers, (invitees.data ?? []).map((a: any) => a.user_id))
      : meetingMembers.filter((m) => m.userId in attendance)
    const people = meetingPeople(concerned, attendance, (responses.data ?? []).map((r: any) => ({ userId: r.user_id, status: r.status, note: r.note ?? null })))
    const review = reviews.find((r) => r.scope === 'meeting') ?? null
    detail.meeting = {
      reason: slot.title,
      notes: slot.notes,
      organizerId: slot.createdBy,
      scope: meetingScopeOf(slot.scope),
      people,
      present: people.filter((p) => p.status === 'present').length,
      concerned: people.length,
      recording: review && (review.recordingLocalPath || review.youtubeUrl)
        ? { localPath: review.recordingLocalPath, youtubeUrl: review.youtubeUrl, youtubeVisibility: review.youtubeVisibility, recordedBy: review.recordedBy, recordedAt: review.createdAt }
        : null,
      summary: review?.summary ?? null,
      transcript: review?.transcript ?? null,
      reviewId: review?.id ?? null,
      reviewStatus: review?.status ?? null,
    }
  }
  return detail
}

/** The staff's verdict on one objective (RPC set_team_session_objective_result, migration 20261120150000). */
export async function setObjectiveResult(sb: SupabaseClient, sessionId: string, objectiveId: string, gameId: string | null, met: boolean | null): Promise<void> {
  const { error } = await sb.rpc('set_team_session_objective_result', { p_session: sessionId, p_objective: objectiveId, p_game: gameId, p_met: met })
  if (!error) return
  if (error.code === 'PGRST202' || error.code === '42883') throw new Error('NOT_AVAILABLE')
  if (error.code === '42501' || /FORBIDDEN/.test(error.message)) throw new Error('FORBIDDEN')
  if (/NOT_FOUND/.test(error.message)) throw new Error('NOT_FOUND')
  fail(error, 'objective result')
}

