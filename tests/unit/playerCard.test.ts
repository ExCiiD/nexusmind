import { describe, it, expect } from 'vitest'
import {
  bestChampions,
  cardSeed,
  initialsOf,
  mainChampion,
  verticalNameSize,
  NAME_MAX_CQW,
  NAME_SPAN_CQW,
  lookForMember,
  riotIdKey,
  riotIdKeyOf,
  MIN_GAMES,
  MOST_PLAYED_POOL,
} from '../../src/lib/playerCard'
import type { ChampionPoolEntry } from '../../src/lib/ipc'
import type { MemberLook } from '../../src/lib/collab'

let seq = 0
const entry = (championKey: string, games: number | null, winRate: number | null, role = 'MID'): ChampionPoolEntry => ({
  id: `e${++seq}`,
  memberId: 'm1',
  championKey,
  role,
  tier: 'comfort',
  playRate: games,
  winRate,
})

const keys = (r: ReturnType<typeof bestChampions>) => r.champions.map((c) => c.championKey)

describe('bestChampions', () => {
  it('returns nothing for an empty or missing pool', () => {
    expect(bestChampions(undefined)).toEqual({ champions: [], games: 0 })
    expect(bestChampions([])).toEqual({ champions: [], games: 0 })
  })

  it('adds up a champion played in several roles', () => {
    const r = bestChampions([entry('Ahri', 10, 60, 'MID'), entry('Ahri', 5, 40, 'TOP')])
    expect(r.champions).toEqual([{ championKey: 'Ahri', games: 15, wins: 8, winRate: 53, lowSample: false }])
    expect(r.games).toBe(15)
  })

  it('ignores manual entries, mastery-only entries and missing win rates', () => {
    const r = bestChampions([entry('Ahri', null, null), entry('Zed', 0, null), entry('Lux', 4, null), entry('Orianna', 8, 50)])
    expect(keys(r)).toEqual(['Orianna'])
    expect(r.games).toBe(8)
  })

  it('sorts the qualified champions by win rate, then by games', () => {
    const r = bestChampions([
      entry('Orianna', 40, 52),
      entry('Azir', 30, 61),
      entry('Ahri', 20, 61),
      entry('Syndra', 10, 70),
      entry('Taliyah', 5, 40),
      entry('Akali', 4, 45),
    ])
    expect(keys(r)).toEqual(['Syndra', 'Azir', 'Ahri', 'Orianna', 'Akali'])
  })

  it(`picks among the ${MOST_PLAYED_POOL} most-played champions only`, () => {
    // 12 champions, 30 down to 19 games; the two least played have the best
    // win rates. Steps of 5 points so rounding can't reorder the others.
    const pool = Array.from({ length: 12 }, (_, i) => entry(`C${i}`, 30 - i, i >= 10 ? 95 : 10 + 5 * i))
    const r = bestChampions(pool)
    expect(keys(r)).toEqual(['C9', 'C8', 'C7', 'C6', 'C5'])
    expect(keys(r)).not.toContain('C10')
    expect(keys(r)).not.toContain('C11')
  })

  it(`needs ${MIN_GAMES} games to rank, and lists the smaller samples last`, () => {
    const r = bestChampions([
      entry('Ahri', 2, 100),
      entry('Orianna', 12, 50),
      entry('Azir', 6, 67),
      entry('Lux', 1, 0),
    ])
    expect(keys(r)).toEqual(['Azir', 'Orianna', 'Ahri', 'Lux'])
    expect(r.champions.map((c) => c.lowSample)).toEqual([false, false, true, true])
  })

  it('keeps the card to 5 champions even with many small samples', () => {
    const pool = [entry('Orianna', 9, 55), ...Array.from({ length: 8 }, (_, i) => entry(`S${i}`, 2, 100))]
    const r = bestChampions(pool)
    expect(r.champions).toHaveLength(5)
    expect(r.champions[0].championKey).toBe('Orianna')
  })
})

describe('riotIdKey', () => {
  it('folds case and spaces', () => {
    expect(riotIdKey('ASC Kaito', 'EUW')).toBe('asckaito#euw')
    expect(riotIdKeyOf('asc kaito#euw')).toBe('asckaito#euw')
    expect(riotIdKeyOf(' ASCKaito # EUW ')).toBe('asckaito#euw')
  })

  it('keeps the name alone without a tag, and nothing without a name', () => {
    expect(riotIdKey('Njörd', null)).toBe('njörd')
    expect(riotIdKeyOf('Njörd')).toBe('njörd')
    expect(riotIdKey('  ', 'EUW')).toBeNull()
    expect(riotIdKeyOf(null)).toBeNull()
  })
})

