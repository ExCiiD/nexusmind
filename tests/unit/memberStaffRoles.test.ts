/**
 * #39 (multiple roles), client side: listMyGroups reads staff_roles (and copes without the column),
 * setMemberStaffRoles calls the owner-only RPC and maps its errors, and the Discord bot reads effective roles.
 * The rights themselves are checked on the database by scripts/test-member-staff-roles.mjs.
 */
import { describe, it, expect, vi } from 'vitest'
import { listMyGroups, setMemberStaffRoles, setMyAlsoPlays } from '../../src/lib/collabCore'
import { canReadWellbeing, playsInGroup } from '../../src/lib/permissions'
import { planGroupTeamSync } from '../../src/lib/groupTeamSyncCore'
import { resolveAttendeeScope } from '../../src/lib/calendarCore'
import type { GroupMember } from '../../src/lib/collab'
import { getGroupMemberRoles, isChannelStaffRole } from '../../src/lib/discordBotCore'

const result = (data: unknown, error: unknown = null) => ({ data, error })

/** A fake client for listMyGroups: any select naming a column of `missingColumns` answers 42703. */
function groupsClient(missingColumns: string[] = []) {
  const selects: string[] = []
  const missing = (cols: string) => missingColumns.some((c) => cols.includes(c))
  // PostgREST names the first missing column it meets.
  const missingError = (cols: string) => ({ code: '42703', message: `column group_members.${missingColumns.find((c) => cols.includes(c))} does not exist` })
  const from = (table: string) => ({
    select: (cols: string) => {
      selects.push(`${table}: ${cols}`)
      const q: Record<string, unknown> = {}
      q.eq = () => q
      q.in = () => {
        if (table === 'group_members') {
          if (missing(cols)) return Promise.resolve(result(null, missingError(cols)))
          return Promise.resolve(result([
            { group_id: 'g1', user_id: 'me', role: 'player', is_captain: false, display_name: 'Me', riot_id: null, joined_at: 't',
              puuid: null, puuid_status: null, ...(cols.includes('staff_roles') ? { staff_roles: ['coach'] } : {}) },
            { group_id: 'g1', user_id: 'o', role: 'owner', is_captain: false, display_name: 'O', riot_id: null, joined_at: 't',
              puuid: null, puuid_status: null, ...(cols.includes('staff_roles') ? { staff_roles: [] } : {}),
              ...(cols.includes('also_plays') ? { also_plays: true } : {}) },
          ]))
        }
        if (table === 'groups') return Promise.resolve(result([{ id: 'g1', name: 'G', kind: 'team', logo_url: null }]))
        return Promise.resolve(result([]))
      }
      q.then = (resolve: (v: unknown) => void) => resolve(missing(cols)
        ? result(null, missingError(cols))
        : result([{ group_id: 'g1', role: 'player', ...(cols.includes('staff_roles') ? { staff_roles: ['coach', 'bogus'] } : {}),
          ...(cols.includes('also_plays') ? { also_plays: false } : {}) }]))
      return q
    },
  })
  return { client: { from } as never, selects }
}

describe('listMyGroups and staff roles', () => {
  it('reads my staff roles and each member\'s, dropping unknown values', async () => {
    const { client } = groupsClient()
    const [g] = await listMyGroups(client, 'me')
    expect(g.myRole).toBe('player')
    expect(g.myStaffRoles).toEqual(['coach'])
    expect(g.members.find((m) => m.userId === 'me')?.staffRoles).toEqual(['coach'])
    expect(g.members.find((m) => m.userId === 'o')?.staffRoles).toEqual([])
  })

  it('reads also_plays: the owner who plays, false for me', async () => {
    const [g] = await listMyGroups(groupsClient().client, 'me')
    expect(g.myAlsoPlays).toBe(false)
    expect(g.members.find((m) => m.userId === 'o')?.alsoPlays).toBe(true)
  })

  it('before the migration: same groups, the fields left out', async () => {
    const { client, selects } = groupsClient(['staff_roles', 'also_plays'])
    const [g] = await listMyGroups(client, 'me')
    expect(g).not.toHaveProperty('myStaffRoles')
    expect(g).not.toHaveProperty('myAlsoPlays')
    expect(g.members[0]).not.toHaveProperty('staffRoles')
    expect(g.members[0]).not.toHaveProperty('alsoPlays')
    expect(g.members[0]).toHaveProperty('puuid') // the puuid column is still read
    // Each select drops the column the error names: 3 membership + 3 member selects.
    expect(selects.filter((s) => s.startsWith('group_members')).length).toBe(6)
  })

  it('a database with staff_roles but no also_plays: staff roles kept, the flag left out', async () => {
    const [g] = await listMyGroups(groupsClient(['also_plays']).client, 'me')
    expect(g.myStaffRoles).toEqual(['coach'])
    expect(g).not.toHaveProperty('myAlsoPlays')
    expect(g.members.find((m) => m.userId === 'o')).not.toHaveProperty('alsoPlays')
  })
})

