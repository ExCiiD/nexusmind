import { describe, it, expect } from 'vitest'
import { cardChoiceOf, frontChampion, isOwnMember, skinLocale, skinTiles } from '../../src/lib/cardChampionView'

// docs/DESIGN_STATE.md § 14: the Team Lobby card's champion and skin.
describe('my card', () => {
  it('same puuid, else same Riot ID (case and spaces ignored)', () => {
    expect(isOwnMember({ puuid: 'p1', ign: 'X', tagLine: 'EUW' }, { puuid: 'p1', riotId: 'Other#EUW' })).toBe(true)
    expect(isOwnMember({ ign: 'Njörd ', tagLine: 'euw' }, { riotId: 'njörd#EUW' })).toBe(true)
    expect(isOwnMember({ ign: 'Kaito', tagLine: 'EUW' }, { riotId: 'Vexa#EUW' })).toBe(false)
    expect(isOwnMember({ ign: 'Kaito', tagLine: 'EUW' }, null)).toBe(false)
  })
})

describe('the front of a card', () => {
  const looks = [{ riotId: 'Kaito#EUW', card: { championId: 'Ahri', skinNum: 14 } }, { riotId: 'Vexa#EUW' }]
  it('the member’s choice from their shared look; none without the migration', () => {
    expect(cardChoiceOf({ ign: 'Kaito', tagLine: 'EUW' }, looks)).toEqual({ championId: 'Ahri', skinNum: 14 })
    expect(cardChoiceOf({ ign: 'Vexa', tagLine: 'EUW' }, looks)).toBeNull()
    expect(cardChoiceOf({ ign: null }, looks)).toBeNull()
  })
  it('the choice while it is in the top, else the automatic champion, base skin', () => {
    expect(frontChampion({ championId: 'Ahri', skinNum: 14 }, ['Ahri', 'Lux'], 'Lux')).toEqual({ championId: 'Ahri', skinNum: 14 })
    expect(frontChampion({ championId: 'Ahri', skinNum: 14 }, ['Lux'], 'Lux')).toEqual({ championId: 'Lux', skinNum: 0 })
    expect(frontChampion(null, [], null)).toBeNull()
  })
})

describe('the skin grid', () => {
  const all = [{ num: 0, name: null }, { num: 1, name: 'Dynasty Ahri' }, { num: 14, name: 'K/DA Ahri' }, { num: 27, name: 'Spirit Blossom Ahri' }]
  it('base skin first, then the hosted ones; the others apart and not selectable', () => {
    const out = skinTiles([{ num: 14, name: 'K/DA Ahri', url: 'u14' }, { num: 0, name: null, url: 'u0' }], all)
    expect(out.withCutout.map((s) => [s.num, s.cutoutUrl, s.selectable])).toEqual([[0, 'u0', true], [14, 'u14', true]])
    expect(out.without.map((s) => [s.num, s.name, s.selectable])).toEqual([[1, 'Dynasty Ahri', false], [27, 'Spirit Blossom Ahri', false]])
  })
  it('no cut-out at all: the base skin stays selectable (faded art)', () => {
    const out = skinTiles([], all)
    expect(out.withCutout).toEqual([{ num: 0, name: null, cutoutUrl: null, selectable: true }])
    expect(out.without.map((s) => s.num)).toEqual([1, 14, 27])
  })
  it('Data Dragon locale', () => {
    expect(skinLocale('fr')).toBe('fr_FR')
    expect(skinLocale('en-US')).toBe('en_US')
  })
})
