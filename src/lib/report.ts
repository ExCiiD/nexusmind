/** Renderer-side types for the weekly team/player report (E9). No new table — computed on demand from existing data. */
import { randomHexToken } from './tokens'

export interface MistakeTrend {
  label: string
  thisWeek: number
  lastWeek: number
  direction: 'up' | 'down' | 'flat'
}

export interface PlayerWeeklyReport {
  playerId: string
  displayName: string
  gamesPlayed: number
  winrate: number | null
  reviewsDone: number
  reviewsPending: number
  mistakeTrends: MistakeTrend[]
  objectivesAssigned: number
  objectivesCompleted: number
  experimentVerdicts: Array<{ problemId: string; verdict: string | null }>
}

/** A mistake that came back across the team over the period (period report, analyst page). */
export interface RecurringMistake {
  label: string
  /** Occurrences in the period, all players together. */
  count: number
  /** Occurrences in the equal-length period before. */
  previousCount: number
  /** How many players made it in the period. */
  players: number
}

export interface TeamWeeklyReport {
  groupId: string
  /** "YYYY-MM-DD", inclusive. */
  weekStart: string
  /** "YYYY-MM-DD", exclusive. */
  weekEnd: string
  players: PlayerWeeklyReport[]
  totalGames: number
  avgWinrate: number | null
  /** Period report only: the mistakes that recur across the team, most frequent first (at most 5). */
  recurringMistakes?: RecurringMistake[]
  /** Period report only: the analyst's own conclusions, written when the report is shared. */
  analystConclusions?: string
}

/** 40 hex chars (160 bits) via Web Crypto — same scheme as
 *  calendar.ts's generateCalendarSubscriptionToken, long-lived and
 *  unguessable since there's no expiry, only explicit revocation. */
export function generateReportShareToken(): string {
  return randomHexToken(20)
}

/** A persistent, revocable link to an already-computed report snapshot
 *  (E9 v2) — see supabase/functions/team-report. The snapshot is taken at
 *  share time from data the generating staff member could already see, so
 *  it carries no more exposure than the existing "Copy as text" button. */
export interface ReportShare {
  id: string
  groupId: string
  token: string
  groupName: string
  report: TeamWeeklyReport
  createdAt: string
  /** Full URL to the rendered report page. */
  url: string
}

/**
 * Server-only (reads shared data via RLS), so desktop and web implement
 * this identically — same pattern as devPlan.ts.
 */
export interface ReportApi {
  reportGetWeekly: (groupId: string, weekStart: string) => Promise<TeamWeeklyReport>
  /** Post-tournament report: the `calendar_events` row's own start/end defines the window. */
  reportGetForEvent: (groupId: string, eventId: string) => Promise<TeamWeeklyReport>
  /** Period report (analyst): any window of 1 to 92 days, "YYYY-MM-DD" both inclusive, compared with the equal-length window before. */
  reportGetForPeriod: (groupId: string, from: string, to: string) => Promise<TeamWeeklyReport>
  reportCreateShare: (groupId: string, groupName: string, report: TeamWeeklyReport) => Promise<ReportShare>
  reportRevokeShare: (id: string) => Promise<void>
}
