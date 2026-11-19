/**
 * #38 (19/11/2026): a renamed player keeps their role, champions and rank; their displayed name follows Riot.
 * The pure pieces, and the reads/writes that must keep working before the member_puuid migration (error 42703).
 */
import { describe, it, expect, vi } from 'vitest'
import { riotIdRename } from '../../src/lib/teamIdentity'
import { listMyGroups, membershipsToRefresh, needsPuuidVerification, updateMyMemberProfile, verifyMyMemberPuuid } from '../../src/lib/collabCore'
import type { Group } from '../../src/lib/collab'

vi.mock('../../electron/main/database', () => ({ getPrisma: () => { throw new Error('not used') } }))
vi.mock('../../electron/main/riotClient', () => ({ getAccountByPuuid: vi.fn() }))
const { membersToRefresh } = await import('../../electron/main/teamMemberRefresh')

describe('riotIdRename', () => {
  it('nothing to change when Riot reports the same Riot ID', () => {
    expect(riotIdRename({ ign: 'Ayura', tagLine: 'EUW', displayName: 'Ayura' }, { gameName: 'Ayura', tagLine: 'EUW' })).toBeNull()
  })
  it('a rename: new ign and tag; the display name follows when it was the Riot name', () => {
    expect(riotIdRename({ ign: 'ore wa ayura', tagLine: 'EUW', displayName: 'ore wa ayura' }, { gameName: 'Ayura', tagLine: 'ADC' }))
      .toEqual({ ign: 'Ayura', tagLine: 'ADC', displayName: 'Ayura' })
  })
  it('a display name typed by the staff is kept', () => {
    expect(riotIdRename({ ign: 'ore wa ayura', tagLine: 'EUW', displayName: 'Our ADC' }, { gameName: 'Ayura', tagLine: 'EUW' }))
      .toEqual({ ign: 'Ayura', tagLine: 'EUW' })
  })
  it('an incomplete answer from Riot changes nothing', () => {
    expect(riotIdRename({ ign: 'A', tagLine: 'EUW' }, { gameName: '', tagLine: 'EUW' })).toBeNull()
    expect(riotIdRename({ ign: 'A', tagLine: 'EUW' }, { gameName: 'B', tagLine: null })).toBeNull()
  })
})

const group = (id: string, me: Partial<Group['members'][number]>): Group => ({
  id, name: id, kind: 'team', logoUrl: null, myRole: 'player',
  members: [{ userId: 'u1', role: 'player', isCaptain: false, displayName: 'A', riotId: 'Ayura#EUW', joinedAt: 't', ...me }],
  sharing: { shareReviews: true, shareStats: true, shareTeam: true, shareWellbeing: false },
} as Group)

describe('membershipsToRefresh', () => {
  const me = { displayName: 'Ayura', riotId: 'Ayura#EUW', puuid: 'P1' }
  it('only the memberships whose Riot ID differs get the new Riot ID', () => {
    const groups = [group('stale-name', { riotId: 'ore wa ayura#EUW', puuid: 'P1' }), group('no-puuid', { puuid: null }), group('ok', { puuid: 'P1' })]
    expect(membershipsToRefresh(groups, 'u1', me)).toEqual(['stale-name'])
  })
  it('a missing or different server puuid asks the server to verify (the app never writes it)', () => {
    expect(needsPuuidVerification([group('g', { puuid: null })], 'u1', me)).toBe(true)
    expect(needsPuuidVerification([group('g', { puuid: 'someone-else' })], 'u1', me)).toBe(true)
    expect(needsPuuidVerification([group('g', { puuid: 'P1' })], 'u1', me)).toBe(false)
  })
  it('before the migration (puuid absent), nothing to verify', () => {
    expect(needsPuuidVerification([group('g', {})], 'u1', me)).toBe(false)
    expect(membershipsToRefresh([group('g', { riotId: 'old#EUW' })], 'u1', me)).toEqual(['g'])
  })
  it('nothing to publish without a Riot ID of our own (web)', () => {
    expect(membershipsToRefresh([group('g', { riotId: 'old#EUW' })], 'u1', { displayName: 'A', riotId: null })).toEqual([])
  })
})

describe('the puuid is written by the server only (#38 CyberSecurity review)', () => {
  it('updateMyMemberProfile never sends the puuid', async () => {
    const patches: unknown[] = []
    const update = vi.fn((patch: unknown) => { patches.push({ ...(patch as object) }); return { eq: () => ({ eq: vi.fn().mockResolvedValue({ error: null }) }) } })
    await updateMyMemberProfile({ from: () => ({ update }) } as never, 'u1', 'g1', { displayName: 'Ayura', riotId: 'Ayura#EUW', puuid: 'P1' })
    expect(patches).toEqual([{ display_name: 'Ayura', riot_id: 'Ayura#EUW' }])
  })
  it('verifyMyMemberPuuid calls the Edge Function, and does nothing if it is not deployed', async () => {
    const invoke = vi.fn().mockResolvedValueOnce({ data: { verified: 2, conflicts: [] }, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'Function not found' } })
    const sb = { functions: { invoke } } as never
    await expect(verifyMyMemberPuuid(sb)).resolves.toEqual({ verified: 2, conflicts: [] })
    await expect(verifyMyMemberPuuid(sb)).resolves.toBeNull()
    expect(invoke).toHaveBeenCalledWith('verify-member-puuid', { method: 'POST' })
  })
})

describe('before the member_puuid migration (column missing, 42703)', () => {
  it('listMyGroups lists the members without their puuid', async () => {
    const result = (data: unknown, error: unknown = null) => ({ data, error })
    const memberSelects: string[] = []
    const from = (table: string) => ({
      select: (cols: string) => {
        const q: Record<string, unknown> = {}
        q.eq = () => q
        q.in = () => {
          if (table === 'group_members') {
            memberSelects.push(cols)
            return Promise.resolve(cols.includes('puuid')
              ? result(null, { code: '42703', message: 'column group_members.puuid does not exist' })
              : result([{ group_id: 'g1', user_id: 'u1', role: 'player', is_captain: false, display_name: 'A', riot_id: 'Ayura#EUW', joined_at: 't' }]))
          }
          if (table === 'groups') return Promise.resolve(result([{ id: 'g1', name: 'G', kind: 'team', logo_url: null }]))
          return Promise.resolve(result([]))
        }
        q.then = (resolve: (v: unknown) => void) => resolve(result([{ group_id: 'g1', role: 'player' }]))
        return q
      },
    })
    const groups = await listMyGroups({ from } as never, 'u1')
    expect(groups[0].members[0]).not.toHaveProperty('puuid')
    // With every optional column, then again without the one the error names (puuid and puuid_status go together).
    expect(memberSelects).toHaveLength(2)
    expect(memberSelects[1]).not.toContain('puuid')
    expect(memberSelects[1]).toContain('staff_roles')
  })
})

describe('membersToRefresh (coach side)', () => {
  const m = (id: string, puuid: string | null, region: string | null = 'EUW1') => ({ id, puuid, region, ign: 'x', tagLine: 'y', displayName: 'x' })
  it('members with a puuid and a region, once per run', () => {
    expect(membersToRefresh([m('a', 'P1'), m('b', null), m('c', 'P3', null), m('d', 'P4')], new Set(['d'])).map((x) => x.id)).toEqual(['a'])
  })
})
