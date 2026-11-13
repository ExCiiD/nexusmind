/**
 * Renderer copy of the assistant report shape (electron/main/assistant/report.ts).
 * Kept in sync by hand, like the other IPC types in src/lib/ipc.ts.
 */

export type AssistantMoment = 'post_game' | 'session' | 'weekly'
export type AssistantTone = 'positive' | 'warning' | 'negative' | 'neutral'

export interface AssistantRewatchClip {
  gameId: string
  matchId: string
  champion: string
  recordingId: string | null
  gameTimeSec: number
}

export type AssistantAction =
  | { type: 'objective'; objectiveId: string }
  | { type: 'rewatch'; clips: AssistantRewatchClip[] }
  | { type: 'lanePhase'; gameId: string }
  | { type: 'break'; minutes: number }
  | { type: 'drill'; drillId: string }
  | { type: 'review'; gameId?: string }

export interface AssistantInsight {
  key: string
  ruleId: string
  tone: AssistantTone
  messageKey: string
  params: Record<string, string | number>
  paramKinds: Record<string, 'objective'>
  why: { key: string; params: Record<string, string | number> }
  action: AssistantAction | null
  score: number
  confidence: number
  vote: 1 | -1 | null
  /** Coaching-engine problem (electron/main/assistant/problems.ts). */
  problemId: string
  /** Other rules pointing to the same problem. */
  support: number
  /** The one thing to work on now. */
  focus: boolean
  /** Mistake tag behind the insight, if any. */
  tagSlug: string | null
  /** A measurable experiment can be started from this insight. */
  canExperiment: boolean
  /** Games the evidence came from ("Why?" opens these). */
  relatedGameIds: string[]
}

// ── Coaching engine — experiments (electron/main/assistant/experiments.ts) ──

export type CoachCriterion =
  | { kind: 'metric'; metric: string; op: '<=' | '>='; target: number }
  | { kind: 'noMistake'; tags: string[]; label?: string }

export type CoachVerdict = 'acquired' | 'progressing' | 'no_effect'

export interface CoachExperiment {
  id: string
  problemId: string
  fundamentalId: string | null
  tagSlug: string | null
  criterion: CoachCriterion
  baseline: { mean?: number | null; rate?: number | null; games: number }
  windowGames: number
  source: string
  status: 'active' | 'done' | 'abandoned'
  verdict: CoachVerdict | null
  startedAt: number
  endedAt: number | null
  progress: {
    results: Array<{ gameId: string; passed: boolean; value: number | null }>
    counted: number
    passes: number
    passRate: number | null
    done: boolean
    verdict: CoachVerdict | null
  }
  graduated: boolean
  nextObjectiveId: string | null
}

export interface CoachExperimentState {
  active: CoachExperiment | null
  recent: CoachExperiment | null
  history: CoachExperiment[]
  graduated: string[]
}

export interface CoachObjectiveCheck {
  experimentId: string
  problemId: string
  criterion: CoachCriterion
  passed: boolean
  value: number | null
}

export interface AssistantWinDriver {
  metric: string
  objectiveId: string
  coefficient: number
  importance: number
  direction: 'higher' | 'lower'
}

export interface AssistantProfileIndicator {
  metric: string
  bestMean: number
  worstMean: number
  gap: number
}

export interface AssistantBestWorstProfile {
  games: number
  bestGames: number
  worstGames: number
  indicators: AssistantProfileIndicator[]
}

export interface AssistantReport {
  moment: AssistantMoment
  generatedAt: number
  intro: { key: string; params: Record<string, string | number> }
  insights: AssistantInsight[]
  basisGames: number
  summary?: {
    games: number
    wins: number
    winrate: number | null
    previousGames: number
    previousWinrate: number | null
    reviewed: number
  }
  drivers?: { games: number; drivers: AssistantWinDriver[] } | null
  bestWorst?: AssistantBestWorstProfile | null
  /** Active experiment, or one that just ended. */
  experiment?: CoachExperiment | null
}
