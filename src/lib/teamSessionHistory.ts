/**
 * Team session history (DESIGN_STATE.md § 15, 20/11/2026): the list of finished team sessions of a group and the page
 * of one finished session. Contract: docs/contracts/team-session-history.md. Computed in teamSessionHistoryCore.ts,
 * shared by the desktop and the web. Nothing here calls Riot: the stats come from the match cached on each game
 * (teamSessionFetchMatch) and the timeline already summarised (teamObjectivesGameTimeline).
 */
import type { SynergyPlayerStats } from './synergyStats'
import type { TeamGameTimeline } from './analyst'
import type { TeamSessionStatus } from './teamSessions'
import type { ReviewStatus, TeamSessionFeedback, TeamSessionReview, YoutubeVisibility } from './teamSessionReviews'
import type { DuelRow } from './teamSessionStatsCore'
import type { PlayerSessionStats } from './playerSessionStatsCore'

export type {
  PlayerGameStats, PlayerSessionStats, PlayerSessionTotals, RadarAxis, RadarAxisKey, VsOpponent, DiffPoint,
  Baseline30d, EventSummary, Highlight, Highlights, HighlightId, LaneSide, LaneSnap, LaneSummary, MapZone, MinuteDiffs, ObjectiveEvent,
  ObjectiveKind, ObjectiveLine, ObjectiveParticipation, PlayerEvent, PlayerExtras, SessionExtras, TimelineStatus, UnavailableGame,
} from './playerSessionStatsCore'

export type SessionKind = 'flex' | 'scrim' | 'tournament' | 'meeting' | 'other'
/** Who a meeting concerns (the slot's attendee scope). */
export type MeetingScope = 'whole_team' | 'all_players' | 'all_staff' | 'custom'
export type PresenceStatus = 'present' | 'absent' | 'no-answer'
export type HistoryPeriod = '30d' | 'season' | 'all'
export type MatchFormat = 'bo1' | 'bo3' | 'bo5'

export interface TeamSessionHistoryFilters {
  kind: SessionKind | 'all'
  period: HistoryPeriod
  /** Pagination: the `startsAt` of the last row received. */
  before?: string | null
  /** 20 by default, 50 at most. */
  limit?: number
}

export interface ObjectiveCount {
  /** Objectives set when the session started. */
  total: number
  held: number
  /** Objectives with a verdict (held or not). */
  judged: number
}

export interface TeamSessionHistoryRow {
  sessionId: string
  calendarEventId: string
  kind: SessionKind
  title: string
  opponent: string | null
  startsAt: string
  endsAt: string
  format: MatchFormat | null
  /** In the order played; win null while the game's stats are not loaded. */
  games: Array<{ gameId: string; win: boolean | null; durationSec: number | null }>
  wins: number
  losses: number
  playedSec: number
  objectives: ObjectiveCount
  /** Scrim notes, or feedback from the players. */
  hasNotes: boolean
  /** A session or game review: done, started, or none. */
  review: 'done' | 'pending' | 'none'
  /** The slot was deleted after the session started: the row reads from the session's copy of it. */
  eventDeleted?: boolean
  /** Meetings only (kind 'meeting'): shown instead of the result and the objectives. */
  meeting?: MeetingRowInfo
}

export interface MeetingRowInfo {
  /** "5 / 6 présents". */
  present: number
  concerned: number
  scope: MeetingScope
  /** The slot's length. */
  durationSec: number
  recorded: boolean
  transcript: boolean
  summary: 'done' | 'pending' | 'none'
  /** The people concerned with their presence, for the initials (green present, red absent, grey no answer). */
  people: Array<{ userId: string; name: string | null; status: PresenceStatus }>
}

export interface TeamSessionHistorySummary {
  sessions: number
  byKind: Record<SessionKind, number>
  games: number
  wins: number
  losses: number
  /** 0-100, null without any known game. */
  winRate: number | null
  objectivesHeld: number
  objectivesTotal: number
  reviewed: number
  withoutReview: number
  /** The meeting tiles (filter "Réunion"), over the meetings of the period. */
  meetings: {
    count: number
    /** Mean of present / concerned over the meetings with at least one person concerned, 0-100. */
    averageAttendancePct: number | null
    summariesDone: number
    /** Not stored yet (the recorder does not save a length): null. */
    recordedSec: number | null
  }
}

export interface TeamSessionHistoryPage {
  sessions: TeamSessionHistoryRow[]
  hasMore: boolean
  /** Over the whole filtered period, not only this page. */
  summary: TeamSessionHistorySummary
}

export interface SideTotals { kills: number; deaths: number; assists: number; gold: number; damage: number; vision: number }

