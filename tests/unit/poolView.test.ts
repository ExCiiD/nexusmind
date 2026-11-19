import { describe, it, expect } from 'vitest'
import type { ChampionPoolEntry } from '../../src/lib/ipc'
import {
  MANUAL_TIERS,
  groupByTier,
  inactiveDays,
  newSinceDays,
  ruleTierIfHandPicked,
  summarizePool,
  tierCounts,
} from '../../src/lib/poolView'

const DAY = 86_400_000
const NOW = Date.UTC(2026, 10, 19, 12)

let n = 0
function entry(partial: Partial<ChampionPoolEntry> & { championKey: string; tier: string }): ChampionPoolEntry {
  n++
  return {
    id: `e${n}`, memberId: 'm1', role: 'JUNGLE', notes: null, playRate: null, winRate: null, masteryPoints: null, kda: null,
    updatedAt: new Date(NOW - 2 * DAY).toISOString(), ...partial,
  }
}

const pool = [
  entry({ championKey: 'MonkeyKing', tier: 'main', playRate: 42, winRate: 50 }),
  entry({ championKey: 'DrMundo', tier: 'main', playRate: 38, winRate: 50 }),
  entry({ championKey: 'Viego', tier: 'main', playRate: 28, winRate: 61 }),
  entry({ championKey: 'Ambessa', tier: 'new', playRate: 14, winRate: 64, firstPlayedAt: new Date(NOW - 9 * DAY).toISOString() }),
  entry({ championKey: 'Jayce', tier: 'comfort', playRate: 21, winRate: 52 }),
  entry({ championKey: 'Sett', tier: 'comfort', playRate: 0, masteryPoints: 260_000 }),
  entry({ championKey: 'Gnar', tier: 'learning', playRate: 3, winRate: 100 }),
  entry({ championKey: 'Shaco', tier: 'flex' }), // added by hand: no stats
]

describe('summarizePool', () => {
  const s = summarizePool(pool)

  it('adds up the games and finds the last update', () => {
    expect(s.games).toBe(42 + 38 + 28 + 14 + 21 + 3)
    expect(s.updatedAt).toBe(NOW - 2 * DAY)
    expect(s.fetched).toBe(true)
  })

  it('orders the segments by tier, then most played, and skips champions without games', () => {
    expect(s.segments.map((x) => x.entry.championKey)).toEqual(['MonkeyKing', 'DrMundo', 'Viego', 'Ambessa', 'Jayce', 'Gnar'])
  })

  it('gives the share of games per tier and of the top 3', () => {
    expect(s.tierShare.main).toBeCloseTo(108 / 146, 5)
    expect(s.tierShare.new).toBeCloseTo(14 / 146, 5)
    expect(s.top3Share).toBeCloseTo(108 / 146, 5)
  })

  it('reads a pool without Riot data as not fetched', () => {
    expect(summarizePool([entry({ championKey: 'Shaco', tier: 'flex' })]).fetched).toBe(false)
  })
})

describe('groupByTier / tierCounts', () => {
  it('groups most played first, mastery breaking ties', () => {
    const g = groupByTier(pool)
    expect(g.main.map((e) => e.championKey)).toEqual(['MonkeyKing', 'DrMundo', 'Viego'])
    expect(g.comfort.map((e) => e.championKey)).toEqual(['Jayce', 'Sett'])
    expect(g.flex.map((e) => e.championKey)).toEqual(['Shaco'])
  })

  it('files an unknown tier under flex', () => {
    expect(tierCounts([entry({ championKey: 'Zed', tier: 'legacy' })]).flex).toBe(1)
  })
})

describe('tile facts', () => {
  it('counts the days since a new pick started', () => {
    expect(newSinceDays(pool[3], NOW)).toBe(9)
    expect(newSinceDays(pool[0], NOW)).toBeNull()
  })

  it('flags a champion unplayed for 30+ days while the player kept playing', () => {
    const latest = NOW - DAY
    expect(inactiveDays({ lastPlayedAt: new Date(latest - 35 * DAY).toISOString() }, latest)).toBe(35)
    expect(inactiveDays({ lastPlayedAt: new Date(latest - 10 * DAY).toISOString() }, latest)).toBeNull()
    expect(inactiveDays({ lastPlayedAt: null }, latest)).toBeNull()
  })

  it('names the computed tier only when the shown one was picked by hand', () => {
    expect(ruleTierIfHandPicked({ tier: 'main', autoTier: 'comfort' })).toBe('comfort')
    expect(ruleTierIfHandPicked({ tier: 'main', autoTier: 'main' })).toBeNull()
    expect(ruleTierIfHandPicked({ tier: 'main', autoTier: null })).toBeNull()
  })

  it('never offers "new" as a hand-picked tier', () => {
    expect(MANUAL_TIERS).not.toContain('new')
  })
})
