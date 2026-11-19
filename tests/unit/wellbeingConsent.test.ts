import { describe, it, expect, vi } from 'vitest'
import { consentFromEvents, getConsent, setConsent } from '../../src/lib/wellbeingCore'

// Legal texts v0.3: consent to wellbeing check-ins, with proof (newest event first).
describe('consentFromEvents', () => {
  it('no event: no consent', () => {
    expect(consentFromEvents([])).toEqual({ status: 'none', version: null, grantedAt: null, withdrawnAt: null })
  })
  it('latest is a grant', () => {
    expect(consentFromEvents([{ granted: true, version: 'v0.3', created_at: 't2' }, { granted: false, version: 'v0.3', created_at: 't1' }]))
      .toEqual({ status: 'granted', version: 'v0.3', grantedAt: 't2', withdrawnAt: null })
  })
  it('latest is a withdrawal: keeps when it had been granted', () => {
    expect(consentFromEvents([{ granted: false, version: 'v0.3', created_at: 't3' }, { granted: true, version: 'v0.3', created_at: 't1' }]))
      .toEqual({ status: 'withdrawn', version: 'v0.3', grantedAt: 't1', withdrawnAt: 't3' })
  })
})

function client(events: unknown[], rpcError: unknown = null) {
  const q: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'order', 'limit']) q[m] = vi.fn().mockReturnValue(q)
  q.then = (resolve: (v: unknown) => void) => resolve({ data: events, error: null })
  const rpc = vi.fn().mockResolvedValue({ error: rpcError })
  return { sb: { from: vi.fn(() => q), rpc } as never, q, rpc }
}

describe('getConsent / setConsent', () => {
  it('reads only the user\'s own events, newest first', async () => {
    const { sb, q } = client([{ granted: true, version: 'v0.3', created_at: 't1' }])
    await expect(getConsent(sb, 'u1')).resolves.toMatchObject({ status: 'granted' })
    expect(q.eq).toHaveBeenCalledWith('user_id', 'u1')
    expect(q.order).toHaveBeenCalledWith('created_at', { ascending: false })
  })
  it('writes through the RPC (server time, withdrawal cleanup) and returns the new state', async () => {
    const { sb, rpc } = client([{ granted: false, version: 'v0.3', created_at: 't2' }])
    await expect(setConsent(sb, 'u1', false, 'v0.3')).resolves.toMatchObject({ status: 'withdrawn', withdrawnAt: 't2' })
    expect(rpc).toHaveBeenCalledWith('set_wellbeing_consent', { p_granted: false, p_version: 'v0.3' })
  })
  it('throws when the RPC fails', async () => {
    const { sb } = client([], { message: 'LOGIN_REQUIRED', code: '42501' })
    await expect(setConsent(sb, 'u1', true, 'v0.3')).rejects.toThrow()
  })
})
