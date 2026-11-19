/**
 * #49: riotAccountExists (the Scrim pop-up's "✓ trouvé" / "Introuvable"): what counts as "not found" and what is
 * passed on to the screen as an error.
 */
import { describe, it, expect, vi } from 'vitest'
import { checkRiotAccount } from '../../src/lib/riotAccountCheck'

describe('checkRiotAccount', () => {
  it('found: the puuid, the name and tag split at the last #', async () => {
    const lookup = vi.fn().mockResolvedValue({ puuid: 'P1' })
    expect(await checkRiotAccount(lookup, ' Mr #Tag#EUW ', 'EUW1')).toEqual({ exists: true, puuid: 'P1' })
    expect(lookup).toHaveBeenCalledWith('Mr #Tag', 'EUW', 'EUW1')
  })
  it('Riot\'s 404 (no such account) and 400 (not a valid Riot ID) are "not found"', async () => {
    for (const message of ['Account not found (404). Make sure your Game Name and Tag are correct.', 'Bad request (400). Check that your Game Name and Tag are spelled correctly.']) {
      expect(await checkRiotAccount(vi.fn().mockRejectedValue(new Error(message)), 'A#B', 'EUW1')).toEqual({ exists: false })
    }
    expect(await checkRiotAccount(vi.fn().mockRejectedValue(Object.assign(new Error('x'), { status: 404 })), 'A#B', 'EUW1')).toEqual({ exists: false })
  })
  it('a value without a tag is "not found" without calling Riot', async () => {
    const lookup = vi.fn()
    expect(await checkRiotAccount(lookup, 'NoTag', 'EUW1')).toEqual({ exists: false })
    expect(await checkRiotAccount(lookup, '  ', 'EUW1')).toEqual({ exists: false })
    expect(lookup).not.toHaveBeenCalled()
  })
  it('anything else is thrown (rate limit, offline, session): the screen shows "—", not "Introuvable"', async () => {
    await expect(checkRiotAccount(vi.fn().mockRejectedValue(new Error('Riot API error 429: Too Many Requests')), 'A#B', 'EUW1')).rejects.toThrow('429')
    await expect(checkRiotAccount(vi.fn().mockRejectedValue(new Error('fetch failed')), 'A#B', 'EUW1')).rejects.toThrow('fetch failed')
  })
})
