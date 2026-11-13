import type { SupabaseClient } from '@supabase/supabase-js'
import type { DashboardAlert, PlayerDashboardRow } from './staffDashboard'

/**
 * E2 staff dashboard: one row per player, aggregated client-side from
 * `sync_records` (RLS already gates each player's rows by their own
 * sharing consent — a player who opted out simply returns no rows here).
 *
 * Simplifications vs the full plan (documented, not silently dropped):
 * - "objectif en cours" uses the most recent CoachingExperiment row,
 *   whichever its status; a player with no running experiment shows null.
 * - the C2 alert ("verdict sans effet 2 fois sur le même objectif") is
 *   simplified to "the latest experiment's verdict is no_effect" — true
 *   same-objective-twice tracking is a follow-up.
 * - "humeur" (E6, wellbeing check-ins) isn't built yet, so it's omitted.
 */

const DAY = 86_400_000
const INACTIVE_DAYS = 5
const BACKLOG_THRESHOLD = 3
const RECENT_GAMES_WINDOW = 10

export async function getStaffDashboard(sb: SupabaseClient, groupId: string): Promise<PlayerDashboardRow[]> {
  const { data: members, error: membersErr } = await sb.from('group_members')
    .select('user_id, display_name').eq('group_id', groupId).eq('role', 'player')
  if (membersErr) throw new Error(membersErr.message)
  const players = (members ?? []) as Array<{ user_id: string; display_name: string | null }>
  if (players.length === 0) return []

  const playerIds = players.map((p) => p.user_id)
  const { data: rows, error } = await sb.from('sync_records')
    .select('user_id, table_name, record_id, data')
    .in('user_id', playerIds)
    .eq('deleted', false)
    .in('table_name', ['Game', 'Review', 'Mistake', 'MistakeTag', 'CoachingExperiment'])
    .limit(20000)
  if (error) throw new Error(error.message)

  const byUser = new Map<string, typeof rows>()
  for (const r of rows ?? []) {
    const list = byUser.get(r.user_id) ?? []
    list.push(r)
    byUser.set(r.user_id, list)
  }

  const now = Date.now()
  const ts = (v: unknown) => (typeof v === 'number' ? v : Date.parse(String(v ?? '')) || 0)

  return players.map((p): PlayerDashboardRow => {
    const userRows = byUser.get(p.user_id) ?? []
    const games = userRows.filter((r) => r.table_name === 'Game').map((r) => r.data as any)
      .sort((a, b) => ts(b.gameEndAt) - ts(a.gameEndAt))
    const reviewedGameIds = new Set(userRows.filter((r) => r.table_name === 'Review').map((r) => (r.data as any).gameId))
    const mistakeTagLabels = new Map<string, string>()
    for (const r of userRows.filter((r) => r.table_name === 'MistakeTag')) {
      mistakeTagLabels.set((r.data as any).id, (r.data as any).label ?? '?')
    }
    const recentGameIds = new Set(games.slice(0, RECENT_GAMES_WINDOW).map((g) => g.id))
    const mistakeCounts = new Map<string, number>()
    for (const r of userRows.filter((r) => r.table_name === 'Mistake')) {
      const m = r.data as any
      if (!recentGameIds.has(m.gameId)) continue
      mistakeCounts.set(m.tagId, (mistakeCounts.get(m.tagId) ?? 0) + 1)
    }
    let dominantMistake: PlayerDashboardRow['dominantMistake'] = null
    for (const [tagId, count] of mistakeCounts) {
      if (!dominantMistake || count > dominantMistake.count) {
        dominantMistake = { label: mistakeTagLabels.get(tagId) ?? tagId, count }
      }
    }

    const last10 = games.slice(0, RECENT_GAMES_WINDOW)
    const winrateLast10 = last10.length > 0
      ? Math.round((last10.filter((g) => g.win).length / last10.length) * 100)
      : null
    const weekAgo = now - 7 * DAY
    const gamesThisWeek = games.filter((g) => ts(g.gameEndAt) >= weekAgo).length
    const reviewsDone = last10.filter((g) => reviewedGameIds.has(g.id)).length
    const reviewsPending = last10.length - reviewsDone
    const daysSinceLastGame = games.length > 0 ? Math.floor((now - ts(games[0].gameEndAt)) / DAY) : null

    const experiments = userRows.filter((r) => r.table_name === 'CoachingExperiment').map((r) => r.data as any)
      .sort((a, b) => ts(b.startedAt) - ts(a.startedAt))
    const latestExperiment = experiments[0]
    const currentObjective: PlayerDashboardRow['currentObjective'] = latestExperiment
      ? { problemId: latestExperiment.problemId, status: latestExperiment.status, verdict: latestExperiment.verdict ?? null, passRate: latestExperiment.passRate ?? null }
      : null

    const alerts: DashboardAlert[] = []
    if (daysSinceLastGame !== null && daysSinceLastGame >= INACTIVE_DAYS) alerts.push('inactive')
    if (reviewsPending > BACKLOG_THRESHOLD) alerts.push('review_backlog')
    if (currentObjective?.verdict === 'no_effect') alerts.push('objective_failing')

    return {
      playerId: p.user_id, displayName: p.display_name ?? '?',
      gamesThisWeek, winrateLast10, reviewsDone, reviewsPending,
      dominantMistake, currentObjective, daysSinceLastGame, alerts,
    }
  })
}
