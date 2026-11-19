import { describe, it, expect } from 'vitest'
import {
  APEX_BASE,
  compareRanks,
  displayRank,
  ladderScore,
  lpDelta,
  parseLeagueEntries,
  parseLeagueEntry,
  rankEmblemUrl,
  rankLabel,
  rankWinRate,
  type QueueRank,
} from '../../src/lib/rankCore'

const rank = (tier: QueueRank['tier'], division: QueueRank['division'], lp: number, queue: QueueRank['queue'] = 'solo'): QueueRank =>
  ({ queue, tier, division, lp, wins: 10, losses: 8 })

describe('parseLeagueEntries', () => {
  it('reads Solo/Duo and Flex, ignores other queues', () => {
    const r = parseLeagueEntries([
      { queueType: 'RANKED_TFT', tier: 'GOLD', rank: 'I', leaguePoints: 3, wins: 1, losses: 1 },
      { queueType: 'RANKED_FLEX_SR', tier: 'PLATINUM', rank: 'III', leaguePoints: 12, wins: 20, losses: 25 },
      { queueType: 'RANKED_SOLO_5x5', tier: 'DIAMOND', rank: 'II', leaguePoints: 45, wins: 120, losses: 98 },
    ])
    expect(r.solo).toEqual({ queue: 'solo', tier: 'DIAMOND', division: 'II', lp: 45, wins: 120, losses: 98 })
    expect(r.flex).toEqual({ queue: 'flex', tier: 'PLATINUM', division: 'III', lp: 12, wins: 20, losses: 25 })
  })

  it('reads an empty list, or anything else, as unranked', () => {
    expect(parseLeagueEntries([])).toEqual({ solo: null, flex: null })
    expect(parseLeagueEntries(null)).toEqual({ solo: null, flex: null })
    expect(parseLeagueEntries({ status: 404 })).toEqual({ solo: null, flex: null })
  })

  it('drops the division from Master up and keeps the LP', () => {
    expect(parseLeagueEntry({ queueType: 'RANKED_SOLO_5x5', tier: 'GRANDMASTER', rank: 'I', leaguePoints: 512, wins: 300, losses: 250 }))
      .toEqual({ queue: 'solo', tier: 'GRANDMASTER', division: null, lp: 512, wins: 300, losses: 250 })
  })

  it('rejects an unknown tier, a missing division below Master, and cleans the numbers', () => {
    expect(parseLeagueEntry({ queueType: 'RANKED_SOLO_5x5', tier: 'WOOD', rank: 'I' })).toBeNull()
    expect(parseLeagueEntry({ queueType: 'RANKED_SOLO_5x5', tier: 'GOLD', rank: 'V' })).toBeNull()
    expect(parseLeagueEntry({ queueType: 'RANKED_SOLO_5x5', tier: 'gold', rank: 'iv', leaguePoints: -4, wins: 2.7, losses: 'x' }))
      .toEqual({ queue: 'solo', tier: 'GOLD', division: 'IV', lp: 0, wins: 2, losses: 0 })
  })

  it('keeps the first entry when a queue appears twice', () => {
    const r = parseLeagueEntries([
      { queueType: 'RANKED_SOLO_5x5', tier: 'SILVER', rank: 'I', leaguePoints: 10 },
      { queueType: 'RANKED_SOLO_5x5', tier: 'GOLD', rank: 'I', leaguePoints: 10 },
    ])
    expect(r.solo?.tier).toBe('SILVER')
  })
})

describe('ladderScore', () => {
  it('puts every rank on one LP scale', () => {
    expect(ladderScore(rank('IRON', 'IV', 0))).toBe(0)
    expect(ladderScore(rank('IRON', 'III', 0))).toBe(100)
    expect(ladderScore(rank('BRONZE', 'IV', 0))).toBe(400)
    expect(ladderScore(rank('DIAMOND', 'I', 99))).toBe(2799)
    expect(ladderScore(rank('MASTER', null, 0))).toBe(APEX_BASE)
    expect(APEX_BASE).toBe(2800)
  })

  it('counts the apex tiers on the Master ladder', () => {
    expect(ladderScore(rank('GRANDMASTER', null, 400))).toBe(3200)
    expect(ladderScore(rank('CHALLENGER', null, 1000))).toBe(3800)
  })
})

describe('lpDelta', () => {
  it('counts LP across divisions and tiers', () => {
    expect(lpDelta(rank('GOLD', 'I', 80), rank('PLATINUM', 'IV', 15))).toBe(35)
    expect(lpDelta(rank('PLATINUM', 'IV', 15), rank('GOLD', 'I', 75))).toBe(-40)
    expect(lpDelta(rank('DIAMOND', 'I', 90), rank('MASTER', null, 20))).toBe(30)
  })

  it('is null when a reading is missing', () => {
    expect(lpDelta(null, rank('GOLD', 'I', 80))).toBeNull()
    expect(lpDelta(rank('GOLD', 'I', 80), undefined)).toBeNull()
  })
})

describe('compareRanks', () => {
  it('sorts best first, unranked last', () => {
    const list = [null, rank('GOLD', 'II', 50), rank('MASTER', null, 10), rank('GOLD', 'I', 0)]
    const sorted = [...list].sort(compareRanks)
    expect(sorted.map((r) => (r ? rankLabel(r) : null))).toEqual(['Master', 'Gold I', 'Gold II', null])
  })

  it('puts the higher apex tier first on equal LP', () => {
    expect(compareRanks(rank('MASTER', null, 300), rank('GRANDMASTER', null, 300))).toBeGreaterThan(0)
  })
})

describe('displayRank', () => {
  it('prefers Solo/Duo, else Flex', () => {
    const solo = rank('GOLD', 'I', 0)
    const flex = rank('PLATINUM', 'I', 0, 'flex')
    expect(displayRank({ solo, flex })).toBe(solo)
    expect(displayRank({ solo: null, flex })).toBe(flex)
    expect(displayRank({ solo: null, flex: null })).toBeNull()
    expect(displayRank(undefined)).toBeNull()
  })
})

describe('labels', () => {
  it('writes the tier, the division and the LP', () => {
    expect(rankLabel(rank('DIAMOND', 'II', 45))).toBe('Diamond II')
    expect(rankLabel(rank('DIAMOND', 'II', 45), { lp: true })).toBe('Diamond II · 45 LP')
    expect(rankLabel(rank('CHALLENGER', null, 1204), { lp: true })).toBe('Challenger · 1204 LP')
    expect(rankLabel(null)).toBe('Unranked')
    expect(rankLabel(null, { unranked: 'Non classé' })).toBe('Non classé')
    expect(rankLabel(rank('SILVER', 'I', 3), { tierName: (t) => (t === 'SILVER' ? 'Argent' : t) })).toBe('Argent I')
  })

  it('gives the win rate and the emblem', () => {
    expect(rankWinRate({ wins: 120, losses: 98 })).toBe(55)
    expect(rankWinRate({ wins: 0, losses: 0 })).toBeNull()
    expect(rankEmblemUrl('EMERALD')).toMatch(/ranked-emblem\/emblem-emerald\.png$/)
  })
})
