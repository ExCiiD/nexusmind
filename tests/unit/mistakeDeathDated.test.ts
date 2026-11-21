/**
 * 20/11/2026 (lieux-et-extraits-video § 6): an error dated from a death plays from the death − 45 s to + 30 s on every
 * screen. The stored time never moves; this is a reading rule, plus the Lab bookmarks.
 */
import { describe, it, expect } from 'vitest'
import { DEATH_DATED_MISTAKE_TAGS, isDeathDatedAnswer, isDeathDatedMistake } from '../../src/lib/mistakeDeathDated'
import { bookmarkLeadFor, LEAD_SEC, planAutoBookmarks } from '../../electron/main/mistakeBookmarks'
import { analyzeGame } from '../../src/lib/microReview/anomalyDetector'
import { buildGame, at } from './microReviewFixtures'

describe('dated from a death', () => {
  it('the ten death rules, auto-detected', () => {
    expect([...DEATH_DATED_MISTAKE_TAGS].sort()).toEqual([
      'bad-positioning', 'bad-trade', 'behind-on-levels-death', 'caught-out', 'dead-during-objective',
      'death-before-objective', 'dove-tower', 'overstay', 'solo-baron-died', 'unused-gold',
    ])
    expect(isDeathDatedMistake({ tagSlug: 'bad-trade', autoDetected: true })).toBe(true)
  })
  it('not the ones dated on something else, nor a tag set by hand', () => {
    for (const tag of ['no-ward-pre-obj', 'forgot-trinket', 'bad-lane-opening', 'cs-deficit', 'xp-deficit', 'late-back']) {
      expect(isDeathDatedMistake({ tagSlug: tag, autoDetected: true }), tag).toBe(false)
    }
    expect(isDeathDatedMistake({ tagSlug: 'bad-trade', autoDetected: false })).toBe(false)
  })
  it('from a micro-review answer: by the moment, whatever the tag', () => {
    expect(isDeathDatedMistake({ tagSlug: 'cs-deficit', answerTrigger: 'critical-death' })).toBe(true)
    expect(isDeathDatedMistake({ tagSlug: 'bad-trade', autoDetected: true, answerTrigger: 'absent-objective' })).toBe(false)
    expect(isDeathDatedAnswer({ trigger: 'critical-death' })).toBe(true)
    expect(isDeathDatedAnswer({ trigger: 'early-deficit' })).toBe(false)
  })
})

describe('Lab bookmarks', () => {
  it('a death-dated mistake starts at the death window (45 s before), the others stay 15 s before', () => {
    expect(bookmarkLeadFor({ gameTimeSec: 372, deathDated: true })).toBe(45)
    expect(bookmarkLeadFor({ gameTimeSec: 372 })).toBe(LEAD_SEC)
    // A death at 0:30: the clip cannot start before the game.
    expect(bookmarkLeadFor({ gameTimeSec: 30, deathDated: true })).toBe(30)
  })
  it('a bad-trade at 6:12 is bookmarked at 5:27 (offset 0)', () => {
    const plan = planAutoBookmarks(
      [{ tagSlug: 'bad-trade', tagLabel: 'Bad trade', gameTimeSec: 372, severity: 3, deathDated: true }],
      { startOffsetSec: 0, gameDurationSec: 1800, existingVideoTimesMs: [] },
    )
    expect(plan).toEqual([{ videoTimeMs: 327_000, label: 'Bad trade' }])
  })
})

describe('micro-review moments carry what the clip needs', () => {
  it('a death moment is dated from a death; objective cards carry the objective and error times', () => {
    const death = { type: 'CHAMPION_KILL', timestamp: at(12, 10), victimId: 2, killerId: 7, assistingParticipantIds: [8, 9], position: { x: 6000, y: 6000 } }
    const a = analyzeGame(...Object.values((() => { const g = buildGame({ minutes: 25, me: 2, events: [death] }); return { m: g.match, t: g.timeline, s: g.selector } })()) as [any, any, any])
    for (const m of a?.moments ?? []) {
      expect(m.deathDated).toBe(m.trigger === 'critical-death')
      expect(m.facts.errorAtSec).toBe(m.facts.killSec != null ? m.facts.errorAtSec : m.gameTimeSec)
      expect('markers' in m).toBe(false)
      if (m.facts.killSec != null) expect(m.facts.objectiveAtSec).toBe(m.facts.killSec)
    }
  })
})
