/**
 * Sessions without fundamentals (20/11/2026) and the review flow of 21/11/2026: written objectives, their review
 * results, prefilled notes from the micro-review moments, the next key moments, dismissed detected mistakes.
 */
import { describe, it, expect } from 'vitest'
import {
  assertHasObjective, fundamentalIdsOf, hasFundamentals, normalizeCustomObjectives, normalizeCustomResults, objectiveRespectedOf,
  parseCustomObjectiveResults, parseCustomObjectives, sessionObjectivesOf,
} from '../../src/lib/sessionObjectives'
import { buildMomentNotes } from '../../electron/main/reviewNotes'
import { isDismissed, DISMISS_WINDOW_SEC } from '../../electron/main/detectedMistakesCore'
import { pickExtraMoments, pickMoments, MAX_EXTRA_MOMENTS, type CriticalMoment } from '../../src/lib/microReview/anomalyDetector'

const seq = () => { let i = 0; return () => ((i++ * 0.137) % 1) }

describe('written objectives', () => {
  it('trimmed, 1-200 characters, at most 5, ids kept or made, one per coach assignment', () => {
    const out = normalizeCustomObjectives([
      { id: 'obj-keep', text: '  Ward river before 3:15 ', source: 'player' },
      { text: 'Track the enemy jungler', source: 'coach', assignmentId: 'a1', fundamentalIds: ['map_awareness'] },
      { text: 'Same assignment again', source: 'coach', assignmentId: 'a1' },
    ], seq())
    expect(out).toHaveLength(2)
    expect(out[0]).toEqual({ id: 'obj-keep', text: 'Ward river before 3:15', source: 'player' })
    expect(out[1]).toMatchObject({ source: 'coach', assignmentId: 'a1', fundamentalIds: ['map_awareness'] })
    expect(out[1].id).toMatch(/^obj-[a-z0-9]{8}$/)
    expect(() => normalizeCustomObjectives([{ text: '   ', source: 'player' }])).toThrow('BAD_OBJECTIVE')
    expect(() => normalizeCustomObjectives([{ text: 'x'.repeat(201), source: 'player' }])).toThrow('BAD_OBJECTIVE')
    expect(() => normalizeCustomObjectives(Array.from({ length: 6 }, (_, i) => ({ text: `o${i}`, source: 'player' as const })))).toThrow('TOO_MANY_OBJECTIVES')
  })

  it('a session needs a fundamental or a written objective; an empty objectiveId is no fundamental', () => {
    expect(() => assertHasObjective([], [])).toThrow('NO_OBJECTIVE')
    expect(() => assertHasObjective([], normalizeCustomObjectives([{ text: 'one', source: 'player' }]))).not.toThrow()
    expect(fundamentalIdsOf({ objectiveId: '', objectiveIds: '[]' })).toEqual([])
    expect(fundamentalIdsOf({ objectiveId: 'cs', objectiveIds: '[]' })).toEqual(['cs'])
    expect(fundamentalIdsOf({ objectiveId: 'cs', objectiveIds: '["cs","trades"]' })).toEqual(['cs', 'trades'])
    expect(hasFundamentals({ objectiveId: '', objectiveIds: '[]' })).toBe(false)
    expect(sessionObjectivesOf({ objectiveId: '', objectiveIds: '[]', customObjectives: '[{"id":"o1","text":"x","source":"player"}]' }).custom).toHaveLength(1)
    expect(parseCustomObjectives('not json')).toEqual([])
  })

  it('review results: only the session\'s objectives, one each; "respected" without fundamentals = all yes', () => {
    const objectives = normalizeCustomObjectives([{ id: 'o1', text: 'a', source: 'player' }, { id: 'o2', text: 'b', source: 'player' }])
    const results = normalizeCustomResults([
      { objectiveId: 'o1', result: 'yes', note: '  fine  ' }, { objectiveId: 'o1', result: 'no' },
      { objectiveId: 'ghost', result: 'yes' }, { objectiveId: 'o2', result: 'maybe' },
    ], objectives)
    expect(results).toEqual([{ objectiveId: 'o1', result: 'yes', note: 'fine' }])
    expect(objectiveRespectedOf({ hasFundamentals: false, results, objectives })).toBe(false)
    const all = normalizeCustomResults([{ objectiveId: 'o1', result: 'yes' }, { objectiveId: 'o2', result: 'yes' }], objectives)
    expect(objectiveRespectedOf({ hasFundamentals: false, results: all, objectives })).toBe(true)
    expect(objectiveRespectedOf({ hasFundamentals: true, given: false, results: all, objectives })).toBe(false)
    expect(parseCustomObjectiveResults(JSON.stringify(all))).toEqual(all)
  })
})

describe('prefilled review notes: the micro-review moments only', () => {
  it('oldest first, with the tag the player chose and the moment\'s pattern for the title', () => {
    const notes = buildMomentNotes(
      [
        { momentKey: 'absent-objective@960', trigger: 'absent-objective', gameTimeSec: 960, outcome: 'justified', tagSlug: null },
        { momentKey: 'critical-death@77', trigger: 'critical-death', gameTimeSec: 77, outcome: 'mistake', tagSlug: 'bad-trade' },
      ],
      new Map([['bad-trade', 'Bad trade']]),
      (k) => (k === 'critical-death@77' ? 'level-up-spike' : null),
    )
    expect(notes.map((n) => [n.time, n.note, n.pattern, n.tagSlug])).toEqual([
      ['1:17', 'Bad trade', 'level-up-spike', 'bad-trade'],
      ['16:00', '', null, null],
    ])
    expect(notes.every((n) => n.auto === true)).toBe(true)
  })
})

describe('next key moments', () => {
  const m = (sec: number, severity: number): CriticalMoment => ({
    key: `critical-death@${sec}`, trigger: 'critical-death', gameTimeSec: sec, severity, position: null, zone: null, lane: null, territory: null,
    winProbBefore: 0.5, winProbAfter: 0.4, facts: {},
  })
  it('the candidates cut by the limit of 3, 25 s from each other and from the 3, at most 5, in game order', () => {
    const candidates = [m(100, 0.9), m(300, 0.8), m(500, 0.7), m(510, 0.6), m(700, 0.5), m(900, 0.4), m(1100, 0.3), m(1300, 0.2), m(1500, 0.1), m(1700, 0.05)]
    const kept = pickMoments(candidates)
    expect(kept.map((x) => x.gameTimeSec)).toEqual([100, 300, 500])
    const extra = pickExtraMoments(candidates, kept)
    expect(extra.map((x) => x.gameTimeSec)).toEqual([700, 900, 1100, 1300, 1500])
    expect(extra).toHaveLength(MAX_EXTRA_MOMENTS)
    expect(extra.some((x) => x.gameTimeSec === 510)).toBe(false) // 10 s from a kept moment
  })
})

describe('dismissed detected mistakes', () => {
  it('same tag within 20 s is never recreated; another tag or farther is', () => {
    const dismissed = [{ tagSlug: 'bad-trade', gameTimeSec: 372 }]
    expect(isDismissed(dismissed, 'bad-trade', 372 + DISMISS_WINDOW_SEC)).toBe(true)
    expect(isDismissed(dismissed, 'bad-trade', 372 - 21)).toBe(false)
    expect(isDismissed(dismissed, 'caught-out', 372)).toBe(false)
  })
})