export interface TeamTotals {
  our: SideTotals
  enemy: SideTotals
  avgDurationSec: number
  /** Our gold minus theirs at 15:00 (average over the games whose timeline is known), null otherwise. */
  goldDiffAt15: number | null
}

export interface HistoryGame {
  gameId: string
  /** 1, 2, 3… */
  index: number
  matchId: string
  /** ready: stats computed; not-fetched: call teamSessionFetchMatch; no-side: our side not found; error: not found at Riot. */
  stats: 'ready' | 'not-fetched' | 'no-side' | 'error'
  win: boolean | null
  durationSec: number | null
  enemyTeamName: string | null
  team: TeamTotals | null
  /** Our five (memberId = the member's user id, else the in-game name). */
  players: SynergyPlayerStats[]
  enemyPlayers: SynergyPlayerStats[]
  duels: DuelRow[]
  /** The cached timeline (objective frieze, gold difference). Null: call teamObjectivesGameTimeline(gameId). */
  timeline: TeamGameTimeline | null
}

export interface HistoryObjective {
  /** The fundamental's id (labelled by the screen, as today). */
  objectiveId: string
  /** The staff's verdict for the whole session. */
  session: boolean | null
  /** gameId → held or not. */
  byGame: Record<string, boolean>
  held: boolean | null
}

export interface ScrimNotes {
  prepNotes: string | null
  reviewNotes: string | null
  checklist: Array<{ label: string; done: boolean }>
  status: 'planned' | 'done' | 'cancelled'
}

export interface TeamSessionHistoryDetail {
  header: {
    sessionId: string
    calendarEventId: string
    kind: SessionKind
    title: string
    opponent: string | null
    startsAt: string
    endsAt: string
    format: MatchFormat | null
    wins: number
    losses: number
    responsibleUserIds: string[]
    status: TeamSessionStatus
    eventDeleted?: boolean
  }
  games: HistoryGame[]
  /** "Whole session": the games whose stats are ready, combined. Null when there are none. */
  whole: {
    gamesCounted: number
    team: TeamTotals
    /** Our players, averages per game (gamesPlayed = the games counted). */
    players: SynergyPlayerStats[]
    /** The lane opponents combined by role (memberId = the role). */
    enemyPlayers: SynergyPlayerStats[]
    duels: DuelRow[]
  } | null
  objectives: HistoryObjective[]
  /** The KPIs picked at the start (grouped under their objective by the screen, as today). */
  kpiIds: string[]
  reviews: TeamSessionReview[]
  feedback: TeamSessionFeedback[]
  scrimNotes: ScrimNotes | null
  /** userId → present. */
  attendance: Record<string, boolean>
  /** Meetings only. */
  meeting?: MeetingDetail
}

export interface MeetingDetail {
  /** The reason: the slot's title. */
  reason: string
  notes: string | null
  /** Who created the slot. */
  organizerId: string | null
  scope: MeetingScope
  /** One line per person concerned. */
  people: Array<{ userId: string; role: string; status: PresenceStatus; absenceNote: string | null }>
  present: number
  concerned: number
  /** The meeting review's recording, null when nothing was recorded. */
  recording: { localPath: string | null; youtubeUrl: string | null; youtubeVisibility: YoutubeVisibility; recordedBy: string | null; recordedAt: string } | null
  summary: string | null
  transcript: string | null
  /** The meeting review (scope 'meeting'): its id to edit the summary, and its status ('processing': transcription running). */
  reviewId: string | null
  reviewStatus: ReviewStatus | null
}

export interface TeamSessionHistoryApi {
  /**
   * Individual stats of each member who played in the session (docs/contracts/team-session-history.md § 7). Same rights
   * as teamSessionHistoryDetail (NOT_FOUND otherwise). `enrich: true` extracts, one game at a time and in the
   * background, the timeline of this session's games whose cache lacks the per-player block (Riot calls); without it
   * nothing is fetched and those games' timeline figures are null.
   */
  teamSessionPlayerStats?: (sessionId: string, opts?: { enrich?: boolean }) => Promise<PlayerSessionStats[]>
  teamSessionHistoryList: (groupId: string, filters: TeamSessionHistoryFilters) => Promise<TeamSessionHistoryPage>
  /** Rejects with NOT_FOUND when the session does not exist or is not readable. */
  teamSessionHistoryDetail: (sessionId: string) => Promise<TeamSessionHistoryDetail>
  /**
   * The staff's verdict on one objective: gameId null for the whole session, met null clears it. The session's
   * managers only (FORBIDDEN otherwise); NOT_AVAILABLE before migration 20261120110354_team_session_objective_results.
   */
  teamSessionSetObjectiveResult: (sessionId: string, objectiveId: string, gameId: string | null, met: boolean | null) => Promise<void>
}
