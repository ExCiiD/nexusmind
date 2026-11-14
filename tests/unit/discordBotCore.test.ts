import { describe, it, expect, vi } from 'vitest'
import { redeemGuildLinkCode, redeemUserLinkCode, markNotifiedOnce, findRoleReplacements } from '../../src/lib/discordBotCore'

function chain(result: unknown) {
  const c: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'is', 'maybeSingle', 'delete', 'insert']) c[m] = vi.fn().mockReturnValue(c)
  c.then = (resolve: (v: unknown) => void) => resolve(result)
  return c
}

describe('redeemGuildLinkCode', () => {
  it('links the guild and consumes the code when it is valid and unexpired', async () => {
    const future = new Date(Date.now() + 60_000).toISOString()
    const calls: string[] = []
    const tables: Record<string, any> = {
      discord_guild_link_codes: {
        select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
        maybeSingle: () => Promise.resolve({ data: { group_id: 'g1', expires_at: future, created_by: 'u1' }, error: null }),
        delete: vi.fn(() => { calls.push('delete-code'); return { eq: vi.fn().mockResolvedValue({ error: null }) } }),
      },
      discord_guild_links: {
        upsert: vi.fn((row: unknown, opts: unknown) => { calls.push('upsert-link'); expect(opts).toEqual({ onConflict: 'guild_id' }); return Promise.resolve({ error: null }) }),
      },
    }
    const sb = { from: vi.fn((t: string) => tables[t]) } as never
    const groupId = await redeemGuildLinkCode(sb, 'ABC123', 'guild-1')
    expect(groupId).toBe('g1')
    expect(calls).toEqual(['delete-code', 'upsert-link'])
  })

  it('returns null for an expired code without touching discord_guild_links', async () => {
    const past = new Date(Date.now() - 60_000).toISOString()
    const upsert = vi.fn()
    const tables: Record<string, any> = {
      discord_guild_link_codes: chain({ data: { group_id: 'g1', expires_at: past, created_by: 'u1' }, error: null }),
      discord_guild_links: { upsert },
    }
    const sb = { from: vi.fn((t: string) => tables[t]) } as never
    expect(await redeemGuildLinkCode(sb, 'ABC123', 'guild-1')).toBeNull()
    expect(upsert).not.toHaveBeenCalled()
  })

  it('returns null for a code that does not exist', async () => {
    const sb = { from: vi.fn(() => chain({ data: null, error: null })) } as never
    expect(await redeemGuildLinkCode(sb, 'NOPE12', 'guild-1')).toBeNull()
  })
})

describe('redeemUserLinkCode', () => {
  it('links the discord user and consumes the code when valid', async () => {
    const future = new Date(Date.now() + 60_000).toISOString()
    const tables: Record<string, any> = {
      discord_user_link_codes: {
        select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
        maybeSingle: () => Promise.resolve({ data: { user_id: 'user-1', expires_at: future }, error: null }),
        delete: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) })),
      },
      discord_user_links: { upsert: vi.fn(() => Promise.resolve({ error: null })) },
    }
    const sb = { from: vi.fn((t: string) => tables[t]) } as never
    expect(await redeemUserLinkCode(sb, 'XYZ999', 'discord-user-1')).toBe('user-1')
  })
})

describe('markNotifiedOnce', () => {
  it('returns true on first insert', async () => {
    const sb = { from: vi.fn(() => ({ insert: () => Promise.resolve({ error: null }) })) } as never
    expect(await markNotifiedOnce(sb, 'g1', 'event', 'e1')).toBe(true)
  })

  it('returns false (not an error) when the dedupe key already exists', async () => {
    const sb = { from: vi.fn(() => ({ insert: () => Promise.resolve({ error: { message: 'duplicate key', code: '23505' } }) })) } as never
    expect(await markNotifiedOnce(sb, 'g1', 'event', 'e1')).toBe(false)
  })

  it('still throws on a real error', async () => {
    const sb = { from: vi.fn(() => ({ insert: () => Promise.resolve({ error: { message: 'boom', code: '500' } }) })) } as never
    await expect(markNotifiedOnce(sb, 'g1', 'event', 'e1')).rejects.toThrow('boom')
  })
})

describe('findRoleReplacements', () => {
  it('excludes the away player and anyone without a matching rule/exception', async () => {
    const tables: Record<string, any> = {
      team_rosters: chain({
        data: [
          { id: 'r1', user_id: 'away-user', display_name: 'Away Player' },
          { id: 'r2', user_id: 'free-user', display_name: 'Free Player' },
          { id: 'r3', user_id: 'busy-user', display_name: 'Busy Player' },
          { id: 'r4', user_id: null, display_name: 'No Account' },
        ],
        error: null,
      }),
      availability_rules: chain({ data: [{ user_id: 'free-user', weekday: 1 }, { user_id: 'busy-user', weekday: 1 }], error: null }),
      availability_exceptions: chain({ data: [{ user_id: 'busy-user', available: false }], error: null }),
    }
    const sb = { from: vi.fn((t: string) => tables[t]) } as never
    // 2026-11-16 is a Monday (weekday 1).
    const candidates = await findRoleReplacements(sb, 'g1', 'TOP', '2026-11-16', 'away-user')
    expect(candidates).toEqual([{ rosterId: 'r2', userId: 'free-user', displayName: 'Free Player' }])
  })
})
