import { describe, it, expect, vi } from 'vitest'
import { getSharedTeam, publishTeam } from '../../src/lib/teamCore'
import type { PublishTeamInput } from '../../src/lib/team'

function chain(result: unknown) {
  const c: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'order', 'in', 'single', 'delete']) c[m] = vi.fn().mockReturnValue(c)
  c.then = (resolve: (v: unknown) => void) => resolve(result)
  return c
}

describe('getSharedTeam', () => {
  it('nests pool entries under their roster row and drops stray rows from other groups', async () => {
    const roster = chain({ data: [{ id: 'r1', group_id: 'g1', user_id: null, display_name: 'Top', ign: null, tag_line: null, region: null, role: 'TOP', status: 'starter', puuid: null, created_at: 't', updated_at: 't' }], error: null })
    const pool = chain({
      data: [
        { id: 'p1', roster_id: 'r1', champion_key: 'Renekton', role: 'TOP', tier: 'main', notes: null, play_rate: null, win_rate: null, mastery_points: null, updated_at: 't' },
        { id: 'p2', roster_id: 'r-other-group', champion_key: 'Ornn', role: 'TOP', tier: 'comfort', notes: null, play_rate: null, win_rate: null, mastery_points: null, updated_at: 't' },
      ],
      error: null,
    })
    const drafts = chain({ data: [], error: null })
    const scouting = chain({ data: [], error: null })
    const sb = { from: vi.fn((table: string) => ({ team_rosters: roster, team_pool_entries: pool, team_drafts: drafts, team_scouting: scouting }[table])) } as never

    const out = await getSharedTeam(sb, 'g1')
    expect(out.roster).toHaveLength(1)
    expect(out.roster[0].pool.map((p) => p.championKey)).toEqual(['Renekton'])
  })

  it('throws on a read error', async () => {
    const sb = { from: vi.fn(() => chain({ data: null, error: { message: 'boom' } })) } as never
    await expect(getSharedTeam(sb, 'g1')).rejects.toThrow('boom')
  })
})

describe('publishTeam', () => {
  const input: PublishTeamInput = {
    roster: [{
      displayName: 'Top', ign: 'Top#EUW', tagLine: 'EUW', region: 'EUW1', role: 'TOP', puuid: null,
      pool: [{ championKey: 'Renekton', role: 'TOP', tier: 'main', notes: null, playRate: null, winRate: null, masteryPoints: null }],
    }],
    drafts: [{ name: 'vs Rival', bluePicks: ['Renekton'], blueBans: [], redPicks: [], redBans: [], myTeamSide: 'blue', notes: null }],
    scouting: [{ name: 'Rival', tag: 'RIV', scoutNotes: null }],
  }

  it('clears the group\'s previous publish before writing the new snapshot', async () => {
    const calls: string[] = []
    const tables: Record<string, any> = {
      team_rosters: {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        delete: vi.fn(() => { calls.push('delete-rosters'); return { in: vi.fn().mockResolvedValue({ error: null }) } }),
        insert: vi.fn(() => { calls.push('insert-roster'); return { select: () => ({ single: () => Promise.resolve({ data: { id: 'r1' }, error: null }) }) } }),
        then: (resolve: (v: unknown) => void) => resolve({ data: [{ id: 'existing-1' }], error: null }),
      },
      team_pool_entries: { insert: vi.fn(() => { calls.push('insert-pool'); return Promise.resolve({ error: null }) }) },
      team_drafts: {
        delete: vi.fn(() => { calls.push('delete-drafts'); return { eq: vi.fn().mockResolvedValue({ error: null }) } }),
        insert: vi.fn(() => { calls.push('insert-drafts'); return Promise.resolve({ error: null }) }),
      },
      team_scouting: {
        delete: vi.fn(() => { calls.push('delete-scouting'); return { eq: vi.fn().mockResolvedValue({ error: null }) } }),
        insert: vi.fn(() => { calls.push('insert-scouting'); return Promise.resolve({ error: null }) }),
      },
    }
    const sb = { from: vi.fn((t: string) => tables[t]) } as never

    const result = await publishTeam(sb, 'g1', input)
    expect(calls).toContain('delete-rosters')
    expect(calls).toContain('delete-drafts')
    expect(calls).toContain('delete-scouting')
    expect(calls.indexOf('delete-rosters')).toBeLessThan(calls.indexOf('insert-roster'))
    expect(result.published).toBe(3) // 1 roster member + 1 draft + 1 scouting entry
  })
})
