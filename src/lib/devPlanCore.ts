import type { SupabaseClient } from '@supabase/supabase-js'
import type { AxisStatus, DevPlan, DevPlanAxis, DevPlanCheckin, NewAxisInput, NewDevPlanPeriod } from './devPlan'

/**
 * Individual development plans (E3), same pattern as teamCore.ts/
 * notificationsCore.ts. Purely server-side — no local Prisma data, so
 * desktop and web call these identically.
 */

function fail(error: { message: string; code?: string } | null, fallback: string): never {
  const msg = error?.message ?? fallback
  if (/permission|forbidden/i.test(msg) || error?.code === '42501') throw new Error('FORBIDDEN')
  throw new Error(msg)
}

interface PlanRow { id: string; group_id: string; player_id: string; title: string; period_start: string | null; period_end: string | null; created_at: string; updated_at: string }
interface AxisRow { id: string; plan_id: string; fundamental_id: string; target_text: string; position: 1 | 2 | 3; status: AxisStatus; created_at: string; updated_at: string }
interface ProgressRow { axis_id: string; player_marked_done: boolean; player_note: string | null; updated_at: string }
interface CheckinRow { id: string; plan_id: string; note: string; created_by: string; created_at: string }

async function hydrate(sb: SupabaseClient, plan: PlanRow): Promise<DevPlan> {
  const [axesRes, progressRes, checkinsRes] = await Promise.all([
    sb.from('dev_plan_axes').select('id, plan_id, fundamental_id, target_text, position, status, created_at, updated_at')
      .eq('plan_id', plan.id).order('position'),
    sb.from('dev_plan_progress').select('axis_id, player_marked_done, player_note, updated_at'),
    sb.from('dev_plan_checkins').select('id, plan_id, note, created_by, created_at')
      .eq('plan_id', plan.id).order('created_at', { ascending: false }),
  ])
  if (axesRes.error) fail(axesRes.error, 'axes')
  if (progressRes.error) fail(progressRes.error, 'progress')
  if (checkinsRes.error) fail(checkinsRes.error, 'checkins')

  const axisRows = axesRes.data as AxisRow[]
  const axisIds = new Set(axisRows.map((a) => a.id))
  const progressByAxis = new Map<string, ProgressRow>()
  for (const row of progressRes.data as ProgressRow[]) {
    if (axisIds.has(row.axis_id)) progressByAxis.set(row.axis_id, row)
  }

  const axes: DevPlanAxis[] = axisRows.map((a) => {
    const p = progressByAxis.get(a.id)
    return {
      id: a.id, planId: a.plan_id, fundamentalId: a.fundamental_id, targetText: a.target_text,
      position: a.position, status: a.status,
      progress: p ? { playerMarkedDone: p.player_marked_done, playerNote: p.player_note, updatedAt: p.updated_at } : null,
      createdAt: a.created_at, updatedAt: a.updated_at,
    }
  })
  const checkins: DevPlanCheckin[] = (checkinsRes.data as CheckinRow[]).map((c) => ({
    id: c.id, planId: c.plan_id, note: c.note, createdBy: c.created_by, createdAt: c.created_at,
  }))

  return {
    id: plan.id, groupId: plan.group_id, playerId: plan.player_id, title: plan.title,
    periodStart: plan.period_start, periodEnd: plan.period_end, axes, checkins,
    createdAt: plan.created_at, updatedAt: plan.updated_at,
  }
}

async function getPlan(sb: SupabaseClient, groupId: string, playerId: string): Promise<DevPlan | null> {
  const { data, error } = await sb.from('dev_plans')
    .select('id, group_id, player_id, title, period_start, period_end, created_at, updated_at')
    .eq('group_id', groupId).eq('player_id', playerId)
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (error) fail(error, 'load plan')
  if (!data) return null
  return hydrate(sb, data as PlanRow)
}

export const getMyDevPlan = (sb: SupabaseClient, groupId: string, myUserId: string) => getPlan(sb, groupId, myUserId)
export const getDevPlanForPlayer = getPlan

export async function createDevPlan(
  sb: SupabaseClient, groupId: string, playerId: string, title: string, axes: NewAxisInput[], period?: NewDevPlanPeriod,
): Promise<string> {
  const { data: plan, error } = await sb.from('dev_plans')
    .insert({ group_id: groupId, player_id: playerId, title, period_start: period?.periodStart ?? null, period_end: period?.periodEnd ?? null })
    .select('id').single()
  if (error) fail(error, 'create plan')
  if (axes.length > 0) {
    const { error: axesErr } = await sb.from('dev_plan_axes').insert(
      axes.map((a) => ({ plan_id: plan.id, fundamental_id: a.fundamentalId, target_text: a.targetText, position: a.position })),
    )
    if (axesErr) fail(axesErr, 'create axes')
  }
  return plan.id
}

export async function setAxisStatus(sb: SupabaseClient, axisId: string, status: AxisStatus): Promise<void> {
  const { error } = await sb.from('dev_plan_axes').update({ status }).eq('id', axisId)
  if (error) fail(error, 'set axis status')
}

export async function addCheckin(sb: SupabaseClient, planId: string, note: string): Promise<void> {
  const { error } = await sb.from('dev_plan_checkins').insert({ plan_id: planId, note })
  if (error) fail(error, 'add check-in')
}

export async function setProgress(sb: SupabaseClient, axisId: string, input: { playerMarkedDone?: boolean; playerNote?: string | null }): Promise<void> {
  const patch: Record<string, unknown> = { axis_id: axisId }
  if (input.playerMarkedDone !== undefined) patch.player_marked_done = input.playerMarkedDone
  if (input.playerNote !== undefined) patch.player_note = input.playerNote
  const { error } = await sb.from('dev_plan_progress').upsert(patch, { onConflict: 'axis_id' })
  if (error) fail(error, 'set progress')
}
