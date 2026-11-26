/**
 * Role quests (docs/PLAN_MOTEUR_BILANS.md phase 4): the real end of a quest read from the ITEM_DESTROYED of its item, the gap with
 * the direct opponent, and the rule that the gap is shown alone (never a term of the roam / gank verdict).
 */
import { describe, it, expect } from 'vitest'
import { buildGame, at } from './microReviewFixtures'
import { QUEST_ITEM_IDS, questCompletion, questGap } from '../../src/lib/microReview/roleQuest'
import { analyzeGame } from '../../src/lib/microReview/anomalyDetector'
import { roamLedger } from '../../src/lib/microReview/roamLedger'

const destroyed = (pid: number, itemId: number, ts: number) => ({ type: 'ITEM_DESTROYED', timestamp: ts, participantId: pid, itemId })

describe('role quests', () => {
  it('has one item set per role, unchanged across 16.x', () => {
    expect(Object.keys(QUEST_ITEM_IDS).sort()).toEqual(['BOTTOM', 'JUNGLE', 'MIDDLE', 'TOP', 'UTILITY'])
    expect(QUEST_ITEM_IDS.TOP).toEqual([1200, 1222])
  })

  it('reads the end of the quest of each role; a support takes its last destruction', () => {
    const g = buildGame({ events: [destroyed(3, 1201, at(12, 30)), destroyed(5, 1203, at(3, 20)), destroyed(5, 1203, at(13, 5)), destroyed(1, 1222, at(12, 0)), destroyed(3, 3006, at(5))] })
    expect(questCompletion(g.match, g.timeline, 3)).toEqual({ endSec: 750 })
    expect(questCompletion(g.match, g.timeline, 5)).toEqual({ endSec: 785 })
    expect(questCompletion(g.match, g.timeline, 1)).toEqual({ endSec: 720 })
    expect(questCompletion(g.match, g.timeline, 4)).toBeNull() // never ended
  })

  it('the gap with the direct opponent: positive when the player finished later', () => {
    const g = buildGame({ events: [destroyed(3, 1201, at(13, 0)), destroyed(8, 1201, at(12, 0))] })
    expect(questGap(g.match, g.timeline, 3)).toEqual({ endSec: 780, opponentEndSec: 720, gapSec: 60, verified: true })
    expect(questGap(g.match, g.timeline, 8)?.gapSec).toBe(-60)
    expect(questGap(g.match, g.timeline, 1)).toBeNull() // the opponent's quest never ended
  })

  it('a patch after the last verified one keeps the gap but flags it', () => {
    const g = buildGame({ gameVersion: '16.30.1.1', events: [destroyed(3, 1201, at(13, 0)), destroyed(8, 1201, at(12, 0))] })
    expect(questGap(g.match, g.timeline, 3)?.verified).toBe(false)
  })

  it('the analysis carries the gap and the roam verdict does not depend on it', () => {
    const base = { me: 3 }
    const a = buildGame({ ...base, events: [destroyed(3, 1201, at(13, 0)), destroyed(8, 1201, at(12, 0))] })
    const b = buildGame({ ...base, events: [destroyed(3, 1201, at(11, 0)), destroyed(8, 1201, at(13, 0))] })
    expect(analyzeGame(a.match, a.timeline, a.selector)?.quest?.gapSec).toBe(60)
    expect(analyzeGame(b.match, b.timeline, b.selector)?.quest?.gapSec).toBe(-120)
    expect(roamLedger(a.match, a.timeline, 3)?.entries).toEqual(roamLedger(b.match, b.timeline, 3)?.entries)
  })
})
