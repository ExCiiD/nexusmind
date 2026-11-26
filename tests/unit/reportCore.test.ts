import { describe, it, expect, vi } from 'vitest'
import { computeTeamWeeklyReport, computeTeamReportForEvent, computeTeamPeriodReport, periodRange, recurringMistakes, reportToText, createReportShare, revokeReportShare } from '../../src/lib/reportCore'
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

describe('createReportShare / revokeReportShare', () => {
  const report: TeamWeeklyReport = {
    groupId: 'g1', weekStart: '2026-11-16', weekEnd: '2026-11-23', totalGames: 2, avgWinrate: 50,
    players: [],
  }

  it('createReportShare inserts a snapshot and computes the share URL from the token', async () => {
    const insert = vi.fn((row: { group_id: string; token: string; group_name: string; report: unknown }) => {
      expect(row.group_id).toBe('g1')
      expect(row.group_name).toBe('My Team')
      expect(row.report).toEqual(report)
      return {
        select: () => ({
          single: () => Promise.resolve({
            data: { id: 's1', group_id: row.group_id, token: row.token, group_name: row.group_name, report: row.report, created_at: 't' },
            error: null,
          }),
        }),
      }
    })
    const sb = { from: vi.fn(() => ({ insert })) } as never
    const share = await createReportShare(sb, 'g1', 'My Team', report, 'https://proj.supabase.co')
    expect(share.groupId).toBe('g1')
    expect(share.token).toMatch(/^[a-f0-9]{40}$/)
    expect(share.url).toBe(`https://proj.supabase.co/functions/v1/team-report/${share.token}`)
  })

  it('revokeReportShare deletes by id', async () => {
    const del = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) }))
    const sb = { from: vi.fn(() => ({ delete: del })) } as never
    await revokeReportShare(sb, 's1')
    expect(del).toHaveBeenCalled()
  })
})

describe('periodRange', () => {
  it('is [from, to + 1 day) with the equal-length window before', () => {
    const r = periodRange('2026-12-01', '2026-12-03')
    expect(r.start.toISOString()).toBe('2026-12-01T00:00:00.000Z')
    expect(r.end.toISOString()).toBe('2026-12-04T00:00:00.000Z')
    expect(r.prevStart.toISOString()).toBe('2026-11-28T00:00:00.000Z')
  })
  it('accepts one day and refuses bad ranges', () => {
    expect(periodRange('2026-12-01', '2026-12-01').end.toISOString()).toBe('2026-12-02T00:00:00.000Z')
    expect(() => periodRange('2026-12-03', '2026-12-01')).toThrow('INVALID_PERIOD')
    expect(() => periodRange('2026-12-01', '2027-06-01')).toThrow('at most 92 days')
    expect(() => periodRange('12/01/2026', '2026-12-02')).toThrow('INVALID_PERIOD')
    expect(() => periodRange('2026-13-45', '2026-13-46')).toThrow('INVALID_PERIOD')
  })
})

describe('recurringMistakes', () => {
  const player = (id: string, trends: Array<[string, number, number]>) => ({
    playerId: id, displayName: id, gamesPlayed: 1, winrate: 0, reviewsDone: 0, reviewsPending: 0, objectivesAssigned: 0, objectivesCompleted: 0, experimentVerdicts: [],
    mistakeTrends: trends.map(([label, thisWeek, lastWeek]) => ({ label, thisWeek, lastWeek, direction: 'flat' as const })),
  })
  it('sums across players, most frequent first, ignoring mistakes absent from the period', () => {
    const out = recurringMistakes([player('a', [['Overstay', 3, 1], ['Vision', 0, 4]]), player('b', [['Overstay', 2, 0], ['Wave', 1, 1]])])
    expect(out).toEqual([
      { label: 'Overstay', count: 5, previousCount: 1, players: 2 },
      { label: 'Wave', count: 1, previousCount: 1, players: 1 },
    ])
  })
  it('keeps at most the limit', () => {
    const many = player('a', Array.from({ length: 9 }, (_, i) => [`m${i}`, 9 - i, 0] as [string, number, number]))
    expect(recurringMistakes([many])).toHaveLength(5)
  })
})

describe('computeTeamPeriodReport', () => {
  it('computes the window of the dates and adds the recurring mistakes', async () => {
    const start = new Date('2026-12-01T00:00:00Z').getTime()
    const members = chain({ data: [{ user_id: 'p1', display_name: 'Top' }], error: null })
    const rows = [
      { user_id: 'p1', table_name: 'Game', data: { id: 'g1', win: true, gameEndAt: start + 2 * DAY } },
      { user_id: 'p1', table_name: 'MistakeTag', data: { id: 't1', label: 'Overstay' } },
      { user_id: 'p1', table_name: 'Mistake', data: { gameId: 'g1', tagId: 't1' } },
    ]
    const sb = { from: vi.fn((t: string) => ({ group_members: members, sync_records: chain({ data: rows, error: null }), assigned_objectives: chain({ data: [], error: null }) }[t])) } as never
    const report = await computeTeamPeriodReport(sb, 'g1', '2026-12-01', '2026-12-07')
    expect(report.weekStart).toBe('2026-12-01')
    expect(report.weekEnd).toBe('2026-12-08')
    expect(report.totalGames).toBe(1)
    expect(report.recurringMistakes).toEqual([{ label: 'Overstay', count: 1, previousCount: 0, players: 1 }])
  })
  it('refuses a bad range before reading anything', async () => {
    const sb = { from: vi.fn() } as never
    await expect(computeTeamPeriodReport(sb, 'g1', '2026-12-05', '2026-12-01')).rejects.toThrow('INVALID_PERIOD')
    expect((sb as any).from).not.toHaveBeenCalled()
  })
})

describe('reportToText, period sections', () => {
  it('adds the recurring mistakes and the analyst conclusions', () => {
    const text = reportToText({
      groupId: 'g1', weekStart: '2026-12-01', weekEnd: '2026-12-08', totalGames: 0, avgWinrate: null, players: [],
      recurringMistakes: [{ label: 'Overstay', count: 5, previousCount: 1, players: 2 }],
      analystConclusions: '  Ban Nidalee.  ',
    }, 'Team')
    expect(text).toContain('Recurring mistakes:')
    expect(text).toContain('Overstay: 5 (before: 1), 2 player(s)')
    expect(text).toContain('Analyst conclusions:\nBan Nidalee.')
  })
})
