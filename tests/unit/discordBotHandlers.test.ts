import { describe, it, expect, vi } from 'vitest'
import { handleAvailability, handleSetChannel, handleLinkTeam, type Interaction } from '../../cloudflare/discord-bot/src/handlers'
import { canManageDiscordServer, isChannelStaffRole, DISCORD_MANAGER_ROLES } from '../../src/lib/discordBotCore'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * S19-03 (docs/AUDIT_SECURITE.md, 19/11/2026): the bot writes with the
 * service role, so the handlers must check who may act on the group.
 */

interface Fake {
  /** Ascend user linked to the Discord user, or null. */
  linkedUser: string | null
  /** That user's role in the server's group, or null when not a member. */
  memberRole: string | null
}

function fakeSupabase(f: Fake) {
  const writes: string[] = []
  const chain = (table: string) => {
    let result: { data: unknown; error: null } = { data: null, error: null }
    const c: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'is', 'in', 'order', 'limit', 'gte', 'lte', 'filter']) c[m] = vi.fn().mockReturnValue(c)
    c.maybeSingle = vi.fn(() => {
      if (table === 'discord_guild_links') result = { data: { group_id: 'g1', notify_channel_id: null }, error: null }
      if (table === 'discord_user_links') result = { data: f.linkedUser ? { user_id: f.linkedUser } : null, error: null }
      if (table === 'group_members') result = { data: f.memberRole ? { role: f.memberRole } : null, error: null }
      if (table === 'team_rosters') result = { data: null, error: null }
      return c
    })
    c.upsert = vi.fn(() => { writes.push(`upsert:${table}`); return c })
    c.update = vi.fn(() => { writes.push(`update:${table}`); return c })
    c.delete = vi.fn(() => { writes.push(`delete:${table}`); return c })
    c.then = (resolve: (v: unknown) => void) => resolve(table === 'scrims' ? { data: [], error: null } : result)
    return c
  }
  return { sb: { from: vi.fn((t: string) => chain(t)) } as never, writes }
}

async function reply(res: Response): Promise<string> {
  return ((await res.json()) as { data: { content: string } }).data.content
}

const awayCmd = (): Interaction => ({
  guild_id: 'guild1', member: { user: { id: 'd1' } },
  data: { name: 'availability', options: [{ name: 'away', options: [{ name: 'date', value: '2026-11-25' }] } as never] },
})
const backCmd = (): Interaction => ({
  guild_id: 'guild1', member: { user: { id: 'd1' } },
  data: { name: 'availability', options: [{ name: 'back', options: [{ name: 'date', value: '2026-11-25' }] } as never] },
})

describe('/availability', () => {
  it('refuses a linked Ascend user who is not a member of the server\'s group', async () => {
    const { sb, writes } = fakeSupabase({ linkedUser: 'u-outsider', memberRole: null })
    expect(await reply(await handleAvailability(awayCmd(), sb))).toMatch(/not a member/)
    expect(await reply(await handleAvailability(backCmd(), sb))).toMatch(/not a member/)
    expect(writes).toEqual([])
  })
  it('lets a member mark themselves away', async () => {
    const { sb, writes } = fakeSupabase({ linkedUser: 'u1', memberRole: 'player' })
    expect(await reply(await handleAvailability(awayCmd(), sb))).toMatch(/Marked you away/)
    expect(writes).toEqual(['upsert:availability_exceptions'])
  })
})

