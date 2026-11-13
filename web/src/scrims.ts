import { sb } from './supabase'

export type ScrimStatus = 'planned' | 'done' | 'cancelled'
export type Availability = 'yes' | 'maybe' | 'no'

export interface ChecklistItem { label: string; done: boolean }

export interface Scrim {
  id: string
  groupId: string
  title: string
  opponent: string | null
  scheduledAt: string
  durationMin: number
  status: ScrimStatus
  prepNotes: string | null
  checklist: ChecklistItem[]
  draftIds: string[]
  reviewNotes: string | null
  createdBy: string
}

export interface AvailabilityRow { scrimId: string; userId: string; status: Availability; comment: string | null }

export interface TeamDraft {
  id: string
  ownerId: string
  name: string
  myTeamSide: string
  bluePicks: string[]
  redPicks: string[]
  blueBans: string[]
  redBans: string[]
  notes: string | null
}

const map = (r: any): Scrim => ({
  id: r.id, groupId: r.group_id, title: r.title, opponent: r.opponent, scheduledAt: r.scheduled_at,
  durationMin: r.duration_min, status: r.status, prepNotes: r.prep_notes, checklist: r.checklist ?? [],
  draftIds: r.draft_ids ?? [], reviewNotes: r.review_notes, createdBy: r.created_by,
})

function check(error: { message: string; code?: string } | null): void {
  if (!error) return
  if (error.code === '42501' || /row-level security/i.test(error.message)) throw new Error('FORBIDDEN')
  throw new Error(error.message)
}

export async function listScrims(groupIds: string[]): Promise<Scrim[]> {
  if (groupIds.length === 0) return []
  const { data, error } = await sb.from('scrims').select('*').in('group_id', groupIds).order('scheduled_at', { ascending: true })
  check(error)
  return (data ?? []).map(map)
}

export async function createScrim(s: {
  groupId: string; title: string; opponent?: string | null; scheduledAt: string; durationMin: number
  prepNotes?: string | null; checklist?: ChecklistItem[]
}): Promise<Scrim> {
  const { data: u } = await sb.auth.getUser()
  const { data, error } = await sb.from('scrims').insert({
    group_id: s.groupId, title: s.title.trim(), opponent: s.opponent?.trim() || null, scheduled_at: s.scheduledAt,
    duration_min: s.durationMin, prep_notes: s.prepNotes || null, checklist: s.checklist ?? [], created_by: u.user?.id,
  }).select('*').single()
  check(error)
  return map(data)
}

export async function updateScrim(id: string, patch: Partial<{
  title: string; opponent: string | null; scheduledAt: string; durationMin: number; status: ScrimStatus
  prepNotes: string | null; checklist: ChecklistItem[]; draftIds: string[]; reviewNotes: string | null
}>): Promise<void> {
  const row: Record<string, unknown> = {}
  if (patch.title !== undefined) row.title = patch.title
  if (patch.opponent !== undefined) row.opponent = patch.opponent
  if (patch.scheduledAt !== undefined) row.scheduled_at = patch.scheduledAt
  if (patch.durationMin !== undefined) row.duration_min = patch.durationMin
  if (patch.status !== undefined) row.status = patch.status
  if (patch.prepNotes !== undefined) row.prep_notes = patch.prepNotes
  if (patch.checklist !== undefined) row.checklist = patch.checklist
  if (patch.draftIds !== undefined) row.draft_ids = patch.draftIds
  if (patch.reviewNotes !== undefined) row.review_notes = patch.reviewNotes
  const { error } = await sb.from('scrims').update(row).eq('id', id)
  check(error)
}

export async function deleteScrim(id: string): Promise<void> {
  const { error } = await sb.from('scrims').delete().eq('id', id)
  check(error)
}

export async function listAvailability(scrimIds: string[]): Promise<AvailabilityRow[]> {
  if (scrimIds.length === 0) return []
  const { data, error } = await sb.from('scrim_availability').select('*').in('scrim_id', scrimIds)
  check(error)
  return (data ?? []).map((r: any) => ({ scrimId: r.scrim_id, userId: r.user_id, status: r.status, comment: r.comment }))
}

export async function setAvailability(scrimId: string, userId: string, status: Availability, comment: string | null): Promise<void> {
  const { error } = await sb.from('scrim_availability').upsert({ scrim_id: scrimId, user_id: userId, status, comment })
  check(error)
}

const arr = (v: unknown): string[] => {
  if (Array.isArray(v)) return v as string[]
  try { const p = JSON.parse(String(v ?? '[]')); return Array.isArray(p) ? p : [] } catch { return [] }
}

/** Drafts prepared by members of the group who share team data (RLS-filtered). */
export async function listTeamDrafts(memberIds: string[]): Promise<TeamDraft[]> {
  if (memberIds.length === 0) return []
  const { data, error } = await sb.from('sync_records')
    .select('user_id, record_id, data')
    .eq('table_name', 'DraftPrep').eq('deleted', false).in('user_id', memberIds).limit(200)
  check(error)
  return (data ?? []).map((r: any) => ({
    id: r.record_id, ownerId: r.user_id, name: r.data?.name ?? '—', myTeamSide: r.data?.myTeamSide ?? 'blue',
    bluePicks: arr(r.data?.bluePicks), redPicks: arr(r.data?.redPicks), blueBans: arr(r.data?.blueBans), redBans: arr(r.data?.redBans),
    notes: r.data?.notes ?? null,
  }))
}
