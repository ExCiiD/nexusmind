import { describe, it, expect, vi } from 'vitest'
import { getSharedTeam, getGroupRosterUserIds, publishTeam, listGroupTeams, addRosterMember, upsertPoolEntry } from '../../src/lib/teamCore'
import type { PublishTeamInput } from '../../src/lib/team'

function chain(result: unknown) {
  const c: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'is', 'order', 'in', 'single', 'delete']) c[m] = vi.fn().mockReturnValue(c)
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
    // WSC-06: the pool table is read for this group's roster rows only.
    expect(pool.in).toHaveBeenCalledWith('roster_id', ['r1'])
  })

  it('does not read the pool table at all for an empty roster', async () => {
    const pool = chain({ data: [], error: null })
    const empty = () => chain({ data: [], error: null })
    const tables: Record<string, unknown> = { team_rosters: empty(), team_pool_entries: pool, team_drafts: empty(), team_scouting: empty() }
    const from = vi.fn((table: string) => tables[table])
    await getSharedTeam({ from } as never, 'g1')
    expect(from).not.toHaveBeenCalledWith('team_pool_entries')
  })

  it('throws on a read error', async () => {
    const sb = { from: vi.fn(() => chain({ data: null, error: { message: 'boom' } })) } as never
    await expect(getSharedTeam(sb, 'g1')).rejects.toThrow('boom')
  })
})

describe('getGroupRosterUserIds', () => {
  it('returns the linked accounts of the group\'s own roster, scouted rows excluded', async () => {
    const roster = chain({ data: [{ user_id: 'u1' }, { user_id: null }, { user_id: 'u2' }], error: null })
    const from = vi.fn(() => roster)
    await expect(getGroupRosterUserIds({ from } as never, 'g1')).resolves.toEqual(['u1', 'u2'])
    expect(roster.eq).toHaveBeenCalledWith('group_id', 'g1')
    expect(roster.is).toHaveBeenCalledWith('scouting_id', null)
    expect(from).toHaveBeenCalledTimes(1)
  })
})

describe('publishTeam', () => {
  const input: PublishTeamInput = {
    roster: [{
      displayName: 'Top', ign: 'Top#EUW', tagLine: 'EUW', region: 'EUW1', role: 'TOP', puuid: null,
      pool: [{ championKey: 'Renekton', role: 'TOP', tier: 'main', notes: null, playRate: null, winRate: null, masteryPoints: null, kda: null }],
    }],
    drafts: [{ name: 'vs Rival', bluePicks: ['Renekton'], blueBans: [], redPicks: [], redBans: [], myTeamSide: 'blue', notes: null }],
    scouting: [{ name: 'Rival', tag: 'RIV', scoutNotes: null, roster: [] }],
  }

  it('clears the group\'s previous publish before writing the new snapshot', async () => {
    const calls: string[] = []
    const tables: Record<string, any> = {
      team_rosters: {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
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
        insert: vi.fn(() => {
          calls.push('insert-scouting')
          return { select: () => ({ single: () => Promise.resolve({ data: { id: 'scout-1' }, error: null }) }) }
        }),
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

describe('listGroupTeams (E14)', () => {
  it('returns a single synthetic own-team, keyed by groupId, even with zero members', async () => {
    const sb = { from: vi.fn((t: string) => {
      if (t === 'team_rosters') return chain({ data: [], error: null })
      throw new Error(`unexpected table ${t}`)
    }) } as never
    const teams = await listGroupTeams(sb, 'g1', { isOpponent: false })
    expect(teams).toHaveLength(1)
    expect(teams[0]).toMatchObject({ id: 'g1', isOpponent: false, members: [] })
  })

  it('returns one Team per scouted opponent, each with its own roster', async () => {
    const scoutRows = chain({ data: [{ id: 's1', group_id: 'g1', name: 'Rival', tag: 'RIV', scout_notes: null, created_at: 't', updated_at: 't' }], error: null })
    const rosterRows = chain({ data: [{ id: 'r1', group_id: 'g1', user_id: null, display_name: 'RivalTop', ign: null, tag_line: null, region: null, role: 'TOP', status: 'starter', puuid: null, scouting_id: 's1', created_at: 't', updated_at: 't' }], error: null })
    const poolRows = chain({ data: [], error: null })
    const sb = { from: vi.fn((t: string) => ({ team_scouting: scoutRows, team_rosters: rosterRows, team_pool_entries: poolRows }[t])) } as never
    const teams = await listGroupTeams(sb, 'g1', { isOpponent: true })
    expect(teams).toHaveLength(1)
    expect(teams[0].id).toBe('s1')
    expect(teams[0].isOpponent).toBe(true)
    expect(teams[0].members).toHaveLength(1)
    expect(teams[0].members?.[0].displayName).toBe('RivalTop')
  })

  it('returns no opponent teams when none are scouted yet', async () => {
    const sb = { from: vi.fn((t: string) => {
      if (t === 'team_scouting') return chain({ data: [], error: null })
      throw new Error(`unexpected table ${t}`)
    }) } as never
    expect(await listGroupTeams(sb, 'g1', { isOpponent: true })).toEqual([])
  })
})

describe('addRosterMember (E14)', () => {
  it('updates the existing roster row in place when the same Riot identity is re-added, instead of duplicating it', async () => {
    const existingRow = {
      id: 'r1', group_id: 'g1', user_id: null, display_name: 'Old Name', ign: 'Faker', tag_line: 'KR1',
      region: 'KR', role: 'MID', status: 'starter', puuid: null, scouting_id: null, created_at: 't', updated_at: 't',
    }
    const rosterMock: Record<string, unknown> = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      then: (resolve: (v: unknown) => void) => resolve({ data: [existingRow], error: null }),
      update: vi.fn(() => ({
        eq: () => ({ select: () => ({ single: () => Promise.resolve({ data: { ...existingRow, display_name: 'Faker' }, error: null }) }) }),
      })),
    }
    const sb = { from: vi.fn(() => rosterMock) } as never
    const result = await addRosterMember(sb, 'g1', null, { displayName: 'Faker', ign: 'Faker', tagLine: 'KR1', role: 'MID' })
    expect(result.id).toBe('r1')
    expect(result.displayName).toBe('Faker')
    expect(rosterMock.update).toHaveBeenCalled()
  })
})

describe('upsertPoolEntry (E14)', () => {
  it('upserts on (roster_id, champion_key, role) and round-trips kda', async () => {
    const poolMock = {
      upsert: vi.fn(() => ({
        select: () => ({
          single: () => Promise.resolve({
            data: { id: 'p1', roster_id: 'r1', champion_key: 'Renekton', role: 'TOP', tier: 'main', notes: null, play_rate: 10, win_rate: 60, mastery_points: null, kda: 2.5, updated_at: 't' },
            error: null,
          }),
        }),
      })),
    }
    const sb = { from: vi.fn(() => poolMock) } as never
    const entry = await upsertPoolEntry(sb, 'r1', 'Renekton', 'TOP', { tier: 'main', playRate: 10, winRate: 60, kda: 2.5 })
    expect(entry).toMatchObject({ championKey: 'Renekton', kda: 2.5, winRate: 60 })
    expect(poolMock.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ roster_id: 'r1', champion_key: 'Renekton', role: 'TOP', tier: 'main', play_rate: 10, win_rate: 60, kda: 2.5 }),
      { onConflict: 'roster_id,champion_key,role' },
    )
  })
})
