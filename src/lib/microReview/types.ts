/** IPC / cloud shapes of the micro-review (docs/PLAN_MICRO_REVIEW.md). */

import type { GameAnalysis, MomentTrigger } from './anomalyDetector'
export type { MomentTrigger } from './anomalyDetector'
import type { PastAnswer, QcmSummary } from './smartQcm'
import type { VerificationResult } from './objectiveVerification'
import type { CalibrationGap, FamilyShare } from './calibration'
import type { MistakeFamily } from '../mistakeInsights'

/** 'dismissed' (21/11/2026, « Not a mistake »): the moment's detected mistake was erased; the moment is no longer offered. */
export type AnswerOutcome = 'mistake' | 'justified' | 'custom' | 'dismissed'

export interface MicroReviewAnswerView {
  id: string
  momentKey: string
  trigger: MomentTrigger
  gameTimeSec: number
  outcome: AnswerOutcome
  tagSlug: string | null
  reason: string | null
  viaOther: boolean
  note: string | null
  mistakeId: string | null
  createdAt: string
  /** 21/11/2026 « Repères de la micro-review »: the precise timestamps the player set (game seconds), when any. */
  errorAtSec?: number | null
  consequenceAtSec?: number | null
}

export interface MicroReviewRecording {
  id: string
  filePath: string | null
  youtubeUrl: string | null
  startOffsetSec: number | null
  createdAt: string
}

export interface MicroReviewPayload {
  gameId: string
  matchId: string
  champion: string
  role: string
  win: boolean
  gameEndAt: string
  durationSec: number
  analysis: GameAnalysis | null
  /** Why `analysis` is null (no timeline, no user…). */
  reason?: string
  answers: MicroReviewAnswerView[]
  /** 21/11/2026 « Not a mistake »: the moments the player dismissed (also in `answers`, outcome 'dismissed'). */
  dismissedMomentKeys?: string[]
  /** The player's past answers for this role (local learning). */
  pastAnswers: PastAnswer[]
  recording: MicroReviewRecording | null
}

export interface MicroReviewAnswerInput {
  gameId: string
  momentKey: string
  trigger: MomentTrigger
  gameTimeSec: number
  outcome: AnswerOutcome
  tagSlug?: string | null
  /** Label of a new personal tag ("+ tag personnalisé"). */
  customLabel?: string | null
  reason?: string | null
  viaOther: boolean
  note?: string | null
  /** Shared with the coach (structured, rendered in their language). */
  summary?: QcmSummary | null
  videoTimeSec?: number | null
}

export interface MicroReviewAnswerResult {
  answer: MicroReviewAnswerView
  /** XP granted when this answer completed the game's micro-review (once). */
  xpAwarded: number
  completed: boolean
}

export interface ObjectiveVerificationPayload {
  results: VerificationResult[]
  overall: boolean | null
}

export interface CalibrationStatus {
  due: boolean
  gamesSinceLast: number
  every: number
  lastAt: string | null
  distribution: FamilyShare[]
  /** Games the distribution was measured on. */
  basisGames: number
}

export interface CalibrationResult extends CalibrationGap {
  distribution: FamilyShare[]
  /** Costliest tag of the measured top family, for the 1-click action. */
  topTagSlug: string | null
}

export type { MistakeFamily }

// ── Cloud (coach side) ──────────────────────────────────────────────────

export type VerdictStatus = 'validated' | 'corrected'

export interface MicroVerdict {
  id: string
  answerId: string
  groupId: string
  coachId: string | null // null once the author deleted their account (S19-16 / #33)
  status: VerdictStatus
  correctedOutcome: 'mistake' | 'justified' | null
  correctedTag: string | null
  note: string | null
  createdAt: string
}

export interface CloudMicroAnswer {
  id: string
  playerId: string
  localId: string
  matchId: string | null
  champion: string
  role: string
  gameTimeSec: number
  videoTimeSec: number | null
  trigger: MomentTrigger
  outcome: AnswerOutcome
  tagSlug: string | null
  reason: string | null
  note: string | null
  summary: QcmSummary | null
  createdAt: string
  verdicts: MicroVerdict[]
}

export interface MicroVerdictInput {
  answerId: string
  groupId: string
  status: VerdictStatus
  correctedOutcome?: 'mistake' | 'justified' | null
  correctedTag?: string | null
  note?: string | null
}

export interface TeamCodexRuleInput {
  groupId: string
  role: 'any' | 'TOP' | 'JUNGLE' | 'MIDDLE' | 'BOTTOM' | 'UTILITY'
  mistakeSlug: string
  phase: 'any' | 'early' | 'mid' | 'late'
  fundamentalId: string
  radarAxis?: string
  headline: string
  tacticalRule: string
  drillObjective: string
  videoRef?: string | null
}

export interface TeamCodexRule extends TeamCodexRuleInput {
  id: string
  createdBy: string | null // null once the author deleted their account (S19-16 / #33)
  createdAt: string
}

export interface MicroReviewCloudApi {
  microReviewCloudPlayerAnswers: (playerId: string) => Promise<CloudMicroAnswer[]>
  microReviewCloudSetVerdict: (input: MicroVerdictInput) => Promise<void>
  microReviewCloudMyVerdicts: () => Promise<CloudMicroAnswer[]>
  teamCodexList: (groupIds: string[]) => Promise<TeamCodexRule[]>
  teamCodexAdd: (input: TeamCodexRuleInput) => Promise<void>
  teamCodexDelete: (id: string) => Promise<void>
}
