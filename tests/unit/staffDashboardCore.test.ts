import { describe, it, expect, vi } from 'vitest'
import { getStaffDashboard } from '../../src/lib/staffDashboardCore'

function chain(result: unknown) {
  const c: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'limit', 'order']) c[m] = vi.fn().mockReturnValue(c)
  c.then = (resolve: (v: unknown) => void) => resolve(result)
  return c
}

const DAY = 86_400_000

describe('getStaffDashboard', () => {
  it('returns an empty array with no player members', async () => {
    const sb = { from: vi.fn(() => chain({ data: [], error: null })) } as never
    await expect(getStaffDashboard(sb, 'g1')).resolves.toEqual([])
  })

  it('aggregates form, backlog, dominant mistake, mood and alerts per player', async () => {
    const now = Date.now()
    const members = chain({ data: [{ user_id: 'p1', display_name: 'Top' }], error: null })
    const syncRows = [
      // 2 games this week, 1 win 1 loss among the last 10 -> winrate 50%
      { user_id: 'p1', table_name: 'Game', data: { id: 'g1', win: true, gameEndAt: now - 1 * DAY } },
      { user_id: 'p1', table_name: 'Game', data: { id: 'g2', win: false, gameEndAt: now - 2 * DAY } },
      // reviewed g1 only -> 1 done, 1 pending
      { user_id: 'p1', table_name: 'Review', data: { gameId: 'g1' } },
      { user_id: 'p1', table_name: 'MistakeTag', data: { id: 'tag1', label: 'Overstay' } },
      { user_id: 'p1', table_name: 'Mistake', data: { gameId: 'g2', tagId: 'tag1' } },
      { user_id: 'p1', table_name: 'CoachingExperiment', data: { problemId: 'vision', status: 'active', verdict: null, startedAt: now - 1 * DAY } },
    ]
    const records = chain({ data: syncRows, error: null })
    const checkins = chain({ data: [{ user_id: 'p1', mood: 4, created_at: new Date(now).toISOString() }], error: null })
    const sb = { from: vi.fn((t: string) => ({ group_members: members, sync_records: records, wellbeing_checkins: checkins }[t])) } as never

    const [row] = await getStaffDashboard(sb, 'g1')
    expect(row.displayName).toBe('Top')
    expect(row.winrateLast10).toBe(50)
    expect(row.gamesThisWeek).toBe(2)
    expect(row.reviewsDone).toBe(1)
    expect(row.reviewsPending).toBe(1)
    expect(row.dominantMistake).toEqual({ label: 'Overstay', count: 1 })
    expect(row.currentObjective).toEqual({ problemId: 'vision', status: 'active', verdict: null, passRate: null })
    expect(row.daysSinceLastGame).toBe(1)
    expect(row.alerts).toEqual([]) // not inactive (1 day), not > 3 pending, no no_effect verdict
    expect(row.recentMood).toBe(4)
    expect(row.winrateVsTeamAvg).toBe(0) // the only player with a winrate, so equal to the team average
  })

  it('returns a null mood for a player who has not shared wellbeing check-ins', async () => {
    const now = Date.now()
    const members = chain({ data: [{ user_id: 'p1', display_name: 'Top' }], error: null })
    const records = chain({ data: [{ user_id: 'p1', table_name: 'Game', data: { id: 'g1', win: true, gameEndAt: now } }], error: null })
    const checkins = chain({ data: [], error: null })
    const sb = { from: vi.fn((t: string) => ({ group_members: members, sync_records: records, wellbeing_checkins: checkins }[t])) } as never

    const [row] = await getStaffDashboard(sb, 'g1')
    expect(row.recentMood).toBeNull()
  })

  it('flags inactive, review backlog and a failing objective', async () => {
    const now = Date.now()
    const members = chain({ data: [{ user_id: 'p1', display_name: 'Jg' }], error: null })
    const games = Array.from({ length: 4 }, (_, i) => ({
      user_id: 'p1', table_name: 'Game', data: { id: `g${i}`, win: false, gameEndAt: now - (6 + i) * DAY },
    }))
    const syncRows = [
      ...games, // 4 games, 0 reviewed -> backlog of 4 (> 3), last game 6 days ago -> inactive
      { user_id: 'p1', table_name: 'CoachingExperiment', data: { problemId: 'deaths', status: 'done', verdict: 'no_effect', startedAt: now - 7 * DAY } },
    ]
    const records = chain({ data: syncRows, error: null })
    const checkins = chain({ data: [], error: null })
    const sb = { from: vi.fn((t: string) => ({ group_members: members, sync_records: records, wellbeing_checkins: checkins }[t])) } as never

    const [row] = await getStaffDashboard(sb, 'g1')
    expect(row.alerts).toEqual(expect.arrayContaining(['inactive', 'review_backlog', 'objective_failing']))
    expect(row.daysSinceLastGame).toBe(6)
  })

  it('computes winrateVsTeamAvg relative to the whole group, not just one player', async () => {
    const now = Date.now()
    const members = chain({
      data: [{ user_id: 'p1', display_name: 'Top' }, { user_id: 'p2', display_name: 'Jg' }],
      error: null,
    })
    const syncRows = [
      { user_id: 'p1', table_name: 'Game', data: { id: 'g1', win: true, gameEndAt: now } }, // 100%
      { user_id: 'p2', table_name: 'Game', data: { id: 'g2', win: false, gameEndAt: now } }, // 0%
    ]
    const records = chain({ data: syncRows, error: null })
    const checkins = chain({ data: [], error: null })
    const sb = { from: vi.fn((t: string) => ({ group_members: members, sync_records: records, wellbeing_checkins: checkins }[t])) } as never

    const rows = await getStaffDashboard(sb, 'g1')
    const top = rows.find((r) => r.playerId === 'p1')!
    const jg = rows.find((r) => r.playerId === 'p2')!
    expect(top.winrateVsTeamAvg).toBe(50) // 100 - team avg(50)
    expect(jg.winrateVsTeamAvg).toBe(-50) // 0 - team avg(50)
  })

  it('throws when the members query errors', async () => {
    const sb = { from: vi.fn(() => chain({ data: null, error: { message: 'boom' } })) } as never
    await expect(getStaffDashboard(sb, 'g1')).rejects.toThrow('boom')
  })
})
