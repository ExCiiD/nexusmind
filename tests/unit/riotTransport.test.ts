import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: true }, BrowserWindow: { getAllWindows: () => [] } }))

import { toProxyUrl, riotTransportMode } from '../../electron/main/riotTransport'

describe('riotTransport', () => {
  it('rewrites Riot URLs onto the proxy, keeping path and query', () => {
    expect(
      toProxyUrl('https://europe.api.riotgames.com/lol/match/v5/matches/by-puuid/abc/ids?queue=420&count=5', 'https://proxy.dev'),
    ).toBe('https://proxy.dev/europe/lol/match/v5/matches/by-puuid/abc/ids?queue=420&count=5')
    expect(toProxyUrl('https://euw1.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/x', 'https://p')).toBe(
      'https://p/euw1/lol/summoner/v4/summoners/by-puuid/x',
    )
  })

  it('refuses non-Riot URLs', () => {
    expect(() => toProxyUrl('https://evil.example/lol/x', 'https://p')).toThrow(/Not a Riot API URL/)
  })

  it('never uses a direct dev key in a packaged build', () => {
    process.env.RIOT_DEV_API_KEY = 'RGAPI-should-be-ignored'
    // No MAIN_VITE_RIOT_PROXY_URL in tests and isPackaged=true → nothing allowed.
    expect(riotTransportMode()).toBe('none')
    delete process.env.RIOT_DEV_API_KEY
  })
})