describe('lookForMember', () => {
  const looks: MemberLook[] = [
    { userId: 'u-top', riotId: 'ASC Kaito#EUW', iconId: 'brasier', bannerId: 'abysse' },
    { userId: 'u-mid', riotId: 'Nyra#EUW', iconId: 'arcane', bannerId: 'fracture' },
    { userId: 'u-mid2', riotId: 'Nyra#KR1', iconId: 'jade', bannerId: 'embleme' },
    { userId: 'u-sup', riotId: 'Lumi#EUW', iconId: 'halo', bannerId: null },
    { userId: 'u-none', riotId: 'Rook#EUW', iconId: null, bannerId: null },
  ]
  const myLook = { iconId: 'tempete', bannerId: 'nebuleuse' }
  const me = { puuid: 'p-me', riotId: 'ExCiiD#AIGRI', look: myLook }

  it("uses the local player's own look for their card, by puuid or Riot ID", () => {
    expect(lookForMember({ ign: 'Someone', tagLine: 'X', puuid: 'p-me' }, { me, looks })).toEqual(myLook)
    expect(lookForMember({ ign: 'excIID', tagLine: 'aigri' }, { me, looks })).toEqual(myLook)
  })

  it('finds a group member with the same Riot ID', () => {
    expect(lookForMember({ ign: 'asc kaito', tagLine: 'euw' }, { me, looks })).toEqual({ iconId: 'brasier', bannerId: 'abysse' })
    expect(lookForMember({ ign: 'Lumi', tagLine: 'EUW' }, { looks })).toEqual({ iconId: 'halo', bannerId: null })
  })

  it('matches a member without a tag on the name only when it is unique', () => {
    expect(lookForMember({ ign: 'ASC Kaito' }, { looks })).toEqual({ iconId: 'brasier', bannerId: 'abysse' })
    expect(lookForMember({ ign: 'Nyra' }, { looks })).toBeNull()
  })

  it('does not fall back to the name when the tag differs', () => {
    expect(lookForMember({ ign: 'ASC Kaito', tagLine: 'NA1' }, { looks })).toBeNull()
  })

  it('returns null without a match, a Riot ID or a shared look', () => {
    expect(lookForMember({ ign: 'Unknown', tagLine: 'EUW' }, { me, looks })).toBeNull()
    expect(lookForMember({ ign: null, tagLine: null }, { me, looks })).toBeNull()
    expect(lookForMember({ ign: 'Rook', tagLine: 'EUW' }, { me, looks })).toBeNull()
    expect(lookForMember({ ign: 'ExCiiD', tagLine: 'AIGRI' }, { me: { ...me, look: null }, looks })).toBeNull()
  })
})

describe('initialsOf', () => {
  it('takes two letters', () => {
    expect(initialsOf('Kaito')).toBe('KA')
    expect(initialsOf('Le Chef')).toBe('LC')
    expect(initialsOf('dark_knight')).toBe('DK')
    expect(initialsOf('  ')).toBe('?')
  })
})

describe('mainChampion', () => {
  it('picks the champion with the most games, roles added up', () => {
    expect(mainChampion([entry('Ahri', 6, 50, 'MID'), entry('Zed', 9, 40), entry('Ahri', 5, 60, 'TOP')])).toBe('Ahri')
  })
  it('breaks ties alphabetically and ignores entries without games', () => {
    expect(mainChampion([entry('Zed', 4, 50), entry('Ahri', 4, 50), entry('Lux', null, null)])).toBe('Ahri')
    expect(mainChampion([entry('Lux', null, null)])).toBeNull()
    expect(mainChampion(undefined)).toBeNull()
  })
})

describe('verticalNameSize', () => {
  it('caps short names', () => {
    expect(verticalNameSize('Kiro')).toBe(NAME_MAX_CQW)
    expect(verticalNameSize('Ax')).toBe(NAME_MAX_CQW)
  })
  it('shrinks long names so they fit the card', () => {
    const name = 'Unbreakablegod'
    const size = verticalNameSize(name)
    expect(size).toBeLessThan(NAME_MAX_CQW)
    // the name's length (letters × advance × size) stays within the span
    expect(name.length * 0.56 * size).toBeLessThanOrEqual(NAME_SPAN_CQW + 0.5)
  })
})

describe('cardSeed', () => {
  it('is stable and within [0, 1)', () => {
    const [a, b] = cardSeed('cmabc123')
    expect(cardSeed('cmabc123')).toEqual([a, b])
    for (const v of [a, b]) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
    expect(cardSeed('cmabc124')).not.toEqual([a, b])
  })
})