describe('/set-channel', () => {
  const cmd = (permissions?: string): Interaction => ({
    guild_id: 'guild1', channel_id: 'c1', member: { user: { id: 'd1' }, permissions }, data: { name: 'set-channel' },
  })
  it('refuses a plain server member who is not the group\'s staff', async () => {
    const { sb, writes } = fakeSupabase({ linkedUser: 'u1', memberRole: 'player' })
    expect(await reply(await handleSetChannel(cmd('0'), sb))).toMatch(/Only server admins/)
    expect(writes).toEqual([])
  })
  it('refuses someone with no linked Ascend account and no admin right', async () => {
    const { sb, writes } = fakeSupabase({ linkedUser: null, memberRole: null })
    expect(await reply(await handleSetChannel(cmd(), sb))).toMatch(/Only server admins/)
    expect(writes).toEqual([])
  })
  it('accepts a member with Manage Server', async () => {
    const { sb, writes } = fakeSupabase({ linkedUser: null, memberRole: null })
    expect(await reply(await handleSetChannel(cmd(String(1 << 5)), sb))).toMatch(/Reminders/)
    expect(writes).toEqual(['update:discord_guild_links'])
  })
  it('accepts the group\'s coach without Discord admin rights', async () => {
    const { sb, writes } = fakeSupabase({ linkedUser: 'u1', memberRole: 'coach' })
    expect(await reply(await handleSetChannel(cmd('0'), sb))).toMatch(/Reminders/)
    expect(writes).toEqual(['update:discord_guild_links'])
  })
})

describe('/link-team', () => {
  const cmd = (permissions?: string): Interaction => ({
    guild_id: 'guild1', member: { user: { id: 'd1' }, permissions },
    data: { name: 'link-team', options: [{ name: 'code', value: 'ABC123' }] },
  })
  it('refuses a member without Manage Server, before reading the code', async () => {
    const { sb, writes } = fakeSupabase({ linkedUser: 'u1', memberRole: 'coach' })
    expect(await reply(await handleLinkTeam(cmd('0'), sb))).toMatch(/Only server admins/)
    expect((sb as unknown as { from: ReturnType<typeof vi.fn> }).from).not.toHaveBeenCalled()
    expect(writes).toEqual([])
  })
  it('says so when the server is already linked to another team', async () => {
    const future = new Date(Date.now() + 60_000).toISOString()
    const from = vi.fn((table: string) => {
      const c: Record<string, unknown> = {}
      for (const m of ['select', 'eq']) c[m] = vi.fn().mockReturnValue(c)
      c.maybeSingle = vi.fn(async () => table === 'discord_guild_link_codes'
        ? { data: { group_id: 'g1', expires_at: future, created_by: 'u1' }, error: null }
        : { data: { group_id: 'g-other', notify_channel_id: null }, error: null })
      c.delete = vi.fn(() => { throw new Error('must not consume the code') })
      c.upsert = vi.fn(() => { throw new Error('must not relink') })
      return c
    })
    expect(await reply(await handleLinkTeam(cmd(String(1 << 5)), { from } as never))).toMatch(/already linked to another/)
  })
})

describe('permission helpers', () => {
  it('reads Manage Server and Administrator from the bit string', () => {
    expect(canManageDiscordServer(String(1 << 5))).toBe(true)
    expect(canManageDiscordServer(String(1 << 3))).toBe(true)
    expect(canManageDiscordServer((1n << 40n | 1n << 5n).toString())).toBe(true)
    expect(canManageDiscordServer('2048')).toBe(false)
    expect(canManageDiscordServer(undefined)).toBe(false)
    expect(canManageDiscordServer('abc')).toBe(false)
  })
  it('staff roles for the channel', () => {
    expect(['owner', 'coach', 'manager'].every(isChannelStaffRole)).toBe(true)
    expect(isChannelStaffRole('player')).toBe(false)
    expect(isChannelStaffRole('analyst')).toBe(false)
    expect(isChannelStaffRole(null)).toBe(false)
  })
  it('one list of Discord roles for the bot and the server (#34)', () => {
    const sql = readFileSync(resolve(__dirname, '../../supabase/migrations/20261119165350_discord_unlink_guild.sql'), 'utf-8')
    const m = sql.match(/function private\.is_discord_manager[\s\S]*?role in \(([^)]*)\)/)
    expect(m).not.toBeNull()
    const serverRoles = m![1].split(',').map((s) => s.trim().replace(/'/g, ''))
    expect(serverRoles).toEqual([...DISCORD_MANAGER_ROLES])
  })
})
