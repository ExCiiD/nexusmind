import { describe, it, expect, vi } from 'vitest'
import {
  INVITE_CODE,
  normaliseInviteCode,
  authErrorCode,
  sendSignInCode,
  redeemInvite,
} from '../../src/lib/accessCore'

describe('normaliseInviteCode', () => {
  it('strips spaces and dashes and upper-cases', () => {
    expect(normaliseInviteCode('abcd-efgh-jkmn')).toBe('ABCDEFGHJKMN')
    expect(normaliseInviteCode('  ab cd ef  ')).toBe('ABCDEF')
  })
  it('accepts valid codes only', () => {
    expect(INVITE_CODE.test(normaliseInviteCode('ABCD-EFGH-JKMN'))).toBe(true)
    expect(INVITE_CODE.test('abcd')).toBe(false) // lower case
    expect(INVITE_CODE.test('ABC')).toBe(false) // too short
  })
})

describe('authErrorCode', () => {
  it('maps a closed-signup error to the invite prompt', () => {
    expect(authErrorCode('Signups not allowed for otp')).toBe('AUTH_NEEDS_INVITE')
    expect(authErrorCode('User not found')).toBe('AUTH_NEEDS_INVITE')
  })
  it('maps rate limit and invalid code', () => {
    expect(authErrorCode('Email rate limit exceeded')).toBe('AUTH_RATE_LIMITED')
    expect(authErrorCode('Token has expired or is invalid')).toBe('AUTH_INVALID_CODE')
  })
  it('falls through to the raw message', () => {
    expect(authErrorCode('boom')).toBe('boom')
    expect(authErrorCode(undefined)).toBe('AUTH_FAILED')
  })
})

describe('sendSignInCode', () => {
  it('does not create users (invite-only) and surfaces the needs-invite code', async () => {
    const signInWithOtp = vi.fn().mockResolvedValue({ error: { message: 'Signups not allowed for otp' } })
    const sb = { auth: { signInWithOtp } } as never
    await expect(sendSignInCode(sb, 'a@b.com')).rejects.toThrow('AUTH_NEEDS_INVITE')
    expect(signInWithOtp).toHaveBeenCalledWith({ email: 'a@b.com', options: { shouldCreateUser: false } })
  })

  it('redeems the invite before sending the code', async () => {
    const calls: string[] = []
    const invoke = vi.fn().mockImplementation(async () => { calls.push('redeem'); return { data: { ok: true }, error: null } })
    const signInWithOtp = vi.fn().mockImplementation(async () => { calls.push('otp'); return { error: null } })
    const sb = { functions: { invoke }, auth: { signInWithOtp } } as never
    await sendSignInCode(sb, 'a@b.com', 'ABCDEFGHJKMN')
    expect(calls).toEqual(['redeem', 'otp'])
    expect(invoke).toHaveBeenCalledWith('redeem-invite', { method: 'POST', body: { email: 'a@b.com', code: 'ABCDEFGHJKMN' } })
  })
})

describe('redeemInvite', () => {
  it('maps a 400 to INVITE_INVALID and a 429 to AUTH_RATE_LIMITED', async () => {
    const sb400 = { functions: { invoke: vi.fn().mockResolvedValue({ data: null, error: { context: { status: 400 } } }) } } as never
    await expect(redeemInvite(sb400, 'a@b.com', 'X')).rejects.toThrow('INVITE_INVALID')
    const sb429 = { functions: { invoke: vi.fn().mockResolvedValue({ data: null, error: { context: { status: 429 } } }) } } as never
    await expect(redeemInvite(sb429, 'a@b.com', 'X')).rejects.toThrow('AUTH_RATE_LIMITED')
  })
  it('resolves when the function returns ok', async () => {
    const sb = { functions: { invoke: vi.fn().mockResolvedValue({ data: { ok: true }, error: null }) } } as never
    await expect(redeemInvite(sb, 'a@b.com', 'X')).resolves.toBeUndefined()
  })
})
