import { describe, it, expect } from 'vitest'
import {
  asLftRole,
  assignSeat,
  championArtUrl,
  cleanLine,
  commonRegion,
  displayTextEm,
  fitFontSize,
  isLftSize,
  lftPosterDocument,
  joinLobby,
  leaveLobby,
  lftFileName,
  lobbySeats,
  mainChampions,
  parseChampionSkins,
  parseTags,
  pickTrait,
  toggleTrait,
  cleanTraits,
  regionLabel,
  riotIdOf,
  toggleTag,
  wantedRoles,
  LFT_LIMITS,
  type LftPoolEntry,
  type LftRole,
} from '../../src/lib/lftCore'

const entry = (championKey: string, role: string, games: number | null, winRate: number | null, extra: Partial<LftPoolEntry> = {}): LftPoolEntry => ({
  championKey, role, tier: 'comfort', playRate: games, winRate, ...extra,
})
const keys = (list: Array<{ championKey: string }>) => list.map((c) => c.championKey)

describe('asLftRole', () => {
  it('reads roster and Riot role names', () => {
    expect(asLftRole('MID')).toBe('MID')
    expect(asLftRole('middle')).toBe('MID')
    expect(asLftRole('BOTTOM')).toBe('ADC')
    expect(asLftRole('UTILITY')).toBe('SUPPORT')
    expect(asLftRole('FILL')).toBeNull()
    expect(asLftRole(null)).toBeNull()
  })
})

describe('mainChampions', () => {
  it('lists the most played of the announced role first, then the other roles', () => {
    const pool = [
      entry('Ahri', 'MID', 20, 55),
      entry('Jinx', 'ADC', 60, 50),
      entry('Orianna', 'MID', 45, 60),
      entry('Syndra', 'MID', 8, 50),
    ]
    expect(keys(mainChampions(pool, 'MID'))).toEqual(['Orianna', 'Ahri', 'Syndra', 'Jinx'])
    expect(keys(mainChampions(pool, null))).toEqual(['Jinx', 'Orianna', 'Ahri', 'Syndra'])
  })

  it('counts a champion once, its games in the role added up, with the wins', () => {
    const pool = [entry('Ahri', 'MID', 10, 50), entry('Ahri', 'MIDDLE', 10, 70), entry('Ahri', 'ADC', 30, 50)]
    const [ahri, ...rest] = mainChampions(pool, 'MID')
    expect(ahri).toEqual({ championKey: 'Ahri', games: 20, wins: 12, winRate: 60 })
    expect(rest).toEqual([])
  })

  it('puts entries without games last, by tier then mastery, and caps the list', () => {
    const pool = [
      entry('Lux', 'SUPPORT', null, null, { tier: 'flex', masteryPoints: 900_000 }),
      entry('Rakan', 'SUPPORT', 0, null, { tier: 'main', masteryPoints: 10 }),
      entry('Nautilus', 'SUPPORT', 3, 33),
      entry('Thresh', 'SUPPORT', null, null, { tier: 'flex', masteryPoints: 950_000 }),
    ]
    const list = mainChampions(pool, 'SUPPORT')
    expect(keys(list)).toEqual(['Nautilus', 'Rakan', 'Thresh', 'Lux'])
    expect(list[1].winRate).toBeNull()
    expect(keys(mainChampions(pool, 'SUPPORT', 2))).toEqual(['Nautilus', 'Rakan'])
    expect(mainChampions(undefined, 'TOP')).toEqual([])
  })
})

