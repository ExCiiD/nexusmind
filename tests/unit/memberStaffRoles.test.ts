/**
 * #39 (multiple roles), client side: listMyGroups reads staff_roles (and copes without the column),
 * setMemberStaffRoles calls the owner-only RPC and maps its errors, and the Discord bot reads effective roles.
 * The rights themselves are checked on the database by scripts/test-member-staff-roles.mjs.
 */
import { describe, it, expect, vi } from 'vitest'
import { listMyGroups, setMemberStaffRoles } from '../../src/lib/collabCore'
import { getGroupMemberRoles, isChannelStaffRole } from '../../src/lib/discordBotCore'

const result = (data: unknown, error: unknown = null) => ({ data, error })

/** A fake client for listMyGroups: `hasStaffColumn` false answers 42703 to any select naming staff_roles. */
function groupsClient(hasStaffColumn: boolean) {
  const selects: string[] = []
  const missing = (cols: string) => !hasStaffColumn && cols.includes('staff_roles')
  const from = (table: string) => ({
    select: (cols: string) => {
      selects.push(`${table}: ${cols}`)
      const q: Record<string, unknown> = {}
      q.eq = () => q
      q.in = () => {
        if (table === 'group_members') {
          if (missing(cols)) return Promise.resolve(result(null, { code: '42703', message: 'no staff_roles' }))
          return Promise.resolve(result([
            { group_id: 'g1', user_id: 'me', role: 'player', is_captain: false, display_name: 'Me', riot_id: null, joined_at: 't',
              puuid: null, puuid_status: null, ...(cols.includes('staff_roles') ? { staff_roles: ['coach'] } : {}) },
            { group_id: 'g1', user_id: 'o', role: 'owner', is_captain: false, display_name: 'O', riot_id: null, joined_at: 't',
              puuid: null, puuid_status: null, ...(cols.includes('staff_roles') ? { staff_roles: [] } : {}) },
          ]))
        }
        if (table === 'groups') return Promise.resolve(result([{ id: 'g1', name: 'G', kind: 'team', logo_url: null }]))
        return Promise.resolve(result([]))
      }
      q.then = (resolve: (v: unknown) => void) => resolve(missing(cols)
        ? result(null, { code: '42703', message: 'no staff_roles' })
        : result([{ group_id: 'g1', role: 'player', ...(cols.includes('staff_roles') ? { staff_roles: ['coach', 'bogus'] } : {}) }]))
      return q
    },
  })
  return { client: { from } as never, selects }
}

describe('listMyGroups and staff roles', () => {
  it('reads my staff roles and each member\'s, dropping unknown values', async () => {
    const { client } = groupsClient(true)
    const [g] = await listMyGroups(client, 'me')
    expect(g.myRole).toBe('player')
    expect(g.myStaffRoles).toEqual(['coach'])
    expect(g.members.find((m) => m.userId === 'me')?.staffRoles).toEqual(['coach'])
    expect(g.members.find((m) => m.userId === 'o')?.staffRoles).toEqual([])
  })

  it('before the migration: same groups, the fields left out', async () => {
    const { client, selects } = groupsClient(false)
    const [g] = await listMyGroups(client, 'me')
    expect(g).not.toHaveProperty('myStaffRoles')
    expect(g.members[0]).not.toHaveProperty('staffRoles')
    expect(g.members[0]).toHaveProperty('puuid') // the puuid column is still read
    expect(selects.filter((s) => s.startsWith('group_members')).length).toBe(4) // 2 membership + 2 member selects
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
