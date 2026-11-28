import { describe, it, expect } from 'vitest'
import { rankMistakes, tagFamily, phaseOf, phaseBreakdown, buildTrend, latestMoments, hasTiers, sortRanking, tierCounts, tierSegments, type MistakeOccurrence, type MistakeTier } from '../../src/lib/mistakeInsights'

let n = 0
function occ(slug: string, gameId: string, win: boolean, day: number, t = 600, category = 'macro'): MistakeOccurrence {
  n++
  return {
    id: `m${n}`, tag: { id: `t-${slug}`, slug, label: slug, category }, severity: 2, gameTimeSec: t, autoDetected: false, note: null,
    recordingId: 'r1', game: { id: gameId, champion: 'Vi', opponentChampion: null, win, gameEndAt: new Date(Date.UTC(2026, 10, day, 20)).toISOString(), duration: 1800 },
  }
}

describe('tagFamily', () => {
  it('maps built-in slugs and falls back on category', () => {
    expect(tagFamily('caught-out', 'macro')).toBe('deaths')
    expect(tagFamily('no-ward-pre-obj', 'vision')).toBe('vision')
    expect(tagFamily('my-custom', 'economy')).toBe('tempo')
  })
})

describe('rankMistakes', () => {
  it('ranks by count with share and win-rate cost over analysed games', () => {
    const o = [
      occ('caught-out', 'g1', false, 1), occ('caught-out', 'g2', false, 2), occ('caught-out', 'g2', false, 2),
      occ('late-back', 'g3', true, 3), occ('late-back', 'g4', true, 4),
    ]
    const [first, second] = rankMistakes(o)
    expect(first).toMatchObject({ slug: 'caught-out', count: 3, share: 60, games: 2, winrateWith: 0, winrateWithout: 100 })
    expect(second.slug).toBe('late-back')
  })

  it('withholds the win-rate cost below 2 games on a side', () => {
    const [r] = rankMistakes([occ('overstay', 'g1', true, 1)])
    expect(r.winrateWith).toBeNull()
  })
})

describe('phases', () => {
  it('splits early / mid / late at 14 and 25 minutes', () => {
    expect(phaseOf(13 * 60)).toBe('early')
    expect(phaseOf(20 * 60)).toBe('mid')
    expect(phaseOf(30 * 60)).toBe('late')
    expect(phaseBreakdown([occ('a', 'g', true, 1, 100), occ('a', 'g', true, 1, 2000)])).toEqual({ early: 1, mid: 0, late: 1 })
  })
})

describe('buildTrend', () => {
  it('switches to per-game buckets when history spans few days', () => {
    const o = [occ('a', 'g1', true, 1), occ('a', 'g2', true, 2), occ('b', 'g2', true, 2)]
    const t = buildTrend(o, ['a'])
    expect(t.mode).toBe('game')
    expect(t.points.map((p) => p.counts.a)).toEqual([1, 1])
  })

  it('uses days once there is enough history', () => {
    const o = [1, 2, 3, 4, 5].map((d) => occ('a', `g${d}`, true, d))
    expect(buildTrend(o, ['a']).mode).toBe('day')
  })
})

describe('latestMoments', () => {
  it('returns the newest occurrences of a tag', () => {
    const o = [occ('a', 'g1', true, 1, 100), occ('a', 'g2', true, 5, 200), occ('b', 'g3', true, 9)]
    expect(latestMoments(o, 'a').map((m) => m.game.id)).toEqual(['g2', 'g1'])
  })
})

describe('rankMistakes — garbage time', () => {
  it('keeps garbage-time occurrences in the count but out of the win-rate ratios', () => {
    const g = (o: MistakeOccurrence) => ({ ...o, garbageTime: true })
    const o = [
      occ('caught-out', 'g1', false, 1), occ('caught-out', 'g2', false, 2), g(occ('caught-out', 'g3', true, 3)),
      occ('late-back', 'g4', true, 4), occ('late-back', 'g5', true, 5),
    ]
    const caught = rankMistakes(o).find((r) => r.slug === 'caught-out')!
    expect(caught.count).toBe(3)
    // g3 (a stomp) sits on neither side: with = g1, g2 (0 %), without = g4, g5 (100 %).
    expect(caught).toMatchObject({ winrateWith: 0, winrateWithout: 100 })
  })
})

describe('tiers', () => {
  const t = (slug: string, gameId: string, win: boolean, tier: MistakeTier | null, day = 1) => ({ ...occ(slug, gameId, win, day), tier })
  const data = [
    t('caught-out', 'g1', false, 'fatal'), t('caught-out', 'g2', false, 'critical'), t('caught-out', 'g3', false, 'trivial'), t('caught-out', 'g3', false, null),
    t('late-back', 'g1', false, 'critical'), t('late-back', 'g2', true, 'critical'), t('late-back', 'g4', true, 'medium'), t('late-back', 'g5', true, 'medium'),
  ]
  it('all tiers leaves the trivial ones out of the counts, and keeps the unknown ones', () => {
    const rows = rankMistakes(data)
    const co = rows.find((r) => r.slug === 'caught-out')!
    expect(co.count).toBe(3)
    expect(co.tiers).toEqual({ fatal: 1, critical: 1, medium: 0, trivial: 0, unknown: 1 })
    expect(rows.reduce((n, r) => n + r.share, 0)).toBeGreaterThanOrEqual(99)
  })
  it('a picked tier keeps only that tier, with the share of that tier, and never the unknown ones', () => {
    const fatal = rankMistakes(data, 'fatal')
    expect(fatal.map((r) => [r.slug, r.count, r.share])).toEqual([['caught-out', 1, 100]])
    expect(rankMistakes(data, 'trivial').map((r) => [r.slug, r.count])).toEqual([['caught-out', 1]])
    expect(rankMistakes(data, 'medium').map((r) => r.slug)).toEqual(['late-back'])
  })
  it('the win-rate cost does not move with the tier filter and leaves the trivial mistakes out', () => {
    const a = rankMistakes(data).find((r) => r.slug === 'caught-out')!
    const b = rankMistakes(data, 'fatal').find((r) => r.slug === 'caught-out')!
    expect([b.winrateWith, b.winrateWithout, b.gamesWith]).toEqual([a.winrateWith, a.winrateWithout, a.gamesWith])
    expect(a.gamesWith).toBe(3)
  })
  it('sorts by gravity: most fatal first, then critical, then count', () => {
    const rows = rankMistakes(data)
    expect(rows[0].slug).toBe('late-back')
    expect(sortRanking(rows, 'frequency')).toBe(rows)
    expect(sortRanking(rows, 'severity').map((r) => r.slug)).toEqual(['caught-out', 'late-back'])
  })
  it('draws the segments fatal → critical → medium → trivial → unknown, and shows tiers only when some are known', () => {
    expect(tierSegments(tierCounts(data)).map((s) => s.tier)).toEqual(['fatal', 'critical', 'medium', 'trivial', 'unknown'])
    expect(hasTiers(data)).toBe(true)
    expect(hasTiers([occ('a', 'g', true, 1)])).toBe(false)
  })
})
