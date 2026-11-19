import { describe, it, expect, vi } from 'vitest'
import { unlinkGroupDiscord } from '../../src/lib/collabCore'

// #34: the group's staff unlink its Discord server; the check is the RPC's (scripts/test-discord-unlink.mjs).
describe('unlinkGroupDiscord', () => {
  it('calls the RPC for that group and reports whether a server was linked', async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: true, error: null }).mockResolvedValueOnce({ data: false, error: null })
    await expect(unlinkGroupDiscord({ rpc } as never, 'g1')).resolves.toEqual({ unlinked: true })
    await expect(unlinkGroupDiscord({ rpc } as never, 'g1')).resolves.toEqual({ unlinked: false })
    expect(rpc).toHaveBeenCalledWith('unlink_discord_guild', { p_group: 'g1' })
  })
  it('passes the server refusal on (not staff)', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'FORBIDDEN', code: '42501' } })
    await expect(unlinkGroupDiscord({ rpc } as never, 'g1')).rejects.toThrow()
  })
})