describe('lobby seats', () => {
  it('seats a player on their role, else on the first free seat', () => {
    let roles = joinLobby({}, { id: 'a', role: 'MID' })
    roles = joinLobby(roles, { id: 'b', role: 'MID' })
    roles = joinLobby(roles, { id: 'c', role: 'FILL' })
    expect(roles).toEqual({ a: 'MID', b: 'TOP', c: 'JUNGLE' })
    expect(joinLobby(roles, { id: 'a', role: 'ADC' })).toBe(roles)
  })

  it('stops seating when the lobby is full', () => {
    let roles = {}
    for (const id of ['a', 'b', 'c', 'd', 'e']) roles = joinLobby(roles, { id, role: 'TOP' })
    expect(Object.keys(roles)).toHaveLength(5)
    expect(joinLobby(roles, { id: 'f', role: 'TOP' })).toBe(roles)
  })

  it('swaps two players instead of seating them together', () => {
    const roles = { a: 'TOP', b: 'MID' } as Record<string, LftRole>
    expect(assignSeat(roles, 'a', 'MID')).toEqual({ a: 'MID', b: 'TOP' })
    expect(assignSeat(roles, 'a', 'ADC')).toEqual({ a: 'ADC', b: 'MID' })
    expect(assignSeat(roles, 'z', 'MID')).toEqual({ a: 'TOP', z: 'MID' })
    expect(leaveLobby(roles, 'a')).toEqual({ b: 'MID' })
  })

  it('searches the free seats the user kept', () => {
    const roles = { a: 'TOP', b: 'MID' } as Record<string, LftRole>
    expect(wantedRoles(roles)).toEqual(['JUNGLE', 'ADC', 'SUPPORT'])
    expect(wantedRoles(roles, ['ADC', 'TOP'])).toEqual(['JUNGLE', 'SUPPORT'])
  })

  it('lays the 5 seats out in client order', () => {
    const seats = lobbySeats([{ id: 'b', seat: 'MID' as LftRole }, { id: 'a', seat: 'TOP' as LftRole }], ['JUNGLE', 'SUPPORT'])
    expect(seats.map((s) => `${s.role}:${s.kind}${s.kind === 'player' ? `:${s.player.id}` : ''}`)).toEqual([
      'TOP:player:a', 'JUNGLE:wanted', 'MID:player:b', 'ADC:open', 'SUPPORT:wanted',
    ])
  })

  it('moves a second player on a taken seat to the first seat that is not searched', () => {
    const seats = lobbySeats([{ id: 'a', seat: 'TOP' as LftRole }, { id: 'b', seat: 'TOP' as LftRole }], ['JUNGLE'])
    expect(seats.map((s) => (s.kind === 'player' ? s.player.id : s.kind))).toEqual(['a', 'wanted', 'b', 'open', 'open'])
  })
})

