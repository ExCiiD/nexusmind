import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  CloudMicroAnswer, MicroVerdict, MicroVerdictInput, TeamCodexRule, TeamCodexRuleInput,
} from './microReview/types'
import type { CodexEntry } from './microReview/codex'

/**
 * Micro-review, coach side (supabase/migrations/20261117210000_micro_review_coach.sql),
 * same pattern as vodReviewCore.ts — desktop and web call these identically.
 *
 * The migration may not be applied yet: a missing table surfaces as
 * `MICRO_REVIEW_CLOUD_UNAVAILABLE` so the UI can say "not enabled yet"
 * instead of a raw PostgREST error.
 */

export const UNAVAILABLE = 'MICRO_REVIEW_CLOUD_UNAVAILABLE'

function fail(error: { message: string; code?: string } | null, fallback: string): never {
  const msg = error?.message ?? fallback
  if (error?.code === 'PGRST205' || error?.code === '42P01' || /could not find the table|does not exist/i.test(msg)) throw new Error(UNAVAILABLE)
  if (/permission|forbidden/i.test(msg) || error?.code === '42501') throw new Error('FORBIDDEN')
  throw new Error(msg)
}

interface AnswerRow {
  id: string; player_id: string; local_id: string; match_id: string | null; champion: string; role: string
  game_time_sec: number; video_time_sec: number | null; trigger: CloudMicroAnswer['trigger']; outcome: CloudMicroAnswer['outcome']
  tag_slug: string | null; reason: string | null; note: string | null; summary: any; created_at: string
}
interface VerdictRow {
  id: string; answer_id: string; group_id: string; coach_id: string; status: MicroVerdict['status']
  corrected_outcome: MicroVerdict['correctedOutcome']; corrected_tag: string | null; note: string | null; created_at: string
}
interface CodexRow {
  id: string; group_id: string; role: TeamCodexRule['role']; mistake_slug: string; phase: TeamCodexRule['phase']; radar_axis: string
  fundamental_id: string; headline: string; tactical_rule: string; drill_objective: string; video_ref: string | null; created_by: string; created_at: string
}

const ANSWER_COLS = 'id, player_id, local_id, match_id, champion, role, game_time_sec, video_time_sec, trigger, outcome, tag_slug, reason, note, summary, created_at'
const VERDICT_COLS = 'id, answer_id, group_id, coach_id, status, corrected_outcome, corrected_tag, note, created_at'

const toVerdict = (r: VerdictRow): MicroVerdict => ({
  id: r.id, answerId: r.answer_id, groupId: r.group_id, coachId: r.coach_id, status: r.status,
  correctedOutcome: r.corrected_outcome, correctedTag: r.corrected_tag, note: r.note, createdAt: r.created_at,
})
const toAnswer = (r: AnswerRow, verdicts: MicroVerdict[]): CloudMicroAnswer => ({
  id: r.id, playerId: r.player_id, localId: r.local_id, matchId: r.match_id, champion: r.champion, role: r.role,
  gameTimeSec: r.game_time_sec, videoTimeSec: r.video_time_sec, trigger: r.trigger, outcome: r.outcome, tagSlug: r.tag_slug,
  reason: r.reason, note: r.note, summary: r.summary && typeof r.summary === 'object' && r.summary.head ? r.summary : null,
  createdAt: r.created_at, verdicts: verdicts.filter((v) => v.answerId === r.id),
})

async function withVerdicts(sb: SupabaseClient, rows: AnswerRow[]): Promise<CloudMicroAnswer[]> {
  if (rows.length === 0) return []
  const { data, error } = await sb.from('micro_review_verdicts').select(VERDICT_COLS).in('answer_id', rows.map((r) => r.id))
  if (error) fail(error, 'verdicts')
  const verdicts = (data as VerdictRow[]).map(toVerdict)
  return rows.map((r) => toAnswer(r, verdicts))
}

export interface PushAnswerInput {
  localId: string
  matchId: string | null
  champion: string
  role: string
  gameTimeSec: number
  videoTimeSec: number | null
  trigger: CloudMicroAnswer['trigger']
  outcome: CloudMicroAnswer['outcome']
  tagSlug: string | null
  reason: string | null
  note: string | null
  summary: unknown
}

