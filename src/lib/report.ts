/** Renderer-side types for the weekly team/player report (E9). No new table — computed on demand from existing data. */

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

export interface TeamWeeklyReport {
  groupId: string
  /** "YYYY-MM-DD", inclusive. */
  weekStart: string
  /** "YYYY-MM-DD", exclusive. */
  weekEnd: string
  players: PlayerWeeklyReport[]
  totalGames: number
  avgWinrate: number | null
}

/**
 * Server-only (reads shared data via RLS), so desktop and web implement
 * this identically — same pattern as devPlan.ts.
 */
export interface ReportApi {
  reportGetWeekly: (groupId: string, weekStart: string) => Promise<TeamWeeklyReport>
}