describe('typed text', () => {
  it('cleans one line', () => {
    expect(cleanLine('  SLE   ou\néquivalent ', 40)).toBe('SLE ou équivalent')
    expect(cleanLine('abcdef', 3)).toBe('abc')
    expect(cleanLine(null, 3)).toBe('')
    expect(cleanLine('🔥🔥🔥🔥', 2)).toBe('🔥🔥')
  })

  it('parses tags: trims, drops duplicates, keeps the limit', () => {
    expect(parseTags(' Scrims, tryhard ranked;Scrims ,, Tournois\nDuo, Clash')).toEqual(['Scrims', 'tryhard ranked', 'Tournois', 'Duo'])
    expect(parseTags(['a'.repeat(40)])[0]).toHaveLength(LFT_LIMITS.tag)
    expect(parseTags(undefined)).toEqual([])
  })

  it('toggles a suggested tag', () => {
    expect(toggleTag(['Scrims'], 'Duo')).toEqual(['Scrims', 'Duo'])
    expect(toggleTag(['Scrims', 'Duo'], 'scrims')).toEqual(['Duo'])
    expect(toggleTag(['a', 'b', 'c', 'd'], 'e')).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('fundamentals picks', () => {
  it('toggles within the limit', () => {
    expect(toggleTrait(['a'], 'b', 2)).toEqual(['a', 'b'])
    expect(toggleTrait(['a', 'b'], 'c', 2)).toEqual(['a', 'b'])
    expect(toggleTrait(['a', 'b'], 'a', 2)).toEqual(['b'])
  })

  it('cleans stored ids', () => {
    const known = (id: string) => id !== 'gone'
    expect(cleanTraits(['a', 'gone', 'a', 3, 'b', 'c'], known, 2)).toEqual(['a', 'b'])
    expect(cleanTraits('a', known, 2)).toEqual([])
  })

  it('never keeps a fundamental as both a strength and a weakness', () => {
    const p = { strengths: ['trades'], weaknesses: ['tempo'] }
    expect(pickTrait(p, 'strengths', 'tempo')).toEqual({ strengths: ['trades', 'tempo'], weaknesses: [] })
    expect(pickTrait(p, 'weaknesses', 'trades')).toEqual({ strengths: [], weaknesses: ['tempo', 'trades'] })
    expect(pickTrait(p, 'strengths', 'trades')).toEqual({ strengths: [], weaknesses: ['tempo'] })
    const full = { strengths: ['a', 'b', 'c'], weaknesses: ['d'] }
    expect(pickTrait(full, 'strengths', 'd')).toBe(full)
  })
})

describe('fitFontSize', () => {
  it('shrinks long names, keeps short ones at the maximum, stops at the minimum', () => {
    expect(fitFontSize('Kai', 1000, 160, 60)).toBe(160)
    const long = fitFontSize('ThisIsAVeryLongRiotName', 1000, 160, 60)
    expect(long).toBeLessThan(160)
    expect(long).toBeGreaterThanOrEqual(60)
    expect(fitFontSize('x'.repeat(200), 1000, 160, 60)).toBe(60)
    expect(fitFontSize('', 1000, 160, 60)).toBe(160)
  })

  it('counts wide scripts and emoji as a full em', () => {
    expect(displayTextEm('めいい')).toBe(3)
    expect(displayTextEm('🔥')).toBe(1)
    expect(displayTextEm('ab')).toBeCloseTo(0.9)
  })
})

describe('poster document', () => {
  it('allows no script, only the app and the Riot art hosts for pictures', () => {
    const html = lftPosterDocument({ markup: '<div>hi</div>', css: 'a{}</style><script>x</script>', width: 1200, height: 600, self: 'file:' })
    expect(html).toContain("default-src 'none'")
    expect(html).toContain("img-src 'self' file: https://ddragon.leagueoflegends.com https://raw.communitydragon.org data: blob:")
    expect(html).toContain("font-src 'self' file: data:")
    expect(html).not.toContain('</style><script>')
    expect(html).toContain('width:1200px;height:600px')
    expect(html).toContain('<body><div>hi</div></body>')
  })

  it('knows the format sizes', () => {
    expect(isLftSize(1920, 1080)).toBe(true)
    expect(isLftSize(1200, 600)).toBe(true)
    expect(isLftSize(1200, 601)).toBe(false)
  })
})

describe('labels and files', () => {
  it('writes regions as players do', () => {
    expect(regionLabel('EUW1')).toBe('EUW')
    expect(regionLabel('eun1')).toBe('EUNE')
    expect(regionLabel('XX9')).toBe('XX')
    expect(regionLabel('')).toBeNull()
    expect(commonRegion(['EUW1', 'EUN1', 'EUW1', null])).toBe('EUW')
    expect(commonRegion([])).toBeNull()
  })

  it('splits the Riot ID', () => {
    expect(riotIdOf({ ign: ' Kaito ', tagLine: ' EUW ' })).toEqual({ name: 'Kaito', tag: 'EUW' })
    expect(riotIdOf({ ign: 'Kaito', tagLine: '' })).toEqual({ name: 'Kaito', tag: null })
    expect(riotIdOf({ ign: null })).toBeNull()
  })

  it('names the file from the players and the format', () => {
    expect(lftFileName(['Kaïto', 'ASC Vexa'], 'banner')).toBe('ascend-lft-kaito-asc-vexa-1920x1080.png')
    expect(lftFileName(['めいい'], 'card')).toBe('ascend-lft-player-1200x600.png')
  })

  it('points to Data Dragon art', () => {
    expect(championArtUrl('icon', 'Ahri', '15.7.1')).toBe('https://ddragon.leagueoflegends.com/cdn/15.7.1/img/champion/Ahri.png')
    expect(championArtUrl('splash', 'Ahri', '15.7.1')).toBe('https://ddragon.leagueoflegends.com/cdn/img/champion/splash/Ahri_0.jpg')
    expect(championArtUrl('loading', 'Ahri', '15.7.1')).toBe('https://ddragon.leagueoflegends.com/cdn/img/champion/loading/Ahri_0.jpg')
    expect(championArtUrl('splash', 'Ahri', '15.7.1', 14)).toBe('https://ddragon.leagueoflegends.com/cdn/img/champion/splash/Ahri_14.jpg')
    expect(championArtUrl('tiles', 'Ahri', '15.7.1', -3)).toBe('https://ddragon.leagueoflegends.com/cdn/img/champion/tiles/Ahri_0.jpg')
  })

  it('reads the skin list', () => {
    const json = { data: { Ahri: { skins: [{ num: 7, name: 'Arcade Ahri' }, { num: 0, name: 'default' }, { num: 'x' }, { num: 8, name: 'Arcade Ahri (Ruby)', parentSkin: 7 }] } } }
    expect(parseChampionSkins(json, 'Ahri')).toEqual([{ num: 0, name: 'default' }, { num: 7, name: 'Arcade Ahri' }])
    expect(parseChampionSkins(null, 'Ahri')).toEqual([{ num: 0, name: 'default' }])
  })
})
