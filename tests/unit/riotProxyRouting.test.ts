import { describe, it, expect } from 'vitest'
import { routeRequest } from '../../cloudflare/riot-proxy/src/routing'

const route = (path: string, method = 'GET') => routeRequest(method, new URL(`https://proxy.example${path}`))

describe('riot proxy routing', () => {
  it('forwards the endpoints Ascend uses', () => {
    const cases = [
      '/europe/riot/account/v1/accounts/by-riot-id/Faker/KR1',
      '/euw1/lol/summoner/v4/summoners/by-puuid/abc-DEF_123',
      '/euw1/lol/champion-mastery/v4/champion-masteries/by-puuid/abc/top?count=10',
      '/euw1/lol/league/v4/entries/by-summoner/sid123',
      '/europe/lol/match/v5/matches/by-puuid/abc/ids?queue=420&start=0&count=20',
      '/europe/lol/match/v5/matches/EUW1_7123456789',
      '/europe/lol/match/v5/matches/EUW1_7123456789/timeline',
    ]
    for (const c of cases) expect(route(c).ok, c).toBe(true)
  })

  it('builds the Riot URL with the query string', () => {
    const r = route('/europe/lol/match/v5/matches/by-puuid/abc/ids?queue=420&count=5')
    expect(r).toMatchObject({ ok: true, upstream: 'https://europe.api.riotgames.com/lol/match/v5/matches/by-puuid/abc/ids?queue=420&count=5' })
  })

  it('refuses everything else', () => {
    expect(route('/europe/lol/match/v5/matches/EUW1_1', 'POST')).toMatchObject({ ok: false, status: 405 })
    expect(route('/evil.com/lol/match/v5/matches/EUW1_1')).toMatchObject({ ok: false })
    expect(route('/attacker/lol/match/v5/matches/EUW1_1')).toMatchObject({ ok: false, status: 400 })
    expect(route('/euw1/lol/spectator/v5/active-games/by-summoner/x')).toMatchObject({ ok: false, status: 403 })
    expect(route('/euw1/lol/summoner/v4/summoners/by-puuid/../../admin')).toMatchObject({ ok: false })
  })
})
