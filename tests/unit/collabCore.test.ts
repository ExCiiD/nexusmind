import { describe, it, expect, vi } from 'vitest'
import { setCaptain } from '../../src/lib/collabCore'

describe('setCaptain', () => {
  it('calls the set_captain RPC with the group/user/value', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null })
    const sb = { rpc } as never
    await setCaptain(sb, 'g1', 'u1', true)
    expect(rpc).toHaveBeenCalledWith('set_captain', { p_group: 'g1', p_user: 'u1', p_value: true })
  })

  it('maps a forbidden error to FORBIDDEN', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: { message: 'forbidden', code: '42501' } })
    const sb = { rpc } as never
    await expect(setCaptain(sb, 'g1', 'u1', true)).rejects.toThrow('FORBIDDEN')
  })
})
