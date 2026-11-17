import { describe, it, expect } from 'vitest'
import { rankMistakes, tagFamily, phaseOf, phaseBreakdown, buildTrend, latestMoments, type MistakeOccurrence } from '../../src/lib/mistakeInsights'

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
