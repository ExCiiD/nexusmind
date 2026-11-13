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
}
