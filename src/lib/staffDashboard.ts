/** E2 — staff dashboard (docs/PLAN_GESTION_EQUIPE.md). */

export type DashboardAlert = 'inactive' | 'review_backlog' | 'objective_failing'

export interface PlayerDashboardRow {
  playerId: string
  displayName: string
  gamesThisWeek: number
  winrateLast10: number | null
  reviewsDone: number
  reviewsPending: number
  dominantMistake: { label: string; count: number } | null
  currentObjective: { problemId: string; status: string; verdict: string | null; passRate: number | null } | null
  daysSinceLastGame: number | null
  alerts: DashboardAlert[]
  /** Average mood (1-5) over the player's last 3 check-ins; null if they haven't shared wellbeing (E6) with this group. */
  recentMood: number | null
  /** winrateLast10 minus the team's own average over players who have one; null if either side is unavailable. */
  winrateVsTeamAvg: number | null
  /** The player's latest self-assessment (fundamental scores, 1-10 each) averaged and scaled to ~0-100; null if they've never run one. */
  perfIndex: number | null
}
