import { describe, it, expect } from 'vitest'
import { listMemberLooks, setMyLook } from '../../src/lib/collabCore'

/** A Supabase client stub: records the calls, answers each awaited query
 *  (`.eq()` / `.in()`) with the next result in line. */
function fakeSupabase(results: Array<{ data?: unknown; error?: unknown }>) {
  const calls: unknown[][] = []
  const next = () => Promise.resolve({ data: null, error: null, ...(results.shift() ?? {}) })
  const query = {
    select: (...a: unknown[]) => { calls.push(['select', ...a]); return query },
    update: (...a: unknown[]) => { calls.push(['update', ...a]); return query },
    eq: (...a: unknown[]) => { calls.push(['eq', ...a]); return next() },
    in: (...a: unknown[]) => { calls.push(['in', ...a]); return next() },
  }
  const sb = { from: (table: string) => { calls.push(['from', table]); return query } }
  return { sb: sb as never, calls }
}

describe('setMyLook', () => {
  it("writes the icon and banner on the player's own memberships", async () => {
    const { sb, calls } = fakeSupabase([{ error: null }])
    await expect(setMyLook(sb, 'u1', { iconId: 'halo', bannerId: 'abysse' })).resolves.toBe(true)
    expect(calls).toEqual([
      ['from', 'group_members'],
      ['update', { profile_icon: 'halo', profile_banner: 'abysse' }],
      ['eq', 'user_id', 'u1'],
    ])
  })

  it('reports false when the write is refused (columns not there yet)', async () => {
    const { sb } = fakeSupabase([{ error: { message: 'column "profile_icon" does not exist', code: '42703' } }])
    await expect(setMyLook(sb, 'u1', { iconId: 'halo', bannerId: 'abysse' })).resolves.toBe(false)
  })

  it('sends nothing but artwork ids', async () => {
    const { sb, calls } = fakeSupabase([])
    await expect(setMyLook(sb, 'u1', { iconId: 'https://example.com/x.png', bannerId: 'abysse' })).resolves.toBe(false)
    expect(calls).toEqual([])
  })
})

describe('listMemberLooks', () => {
  it('returns nothing without memberships', async () => {
    const { sb, calls } = fakeSupabase([{ data: [] }])
    await expect(listMemberLooks(sb, 'u1')).resolves.toEqual([])
    expect(calls.filter((c) => c[0] === 'from')).toHaveLength(1)
  })

  it('returns nothing when the look columns are missing', async () => {
    const { sb } = fakeSupabase([
      { data: [{ group_id: 'g1' }] },
      { error: { message: 'column group_members.profile_icon does not exist', code: '42703' } },
    ])
    await expect(listMemberLooks(sb, 'u1')).resolves.toEqual([])
  })

  it('returns one look per member of my groups, artwork ids only', async () => {
    const { sb, calls } = fakeSupabase([
      { data: [{ group_id: 'g1' }, { group_id: 'g2' }] },
      {
        data: [
          { user_id: 'a', riot_id: 'Kaito#EUW', profile_icon: null, profile_banner: null },
          { user_id: 'a', riot_id: 'Kaito#EUW', profile_icon: 'brasier', profile_banner: 'abysse' },
          { user_id: 'b', riot_id: 'Nyra#EUW', profile_icon: '<img src=x>', profile_banner: 'fracture' },
          { user_id: 'c', riot_id: null, profile_icon: null, profile_banner: null },
        ],
      },
    ])
    await expect(listMemberLooks(sb, 'u1')).resolves.toEqual([
      { userId: 'a', riotId: 'Kaito#EUW', iconId: 'brasier', bannerId: 'abysse' },
      { userId: 'b', riotId: 'Nyra#EUW', iconId: null, bannerId: 'fracture' },
      { userId: 'c', riotId: null, iconId: null, bannerId: null },
    ])
    expect(calls).toContainEqual(['in', 'group_id', ['g1', 'g2']])
  })
})
