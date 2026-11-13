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
  | { type: 'review' }

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
}

export interface AssistantWinDriver {
  metric: string
  objectiveId: string
  coefficient: number
  importance: number
  direction: 'higher' | 'lower'
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
}
