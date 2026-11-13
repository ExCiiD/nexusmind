import { describe, it, expect } from 'vitest'
import { statBilanGaps, needsStatDeviationReassessment, suggestedScores, Z_THRESHOLD, MAX_NUDGE } from '../../electron/main/assistant/reassessment'
import type { MetricStats } from '../../electron/main/assistant/features'

const stat = (z: number | null): MetricStats => ({
  metric: 'csPerMin', values: [], n: 10, mean: 6, sd: 1, recentMean: 6, baselineMean: 6, baselineSd: 1, z, trend: null,
})

describe('statBilanGaps', () => {
  it('flags a fundamental whose metric clearly improved vs baseline', () => {
    const gaps = statBilanGaps({ csPerMin: stat(2) }, { csing_pathing: 3 })
    expect(gaps).toEqual([{ fundamentalId: 'csing_pathing', metric: 'csPerMin', selfScore: 3, z: 2 }])
  })

  it('sign-adjusts a lower-is-better metric (deaths): a drop in deaths is a positive gap', () => {
    const gaps = statBilanGaps({ deaths: stat(-2) }, { tempo: 4 })
    expect(gaps).toEqual([{ fundamentalId: 'tempo', metric: 'deaths', selfScore: 4, z: 2 }])
  })

  it('ignores fundamentals never self-rated, or with no / weak z', () => {
    expect(statBilanGaps({ csPerMin: stat(2) }, {})).toEqual([])
    expect(statBilanGaps({ csPerMin: stat(null) }, { csing_pathing: 3 })).toEqual([])
    expect(statBilanGaps({ csPerMin: stat(1) }, { csing_pathing: 3 })).toEqual([]) // below Z_THRESHOLD
    expect(statBilanGaps({ csPerMin: stat(Z_THRESHOLD) }, { csing_pathing: 3 })).toHaveLength(1) // exactly at the threshold
  })

  it('can report several gaps at once, one per driver metric', () => {
    const gaps = statBilanGaps(
      { csPerMin: stat(2), deaths: { ...stat(-2), metric: 'deaths' } },
      { csing_pathing: 3, tempo: 2 },
    )
    expect(gaps).toHaveLength(2)
  })
})

describe('suggestedScores', () => {
  it('nudges the previous rating by the sign-adjusted z-score, rounded and clamped to 1-5', () => {
    expect(suggestedScores({ csPerMin: stat(1.6) }, { csing_pathing: 3 })).toEqual([
      { fundamentalId: 'csing_pathing', metric: 'csPerMin', score: 5, previousScore: 3, z: 1.6 },
    ])
    expect(suggestedScores({ deaths: stat(-1.4) }, { tempo: 3 })).toEqual([
      { fundamentalId: 'tempo', metric: 'deaths', score: 4, previousScore: 3, z: 1.4 },
    ])
  })

  it(`caps the move at ±${MAX_NUDGE} points even for a very large z`, () => {
    expect(suggestedScores({ csPerMin: stat(10) }, { csing_pathing: 2 })[0].score).toBe(2 + MAX_NUDGE)
    expect(suggestedScores({ csPerMin: stat(-10) }, { csing_pathing: 4 })[0].score).toBe(4 - MAX_NUDGE)
  })

  it('never suggests anything for a fundamental with no previous rating (first-ever assessment)', () => {
    expect(suggestedScores({ csPerMin: stat(2) }, {})).toEqual([])
  })

  it('suggests nothing when the nudge rounds to zero, or the metric has no z', () => {
    expect(suggestedScores({ csPerMin: stat(0.3) }, { csing_pathing: 3 })).toEqual([])
    expect(suggestedScores({ csPerMin: stat(null) }, { csing_pathing: 3 })).toEqual([])
  })
})

describe('needsStatDeviationReassessment', () => {
  it('requires at least 3 gaps', () => {
    expect(needsStatDeviationReassessment([])).toBe(false)
    expect(needsStatDeviationReassessment([{ fundamentalId: 'a', metric: 'csPerMin', selfScore: 3, z: 2 }, { fundamentalId: 'b', metric: 'deaths', selfScore: 3, z: 2 }])).toBe(false)
    expect(needsStatDeviationReassessment([
      { fundamentalId: 'a', metric: 'csPerMin', selfScore: 3, z: 2 },
      { fundamentalId: 'b', metric: 'deaths', selfScore: 3, z: 2 },
      { fundamentalId: 'c', metric: 'kp', selfScore: 3, z: 2 },
    ])).toBe(true)
  })
})
