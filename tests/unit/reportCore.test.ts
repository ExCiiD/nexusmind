import { describe, it, expect, vi } from 'vitest'
import { computeTeamWeeklyReport, computeTeamReportForEvent, reportToText } from '../../src/lib/reportCore'
import type { TeamWeeklyReport } from '../../src/lib/report'

function chain(result: unknown) {
  const c: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'limit']) c[m] = vi.fn().mockReturnValue(c)
  c.single = vi.fn().mockResolvedValue(result)
  c.then = (resolve: (v: unknown) => void) => resolve(result)
  return c
}

const DAY = 86_400_000
const WEEK_START = '2026-11-16' // a Monday

describe('computeTeamWeeklyReport', () => {
  it('returns an empty report with no player members', async () => {
    const sb = { from: vi.fn(() => chain({ data: [], error: null })) } as never
    await expect(computeTeamWeeklyReport(sb, 'g1', WEEK_START)).resolves.toEqual({
      groupId: 'g1', weekStart: WEEK_START, weekEnd: '2026-11-23', players: [], totalGames: 0, avgWinrate: null,
    })
  })

  it('aggregates games/reviews/mistake trends/objectives/experiments for the week, split from the prior week', async () => {
    const weekStartMs = new Date(`${WEEK_START}T00:00:00Z`).getTime()
    const members = chain({ data: [{ user_id: 'p1', display_name: 'Top' }], error: null })
    const syncRows = [
      // this week: 2 games, 1 win -> 50% winrate, 1 reviewed
      { user_id: 'p1', table_name: 'Game', data: { id: 'g1', win: true, gameEndAt: weekStartMs + 1 * DAY } },
      { user_id: 'p1', table_name: 'Game', data: { id: 'g2', win: false, gameEndAt: weekStartMs + 2 * DAY } },
      { user_id: 'p1', table_name: 'Review', data: { gameId: 'g1' } },
      // last week: 1 game, used only for the mistake trend baseline
      { user_id: 'p1', table_name: 'Game', data: { id: 'g0', win: true, gameEndAt: weekStartMs - 3 * DAY } },
      { user_id: 'p1', table_name: 'MistakeTag', data: { id: 'tag1', label: 'Overstay' } },
      { user_id: 'p1', table_name: 'Mistake', data: { gameId: 'g0', tagId: 'tag1' } }, // last week: 1
      { user_id: 'p1', table_name: 'Mistake', data: { gameId: 'g1', tagId: 'tag1' } }, // this week: 1
      { user_id: 'p1', table_name: 'Mistake', data: { gameId: 'g2', tagId: 'tag1' } }, // this week: 2
      { user_id: 'p1', table_name: 'CoachingExperiment', data: { problemId: 'vision', verdict: 'improved', startedAt: weekStartMs + 1 * DAY } },
    ]
    const records = chain({ data: syncRows, error: null })
    const objectives = chain({
      data: [
        { player_id: 'p1', status: 'open', created_at: new Date(weekStartMs + 1 * DAY).toISOString(), updated_at: new Date(weekStartMs + 1 * DAY).toISOString() },
        { player_id: 'p1', status: 'done', created_at: new Date(weekStartMs - 10 * DAY).toISOString(), updated_at: new Date(weekStartMs + 2 * DAY).toISOString() },
      ],
      error: null,
    })
    const sb = { from: vi.fn((t: string) => ({ group_members: members, sync_records: records, assigned_objectives: objectives }[t])) } as never

    const report = await computeTeamWeeklyReport(sb, 'g1', WEEK_START)
    expect(report.totalGames).toBe(2)
    expect(report.avgWinrate).toBe(50)
    const [p] = report.players
    expect(p.gamesPlayed).toBe(2)
    expect(p.winrate).toBe(50)
    expect(p.reviewsDone).toBe(1)
    expect(p.reviewsPending).toBe(1)
    expect(p.mistakeTrends[0]).toEqual({ label: 'Overstay', thisWeek: 2, lastWeek: 1, direction: 'up' })
    expect(p.objectivesAssigned).toBe(1)
    expect(p.objectivesCompleted).toBe(1)
    expect(p.experimentVerdicts).toEqual([{ problemId: 'vision', verdict: 'improved' }])
  })

  it('throws on a read error', async () => {
    const sb = { from: vi.fn(() => chain({ data: null, error: { message: 'boom' } })) } as never
    await expect(computeTeamWeeklyReport(sb, 'g1', WEEK_START)).rejects.toThrow('boom')
  })
})

describe('computeTeamReportForEvent', () => {
  it('uses the calendar_events row\'s own window, and the equal-length period before it for mistake trends', async () => {
    const tournamentStart = new Date('2026-12-01T00:00:00Z').getTime()
    const tournamentEnd = new Date('2026-12-03T00:00:00Z').getTime() // 2-day tournament
    const event = chain({ data: { starts_at: '2026-12-01T00:00:00Z', ends_at: '2026-12-03T00:00:00Z' }, error: null })
    const members = chain({ data: [{ user_id: 'p1', display_name: 'Top' }], error: null })
    const syncRows = [
      { user_id: 'p1', table_name: 'Game', data: { id: 'g1', win: true, gameEndAt: tournamentStart + 1 * DAY } },
      // one game in the equal-length (2-day) window right before the tournament
      { user_id: 'p1', table_name: 'Game', data: { id: 'g0', win: false, gameEndAt: tournamentStart - 1 * DAY } },
    ]
    const records = chain({ data: syncRows, error: null })
    const objectives = chain({ data: [], error: null })
    const sb = { from: vi.fn((t: string) => ({ calendar_events: event, group_members: members, sync_records: records, assigned_objectives: objectives }[t])) } as never

    const report = await computeTeamReportForEvent(sb, 'g1', 'evt1')
    expect(report.weekStart).toBe('2026-12-01')
    expect(report.weekEnd).toBe('2026-12-03')
    expect(report.totalGames).toBe(1)
    expect(tournamentEnd - tournamentStart).toBe(2 * DAY)
  })
})

describe('reportToText', () => {
  it('renders a plain-text summary with the top mistake trend arrow', () => {
    const report: TeamWeeklyReport = {
      groupId: 'g1', weekStart: '2026-11-16', weekEnd: '2026-11-23', totalGames: 2, avgWinrate: 50,
      players: [{
        playerId: 'p1', displayName: 'Top', gamesPlayed: 2, winrate: 50, reviewsDone: 1, reviewsPending: 1,
        mistakeTrends: [{ label: 'Overstay', thisWeek: 2, lastWeek: 1, direction: 'up' }],
        objectivesAssigned: 1, objectivesCompleted: 1, experimentVerdicts: [{ problemId: 'vision', verdict: 'improved' }],
      }],
    }
    const text = reportToText(report, 'My Team')
    expect(text).toContain('My Team — report (2026-11-16 → 2026-11-23)')
    expect(text).toContain('Team: 2 games, 50% average winrate')
    expect(text).toContain('Top: 2 games, 50% winrate, 1/2 reviewed')
    expect(text).toContain('top mistake: Overstay ↑ (1 → 2)')
    expect(text).toContain('objectives: 1/1 completed')
    expect(text).toContain('experiment "vision": improved')
  })
})
