import type { SupabaseClient } from '@supabase/supabase-js'
import type { MistakeTrend, PlayerWeeklyReport, TeamWeeklyReport } from './report'

/**
 * Weekly (and, since 14/11/2026, tournament-period) team/player report
 * (E9), same pattern as staffDashboardCore.ts: aggregated client-side from
 * `sync_records` (RLS already gates each player's rows by their own
 * sharing consent) plus `assigned_objectives`. No new table — a report is
 * a point-in-time computation, not stored.
 */

const RECENT_WINDOW = 10

function ts(v: unknown): number {
  return typeof v === 'number' ? v : Date.parse(String(v ?? '')) || 0
}

/**
 * The shared aggregation: everything in `[rangeStart, rangeEnd)`, with
 * mistake trends compared against the equal-length period right before it
 * (`[prevRangeStart, rangeStart)`). The weekly report uses the prior week as
 * that comparison period; a tournament report uses the same-length window
 * right before the tournament started.
 */
async function computeTeamReportForRange(
  sb: SupabaseClient, groupId: string, rangeStart: Date, rangeEnd: Date, prevRangeStart: Date,
): Promise<TeamWeeklyReport> {
  const rangeStartMs = rangeStart.getTime(), rangeEndMs = rangeEnd.getTime(), prevRangeStartMs = prevRangeStart.getTime()
  const weekStart = rangeStart.toISOString().slice(0, 10)
  const weekEnd = rangeEnd.toISOString().slice(0, 10)

  const { data: members, error: membersErr } = await sb.from('group_members')
    .select('user_id, display_name').eq('group_id', groupId).eq('role', 'player')
  if (membersErr) throw new Error(membersErr.message)
  const players = (members ?? []) as Array<{ user_id: string; display_name: string | null }>
  if (players.length === 0) {
    return { groupId, weekStart, weekEnd, players: [], totalGames: 0, avgWinrate: null }
  }
  const playerIds = players.map((p) => p.user_id)

  const [syncRes, objectivesRes] = await Promise.all([
    sb.from('sync_records').select('user_id, table_name, data')
      .in('user_id', playerIds).eq('deleted', false)
      .in('table_name', ['Game', 'Review', 'Mistake', 'MistakeTag', 'CoachingExperiment'])
      .limit(20000),
    sb.from('assigned_objectives').select('player_id, status, created_at, updated_at')
      .eq('group_id', groupId).in('player_id', playerIds).limit(2000),
  ])
  if (syncRes.error) throw new Error(syncRes.error.message)
  if (objectivesRes.error) throw new Error(objectivesRes.error.message)

  const byUser = new Map<string, typeof syncRes.data>()
  for (const r of syncRes.data ?? []) {
    const list = byUser.get(r.user_id) ?? []
    list.push(r)
    byUser.set(r.user_id, list)
  }

  const reports: PlayerWeeklyReport[] = players.map((p): PlayerWeeklyReport => {
    const userRows = byUser.get(p.user_id) ?? []
    const games = userRows.filter((r) => r.table_name === 'Game').map((r) => r.data as any)
    const thisRangeGames = games.filter((g) => ts(g.gameEndAt) >= rangeStartMs && ts(g.gameEndAt) < rangeEndMs)
    const prevRangeGames = games.filter((g) => ts(g.gameEndAt) >= prevRangeStartMs && ts(g.gameEndAt) < rangeStartMs)
    const thisRangeIds = new Set(thisRangeGames.map((g) => g.id))
    const prevRangeIds = new Set(prevRangeGames.map((g) => g.id))

    const reviewedGameIds = new Set(userRows.filter((r) => r.table_name === 'Review').map((r) => (r.data as any).gameId))
    const mistakeTagLabels = new Map<string, string>()
    for (const r of userRows.filter((r) => r.table_name === 'MistakeTag')) {
      mistakeTagLabels.set((r.data as any).id, (r.data as any).label ?? '?')
    }
    const thisRangeCounts = new Map<string, number>()
    const prevRangeCounts = new Map<string, number>()
    for (const r of userRows.filter((r) => r.table_name === 'Mistake')) {
      const m = r.data as any
      if (thisRangeIds.has(m.gameId)) thisRangeCounts.set(m.tagId, (thisRangeCounts.get(m.tagId) ?? 0) + 1)
      else if (prevRangeIds.has(m.gameId)) prevRangeCounts.set(m.tagId, (prevRangeCounts.get(m.tagId) ?? 0) + 1)
    }
    const tagIds = new Set([...thisRangeCounts.keys(), ...prevRangeCounts.keys()])
    const mistakeTrends: MistakeTrend[] = [...tagIds].map((tagId) => {
      const thisWeek = thisRangeCounts.get(tagId) ?? 0
      const lastWeek = prevRangeCounts.get(tagId) ?? 0
      const direction: MistakeTrend['direction'] = thisWeek > lastWeek ? 'up' : thisWeek < lastWeek ? 'down' : 'flat'
      return { label: mistakeTagLabels.get(tagId) ?? tagId, thisWeek, lastWeek, direction }
    }).sort((a, b) => b.thisWeek - a.thisWeek).slice(0, RECENT_WINDOW)

    const winrate = thisRangeGames.length > 0
      ? Math.round((thisRangeGames.filter((g) => g.win).length / thisRangeGames.length) * 100)
      : null
    const reviewsDone = thisRangeGames.filter((g) => reviewedGameIds.has(g.id)).length
    const reviewsPending = thisRangeGames.length - reviewsDone

    const experiments = userRows.filter((r) => r.table_name === 'CoachingExperiment').map((r) => r.data as any)
      .filter((e) => ts(e.startedAt) >= rangeStartMs && ts(e.startedAt) < rangeEndMs)
    const experimentVerdicts = experiments.map((e) => ({ problemId: e.problemId, verdict: e.verdict ?? null }))

    const playerObjectives = (objectivesRes.data ?? []).filter((o) => o.player_id === p.user_id)
    const objectivesAssigned = playerObjectives.filter((o) => {
      const t = Date.parse(o.created_at)
      return t >= rangeStartMs && t < rangeEndMs
    }).length
    const objectivesCompleted = playerObjectives.filter((o) => {
      if (o.status !== 'done') return false
      const t = Date.parse(o.updated_at)
      return t >= rangeStartMs && t < rangeEndMs
    }).length

    return {
      playerId: p.user_id, displayName: p.display_name ?? '?',
      gamesPlayed: thisRangeGames.length, winrate, reviewsDone, reviewsPending,
      mistakeTrends, objectivesAssigned, objectivesCompleted, experimentVerdicts,
    }
  })

  const totalGames = reports.reduce((sum, r) => sum + r.gamesPlayed, 0)
  const withWinrate = reports.filter((r) => r.winrate !== null)
  const avgWinrate = withWinrate.length > 0
    ? Math.round(withWinrate.reduce((sum, r) => sum + (r.winrate ?? 0), 0) / withWinrate.length)
    : null

  return { groupId, weekStart, weekEnd, players: reports, totalGames, avgWinrate }
}

