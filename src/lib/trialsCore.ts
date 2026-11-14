import type { SupabaseClient } from '@supabase/supabase-js'
import type { NewTrialCandidateInput, NewTrialEvaluationInput, TrialCandidate, TrialEvaluation, TrialStatus } from './trials'

/**
 * Recruitment trials (E10), same pattern as devPlanCore.ts. Purely
 * server-side, staff-only — desktop and web call these identically.
 */

function fail(error: { message: string; code?: string } | null, fallback: string): never {
  const msg = error?.message ?? fallback
  if (/permission|forbidden/i.test(msg) || error?.code === '42501') throw new Error('FORBIDDEN')
  throw new Error(msg)
}

interface CandidateRow {
  id: string; group_id: string; display_name: string; role: TrialCandidate['role']; user_id: string | null
  status: TrialStatus; period_start: string | null; period_end: string | null; notes: string | null
  created_by: string; created_at: string; updated_at: string
}
interface EvaluationRow { id: string; candidate_id: string; criterion: string; score: number; note: string | null; created_by: string; created_at: string }

const toEvaluation = (r: EvaluationRow): TrialEvaluation => ({
  id: r.id, candidateId: r.candidate_id, criterion: r.criterion, score: r.score, note: r.note,
  createdBy: r.created_by, createdAt: r.created_at,
})

async function hydrate(sb: SupabaseClient, c: CandidateRow): Promise<TrialCandidate> {
  const { data, error } = await sb.from('trial_evaluations')
    .select('id, candidate_id, criterion, score, note, created_by, created_at')
    .eq('candidate_id', c.id).order('created_at', { ascending: false })
  if (error) fail(error, 'evaluations')
  return {
    id: c.id, groupId: c.group_id, displayName: c.display_name, role: c.role, userId: c.user_id, status: c.status,
    periodStart: c.period_start, periodEnd: c.period_end, notes: c.notes,
    evaluations: (data as EvaluationRow[]).map(toEvaluation),
    createdBy: c.created_by, createdAt: c.created_at, updatedAt: c.updated_at,
  }
}

export async function listCandidates(sb: SupabaseClient, groupId: string): Promise<TrialCandidate[]> {
  const { data, error } = await sb.from('trial_candidates')
    .select('id, group_id, display_name, role, user_id, status, period_start, period_end, notes, created_by, created_at, updated_at')
    .eq('group_id', groupId).order('status').order('created_at', { ascending: false })
  if (error) fail(error, 'list candidates')
  return Promise.all((data as CandidateRow[]).map((row) => hydrate(sb, row)))
}

export async function createCandidate(sb: SupabaseClient, groupId: string, input: NewTrialCandidateInput): Promise<string> {
  const { data, error } = await sb.from('trial_candidates').insert({
    group_id: groupId, display_name: input.displayName, role: input.role,
    period_start: input.periodStart ?? null, period_end: input.periodEnd ?? null, notes: input.notes ?? null,
  }).select('id').single()
  if (error) fail(error, 'create candidate')
  return data.id
}

export async function setCandidateStatus(sb: SupabaseClient, id: string, status: TrialStatus): Promise<void> {
  const { error } = await sb.from('trial_candidates').update({ status }).eq('id', id)
  if (error) fail(error, 'set status')
}

export async function deleteCandidate(sb: SupabaseClient, id: string): Promise<void> {
  const { error } = await sb.from('trial_candidates').delete().eq('id', id)
  if (error) fail(error, 'delete candidate')
}

export async function addEvaluation(sb: SupabaseClient, candidateId: string, input: NewTrialEvaluationInput): Promise<void> {
  const { error } = await sb.from('trial_evaluations').insert({
    candidate_id: candidateId, criterion: input.criterion, score: input.score, note: input.note ?? null,
  })
  if (error) fail(error, 'add evaluation')
}

export async function deleteEvaluation(sb: SupabaseClient, id: string): Promise<void> {
  const { error } = await sb.from('trial_evaluations').delete().eq('id', id)
  if (error) fail(error, 'delete evaluation')
}