/** Player side: mirror one local answer (upsert on the local id). */
export async function pushAnswer(sb: SupabaseClient, playerId: string, a: PushAnswerInput): Promise<void> {
  const { error } = await sb.from('micro_review_answers').upsert({
    player_id: playerId, local_id: a.localId, match_id: a.matchId, champion: a.champion.slice(0, 40), role: a.role.slice(0, 16),
    game_time_sec: a.gameTimeSec, video_time_sec: a.videoTimeSec, trigger: a.trigger, outcome: a.outcome,
    tag_slug: a.tagSlug, reason: a.reason, note: a.note, summary: a.summary ?? {},
  }, { onConflict: 'player_id,local_id' })
  if (error) fail(error, 'push answer')
}

/** Coach side: a player's answers (newest first) with every verdict. */
export async function listPlayerAnswers(sb: SupabaseClient, playerId: string, limit = 60): Promise<CloudMicroAnswer[]> {
  const { data, error } = await sb.from('micro_review_answers').select(ANSWER_COLS)
    .eq('player_id', playerId).order('created_at', { ascending: false }).limit(limit)
  if (error) fail(error, 'list answers')
  return withVerdicts(sb, data as AnswerRow[])
}

/** Player side: own answers that a coach validated or corrected. */
export async function listMyReviewedAnswers(sb: SupabaseClient, playerId: string, limit = 30): Promise<CloudMicroAnswer[]> {
  const all = await listPlayerAnswers(sb, playerId, limit)
  return all.filter((a) => a.verdicts.length > 0)
}

export async function setVerdict(sb: SupabaseClient, coachId: string, v: MicroVerdictInput): Promise<void> {
  const { error } = await sb.from('micro_review_verdicts').upsert({
    answer_id: v.answerId, group_id: v.groupId, coach_id: coachId, status: v.status,
    corrected_outcome: v.status === 'corrected' ? v.correctedOutcome ?? null : null,
    corrected_tag: v.status === 'corrected' ? v.correctedTag ?? null : null,
    note: v.note?.trim() || null,
  }, { onConflict: 'answer_id,coach_id' })
  if (error) fail(error, 'set verdict')
}

const toRule = (r: CodexRow): TeamCodexRule => ({
  id: r.id, groupId: r.group_id, role: r.role, mistakeSlug: r.mistake_slug, phase: r.phase, radarAxis: r.radar_axis,
  fundamentalId: r.fundamental_id, headline: r.headline, tacticalRule: r.tactical_rule, drillObjective: r.drill_objective,
  videoRef: r.video_ref, createdBy: r.created_by, createdAt: r.created_at,
})

export async function listTeamCodex(sb: SupabaseClient, groupIds: string[]): Promise<TeamCodexRule[]> {
  if (groupIds.length === 0) return []
  const { data, error } = await sb.from('team_codex_rules')
    .select('id, group_id, role, mistake_slug, phase, radar_axis, fundamental_id, headline, tactical_rule, drill_objective, video_ref, created_by, created_at')
    .in('group_id', groupIds).order('created_at', { ascending: false })
  if (error) fail(error, 'list codex')
  return (data as CodexRow[]).map(toRule)
}

export async function addTeamCodexRule(sb: SupabaseClient, r: TeamCodexRuleInput): Promise<void> {
  const { error } = await sb.from('team_codex_rules').insert({
    group_id: r.groupId, role: r.role, mistake_slug: r.mistakeSlug, phase: r.phase, radar_axis: r.radarAxis ?? '',
    fundamental_id: r.fundamentalId, headline: r.headline.trim(), tactical_rule: r.tacticalRule.trim(),
    drill_objective: r.drillObjective.trim(), video_ref: r.videoRef?.trim() || null,
  })
  if (error) fail(error, 'add codex rule')
}

export async function deleteTeamCodexRule(sb: SupabaseClient, id: string): Promise<void> {
  const { error } = await sb.from('team_codex_rules').delete().eq('id', id)
  if (error) fail(error, 'delete codex rule')
}

/** A team rule as a Codex entry (one language: the coach's own words, shown as-is in FR and EN). */
export function teamRuleToEntry(r: TeamCodexRule): CodexEntry {
  const same = (s: string) => ({ fr: s, en: s })
  return {
    id: `team:${r.id}`, role: r.role, mistakeSlug: r.mistakeSlug, phase: r.phase, radarAxis: r.radarAxis ?? '',
    fundamentalId: r.fundamentalId, headline: same(r.headline), tacticalRule: same(r.tacticalRule),
    drillObjective: same(r.drillObjective), videoRef: r.videoRef ?? undefined, source: 'team', groupId: r.groupId,
  }
}
