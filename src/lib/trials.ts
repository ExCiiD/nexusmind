/** Renderer-side mirror of the shared trial-recruitment tables (E10). */

export type TrialStatus = 'trialing' | 'kept' | 'rejected'
export type TrialRole = 'TOP' | 'JUNGLE' | 'MID' | 'ADC' | 'SUPPORT'

export interface TrialEvaluation {
  id: string
  candidateId: string
  criterion: string
  score: number
  note: string | null
  createdBy: string
  createdAt: string
}

export interface TrialCandidate {
  id: string
  groupId: string
  displayName: string
  role: TrialRole
  userId: string | null
  status: TrialStatus
  periodStart: string | null
  periodEnd: string | null
  notes: string | null
  evaluations: TrialEvaluation[]
  createdBy: string
  createdAt: string
  updatedAt: string
}

export interface NewTrialCandidateInput {
  displayName: string
  role: TrialRole
  periodStart?: string | null
  periodEnd?: string | null
  notes?: string | null
}

export interface NewTrialEvaluationInput {
  criterion: string
  score: number
  note?: string | null
}

/**
 * Staff-only end to end (RLS-enforced); server-only, so desktop and web
 * implement every method the same way — same pattern as devPlan.ts.
 */
export interface TrialsApi {
  trialsList: (groupId: string) => Promise<TrialCandidate[]>
  trialsCreate: (groupId: string, input: NewTrialCandidateInput) => Promise<string>
  trialsSetStatus: (id: string, status: TrialStatus) => Promise<void>
  trialsDelete: (id: string) => Promise<void>
  trialsAddEvaluation: (candidateId: string, input: NewTrialEvaluationInput) => Promise<void>
  trialsDeleteEvaluation: (id: string) => Promise<void>
}
