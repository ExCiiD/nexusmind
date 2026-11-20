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
} from '../../src/lib/playerCard'
import type { ChampionPoolEntry } from '../../src/lib/ipc'
import type { MemberLook } from '../../src/lib/collab'

let seq = 0
const entry = (championKey: string, games: number | null, winRate: number | null, role = 'MID', tier = 'comfort'): ChampionPoolEntry => ({
  id: `e${++seq}`,
  memberId: 'm1',
  championKey,
  role,
  tier,
  playRate: games,
  winRate,
  updatedAt: '2026-11-19T00:00:00.000Z',
})

const keys = (r: ReturnType<typeof bestChampions>) => r.champions.map((c) => c.championKey)

describe('bestChampions', () => {
  it('returns nothing for an empty or missing pool', () => {
    expect(bestChampions(undefined)).toEqual({ champions: [], games: 0 })
    expect(bestChampions([])).toEqual({ champions: [], games: 0 })
  })

  it('adds up a champion played in several roles, in its best tier', () => {
    const r = bestChampions([entry('Ahri', 10, 60, 'MID', 'flex'), entry('Ahri', 5, 40, 'TOP', 'main'), entry('Zed', 20, 50, 'MID', 'comfort')])
    expect(r.champions[0]).toEqual({ championKey: 'Ahri', games: 15, wins: 8, winRate: 53, lowSample: false })
    expect(keys(r)).toEqual(['Ahri', 'Zed'])
    expect(r.games).toBe(35)
  })

  it('ignores manual entries, mastery-only entries and missing win rates', () => {
    const r = bestChampions([entry('Ahri', null, null), entry('Zed', 0, null), entry('Lux', 4, null), entry('Orianna', 8, 50)])
    expect(keys(r)).toEqual(['Orianna'])
    expect(r.games).toBe(8)
  })

  it('follows the pool: Main, then Comfort, then Flex, the most played first in a tier', () => {
    // The user's pool of 20/11: the card used to drop Jax (36 %) for a 3-game pick at 67 %.
    const r = bestChampions([
      entry('Jayce', 25, 72, 'TOP', 'main'),
      entry('Jax', 14, 36, 'TOP', 'main'),
      entry('Olaf', 6, 33, 'TOP', 'main'),
      entry('Varus', 14, 64, 'TOP', 'comfort'),
      entry('Yorick', 8, 63, 'TOP', 'comfort'),
      entry('Renekton', 6, 67, 'TOP', 'comfort'),
      entry('Nasus', 3, 67, 'TOP', 'learning'),
      entry('XinZhao', 1, 0, 'TOP', 'flex'),
    ])
    expect(keys(r)).toEqual(['Jayce', 'Jax', 'Olaf', 'Varus', 'Yorick'])
  })

  it('fills the card from the lower tiers, and dims the small samples', () => {
    const r = bestChampions([
      entry('Orianna', 12, 50, 'MID', 'main'),
      entry('Lux', 1, 0, 'MID', 'learning'),
      entry('Ahri', 2, 100, 'MID', 'flex'),
      entry('Azir', 6, 67, 'MID', 'new'),
    ])
    expect(keys(r)).toEqual(['Orianna', 'Ahri', 'Azir', 'Lux'])
    expect(r.champions.map((c) => c.lowSample)).toEqual([false, true, false, true])
    expect(MIN_GAMES).toBe(3)
  })

  it('keeps the card to 5 champions', () => {
    const pool = [entry('Orianna', 9, 55, 'MID', 'main'), ...Array.from({ length: 8 }, (_, i) => entry(`S${i}`, 2, 100))]
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
