import { describe, it, expect } from 'vitest'
import { isRiotRateLimited, riotErrorText, riotRateLimitSeconds } from '../../src/lib/riotErrors'

// Riot rate limits (desktop RiotRateLimitError through IPC, web RiotWebError), shown with their wait.
const ipcError = (msg: string) => new Error(`Error invoking remote method 'team:scout-member': Error: ${msg}`)
const t = ((key: string, opts?: { count?: number }) => `${key}:${opts?.count}`) as never

describe('riotRateLimitSeconds', () => {
  it('reads the wait from the desktop message, through IPC', () => {
    expect(riotRateLimitSeconds(ipcError('RIOT_RATE_LIMITED: too many Riot requests right now. Try again in about 45 seconds.'))).toBe(45)
  })

  it('reads the web error', () => {
    expect(riotRateLimitSeconds(Object.assign(new Error('x'), { code: 'rate-limited', retryAfterSec: 12.2 }))).toBe(13)
  })

  it('falls back to 30 s without a readable wait, null for other errors', () => {
    expect(riotRateLimitSeconds(new Error('RIOT_RATE_LIMITED'))).toBe(30)
    expect(riotRateLimitSeconds(new Error('Riot API error 500'))).toBeNull()
    expect(isRiotRateLimited(null)).toBe(false)
  })
})

describe('riotErrorText', () => {
  it('translates a rate limit with its wait, keeps other messages', () => {
    expect(riotErrorText(ipcError('RIOT_RATE_LIMITED: too many Riot requests right now. Try again in about 60 seconds.'), t)).toBe('riotErrors.rateLimited:60')
    expect(riotErrorText(new Error('Account not found'), t)).toBe('Account not found')
  })
})
