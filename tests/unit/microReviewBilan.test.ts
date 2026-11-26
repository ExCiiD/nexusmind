/**
 * Phase 5 (docs/PLAN_MOTEUR_BILANS.md): the bilan indicators of a stored analysis for the assistant, and their passage into the game
 * features. No assistant rule or experiment reads them yet (docs/engine-reports/2026-11-26-calibrage-assistant-bilans.md).
 */
import { describe, it, expect } from 'vitest'
import { bilanOf } from '../../src/lib/microReview/bilanSummary'
import { computeGameFeatures, type GameRecord } from '../../electron/main/assistant/features'
import type { GameAnalysis } from '../../src/lib/microReview/anomalyDetector'

const entry = (verdict: string, extra: Record<string, unknown> = {}) => ({ verdict, ...extra }) as any
const analysis = (o: Partial<GameAnalysis>): GameAnalysis => ({
  participantId: 1, teamId: 100, champion: 'X', position: 'MIDDLE', winProb: [], moments: [], contested: [], garbageDiscarded: 0, laneAt10: null, ...o,
})

describe('bilanOf', () => {
  it('is null for an analysis without any ledger', () => {
    expect(bilanOf(null)).toBeNull()
    expect(bilanOf(analysis({}))).toBeNull()
  })

  it('counts roams, losing roams and the gank averages', () => {
    const b = bilanOf(analysis({
      position: 'JUNGLE', roams: [entry('losing'), entry('neutral')],
      ganks: [entry('losing', { campsLost: 3 }), entry('neutral', { campsLost: 1 }), entry('profitable', { campsLost: 0 })],
      quest: { endSec: 760, opponentEndSec: 700, gapSec: 60, verified: true },
    }))!
    expect(b).toMatchObject({ roams: 2, roamsPaid: 1, roamsGoodTimer: null, ganks: 3, ganksPaid: 1, campsLostPerGank: 1.33, questGapSec: 60 })
  })

  it('support: roams on a good timer; an unverified quest gap is not passed on', () => {
    const b = bilanOf(analysis({ position: 'UTILITY', roams: [entry('neutral', { goodTimer: true }), entry('losing', { goodTimer: false })], quest: { endSec: 1, opponentEndSec: 2, gapSec: -1, verified: false } }))!
    expect(b.roamsGoodTimer).toBe(1)
    expect(b.questGapSec).toBeNull()
    expect(b.campsLostPerGank).toBeNull()
  })

  it('goes through computeGameFeatures', () => {
    const g = { id: 'g', matchId: 'm', sessionId: 's', endedAt: 0, durationSec: 1800, win: true, kills: 0, deaths: 0, assists: 0, cs: 0, visionScore: 0, role: 'MIDDLE', champion: 'X', objectiveIds: [], reviewed: false, bilan: { roams: 1, roamsPaid: 1, roamsGoodTimer: null, ganks: 0, ganksPaid: 0, campsLostPerGank: null, questGapSec: null } } as GameRecord
    expect(computeGameFeatures(g).bilan?.roamsPaid).toBe(1)
    expect(computeGameFeatures({ ...g, bilan: undefined }).bilan).toBeNull()
  })
})