describe('setMemberStaffRoles', () => {
  it('calls the RPC with the whole list and returns what was stored', async () => {
    const rpc = vi.fn().mockResolvedValue(result(['coach', 'manager']))
    expect(await setMemberStaffRoles({ rpc } as never, 'g', 'u', ['manager', 'coach'])).toEqual(['coach', 'manager'])
    expect(rpc).toHaveBeenCalledWith('set_member_staff_roles', { p_group: 'g', p_user: 'u', p_roles: ['manager', 'coach'] })
  })

  it('maps the RPC errors to codes the screens can translate', async () => {
    for (const [message, code, expected] of [
      ['FORBIDDEN', '42501', 'FORBIDDEN'],
      ['INVALID_ROLE', '22023', 'INVALID_ROLE'],
      ['OWNER_HAS_ALL_ROLES', '42501', 'OWNER_HAS_ALL_ROLES'],
      ['NOT_FOUND', 'P0002', 'NOT_FOUND'],
    ]) {
      const rpc = vi.fn().mockResolvedValue(result(null, { message, code }))
      await expect(setMemberStaffRoles({ rpc } as never, 'g', 'u', ['coach'])).rejects.toThrow(expected)
    }
  })
})

describe('Discord bot: effective roles', () => {
  const botClient = (row: unknown, missingColumn = false) => {
    const selects: string[] = []
    const from = () => ({
      select: (cols: string) => {
        selects.push(cols)
        const q: Record<string, unknown> = {}
        q.eq = () => q
        q.maybeSingle = () => Promise.resolve(missingColumn && cols.includes('staff_roles')
          ? result(null, { code: '42703', message: 'no column' })
          : result(row))
        return q
      },
    })
    return { client: { from } as never, selects }
  }

  it('a player who is also manager can set the channel', async () => {
    const { client } = botClient({ role: 'player', staff_roles: ['manager'] })
    const roles = await getGroupMemberRoles(client, 'g', 'u')
    expect(roles).toEqual(['player', 'manager'])
    expect(isChannelStaffRole(roles)).toBe(true)
  })

  it('a plain player or an analyst cannot, a non-member gets null', async () => {
    expect(isChannelStaffRole(await getGroupMemberRoles(botClient({ role: 'player', staff_roles: [] }).client, 'g', 'u'))).toBe(false)
    expect(isChannelStaffRole(await getGroupMemberRoles(botClient({ role: 'player', staff_roles: ['analyst'] }).client, 'g', 'u'))).toBe(false)
    expect(await getGroupMemberRoles(botClient(null).client, 'g', 'u')).toBeNull()
  })

  it('before the migration: the main role alone', async () => {
    const { client, selects } = botClient({ role: 'coach' }, true)
    expect(await getGroupMemberRoles(client, 'g', 'u')).toEqual(['coach'])
    expect(selects).toEqual(['role, staff_roles', 'role'])
  })
})

describe('the owner who also plays', () => {
  it('setMyAlsoPlays calls the owner-only RPC and maps FORBIDDEN', async () => {
    const rpc = vi.fn().mockResolvedValue(result(true))
    expect(await setMyAlsoPlays({ rpc } as never, 'g', true)).toBe(true)
    expect(rpc).toHaveBeenCalledWith('set_my_also_plays', { p_group: 'g', p_plays: true })
    const denied = vi.fn().mockResolvedValue(result(null, { message: 'FORBIDDEN', code: '42501' }))
    await expect(setMyAlsoPlays({ rpc: denied } as never, 'g', true)).rejects.toThrow('FORBIDDEN')
  })

  it('playsInGroup: a player, or an owner who also plays, never a staff member with the flag', () => {
    expect(playsInGroup({ role: 'player' })).toBe(true)
    expect(playsInGroup({ role: 'owner', alsoPlays: true })).toBe(true)
    expect(playsInGroup({ role: 'owner', alsoPlays: false })).toBe(false)
    expect(playsInGroup({ role: 'owner' })).toBe(false)
    expect(playsInGroup({ role: 'coach', alsoPlays: true })).toBe(false)
  })

  it('wellbeing: an owner who plays does not read it, as on the server', () => {
    expect(canReadWellbeing('owner', [], true)).toBe(false)
    expect(canReadWellbeing('owner', [], false)).toBe(true)
    expect(canReadWellbeing('owner')).toBe(true)
  })

  it('the team built from the group takes the owner who plays, not the one who does not', () => {
    const plan = planGroupTeamSync([
      { role: 'owner', alsoPlays: true, displayName: 'Boss', riotId: 'Boss#EUW' },
      { role: 'owner', alsoPlays: false, displayName: 'Other', riotId: 'Other#EUW' },
      { role: 'player', displayName: 'P', riotId: 'P#EUW' },
    ], [])
    expect(plan.add.map((a) => a.ign).sort()).toEqual(['Boss', 'P'])
  })

  it('"all players" includes the owner who plays, who stays in "all staff" too', () => {
    const m = (userId: string, role: GroupMember['role'], alsoPlays?: boolean): GroupMember =>
      ({ userId, role, isCaptain: false, displayName: null, riotId: null, joinedAt: 't', ...(alsoPlays !== undefined ? { alsoPlays } : {}) })
    const members = [m('o', 'owner', true), m('o2', 'owner', false), m('p', 'player'), m('c', 'coach')]
    expect(resolveAttendeeScope('all_players', members)).toEqual(['o', 'p'])
    expect(resolveAttendeeScope('all_staff', members)).toEqual(['o', 'o2', 'c'])
  })
})
