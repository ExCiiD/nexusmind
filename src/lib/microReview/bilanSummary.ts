/**
 * Per-game indicators of the bilans for the assistant (docs/moteur/PLAN_MOTEUR_BILANS.md phase 5), read from a stored GameAnalysis:
 * how many roams and ganks the ledgers read, how many were losing, the camps lost per gank, the real role-quest gap.
 * Pure. Rules and experiments on them are NOT written: see docs/moteur/engine-reports/2026-11-26-calibrage-assistant-bilans.md.
 */
import type { GameAnalysis } from './anomalyDetector'

export interface GameBilan {
  roams: number
  /** Roams the ledger read as losing. */
  roamsPaid: number
  /** Roams (support only) that left on a good timer, null for the other roles. */
  roamsGoodTimer: number | null
  ganks: number
  ganksPaid: number
  /** Camps lost against the enemy jungler, per gank (null without a gank). */
  campsLostPerGank: number | null
  /** Seconds the quest ended after the direct opponent's (negative = ahead), null when unknown or not verified. */
  questGapSec: number | null
}

/** null when the analysis carries no ledger at all (stored before ANALYSIS_VERSION 16, or a role without one). */
export function bilanOf(a: GameAnalysis | null | undefined): GameBilan | null {
  if (!a || (!a.roams && !a.ganks && !a.quest)) return null
  const roams = a.roams ?? []
  const ganks = a.ganks ?? []
  return {
    roams: roams.length,
    roamsPaid: roams.filter((r) => r.verdict === 'losing').length,
    roamsGoodTimer: a.position === 'UTILITY' ? roams.filter((r) => r.goodTimer).length : null,
    ganks: ganks.length,
    ganksPaid: ganks.filter((g) => g.verdict === 'losing').length,
    campsLostPerGank: ganks.length ? Math.round((ganks.reduce((s, g) => s + g.campsLost, 0) / ganks.length) * 100) / 100 : null,
    questGapSec: a.quest && a.quest.verified ? a.quest.gapSec : null,
  }
}