export async function computeTeamWeeklyReport(sb: SupabaseClient, groupId: string, weekStartDate: string): Promise<TeamWeeklyReport> {
  const weekStart = new Date(`${weekStartDate}T00:00:00Z`)
  const weekEnd = new Date(weekStart); weekEnd.setUTCDate(weekEnd.getUTCDate() + 7)
  const prevWeekStart = new Date(weekStart); prevWeekStart.setUTCDate(prevWeekStart.getUTCDate() - 7)
  return computeTeamReportForRange(sb, groupId, weekStart, weekEnd, prevWeekStart)
}

/**
 * Post-tournament report: the given `calendar_event` (expected kind
 * 'tournament', but any event works) defines the window; the comparison
 * period is the equal-length stretch right before it started.
 */
export async function computeTeamReportForEvent(sb: SupabaseClient, groupId: string, eventId: string): Promise<TeamWeeklyReport> {
  const { data: event, error } = await sb.from('calendar_events').select('starts_at, ends_at').eq('id', eventId).single()
  if (error) throw new Error(error.message)
  const rangeStart = new Date(event.starts_at)
  const rangeEnd = new Date(event.ends_at)
  const prevRangeStart = new Date(rangeStart.getTime() - (rangeEnd.getTime() - rangeStart.getTime()))
  return computeTeamReportForRange(sb, groupId, rangeStart, rangeEnd, prevRangeStart)
}

/** A plain-text summary a staff member can paste into Discord or a message — no live link (that would need an Edge Function). */
export function reportToText(report: TeamWeeklyReport, groupName: string): string {
  const lines = [
    `${groupName} — report (${report.weekStart} → ${report.weekEnd})`,
    `Team: ${report.totalGames} games, ${report.avgWinrate ?? '—'}% average winrate`,
    '',
  ]
  for (const p of report.players) {
    lines.push(`${p.displayName}: ${p.gamesPlayed} games, ${p.winrate ?? '—'}% winrate, ${p.reviewsDone}/${p.gamesPlayed} reviewed`)
    const topMistake = p.mistakeTrends[0]
    if (topMistake) {
      const arrow = topMistake.direction === 'up' ? '↑' : topMistake.direction === 'down' ? '↓' : '→'
      lines.push(`  top mistake: ${topMistake.label} ${arrow} (${topMistake.lastWeek} → ${topMistake.thisWeek})`)
    }
    if (p.objectivesAssigned > 0 || p.objectivesCompleted > 0) {
      lines.push(`  objectives: ${p.objectivesCompleted}/${p.objectivesAssigned} completed`)
    }
    for (const e of p.experimentVerdicts) {
      lines.push(`  experiment "${e.problemId}": ${e.verdict ?? 'in progress'}`)
    }
  }
  return lines.join('\n')
}
