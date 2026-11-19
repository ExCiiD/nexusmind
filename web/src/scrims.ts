import { sb } from './supabase'
import * as teamCore from '@/lib/teamCore'

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
  /** NULL once the author left (account deleted, #33). */
  createdBy: string | null
  /** 'bo1' | 'bo3' | 'bo5', or null. Shown by the Discord bot (E11). */
  boFormat: string | null
  /** Links to the scouted opponent (team_scouting.id) so the Discord bot
   *  can derive real OP.GG links from that team's roster. */
  opponentScoutingId: string | null
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
  boFormat: r.bo_format ?? null, opponentScoutingId: r.opponent_scouting_id ?? null,
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
  prepNotes?: string | null; checklist?: ChecklistItem[]; boFormat?: string | null; opponentScoutingId?: string | null
}): Promise<Scrim> {
  const { data: u } = await sb.auth.getUser()
  const { data, error } = await sb.from('scrims').insert({
    group_id: s.groupId, title: s.title.trim(), opponent: s.opponent?.trim() || null, scheduled_at: s.scheduledAt,
    duration_min: s.durationMin, prep_notes: s.prepNotes || null, checklist: s.checklist ?? [], created_by: u.user?.id,
    bo_format: s.boFormat || null, opponent_scouting_id: s.opponentScoutingId || null,
  }).select('*').single()
  check(error)
  return map(data)
}

export async function updateScrim(id: string, patch: Partial<{
  title: string; opponent: string | null; scheduledAt: string; durationMin: number; status: ScrimStatus
  prepNotes: string | null; checklist: ChecklistItem[]; draftIds: string[]; reviewNotes: string | null
  boFormat: string | null; opponentScoutingId: string | null
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
  if (patch.boFormat !== undefined) row.bo_format = patch.boFormat
  if (patch.opponentScoutingId !== undefined) row.opponent_scouting_id = patch.opponentScoutingId
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

/**
 * The group's drafts (team_drafts: the Draft Sim on the web, the team published from the desktop), which a scrim
 * links (WSC-19). Every member reads them; the staff writes them (RLS by group).
 *
 * Before 19/11/2026 this read the members' personal DraftPrep rows from sync_records: that path is now staff only
 * and explicit (#43 / S19-17), and personal drafts are not the group's. Called with member ids (the old form), it
 * returns nothing: pass the group id.
 */
export async function listTeamDrafts(groupId: string | string[]): Promise<TeamDraft[]> {
  if (typeof groupId !== 'string' || !groupId) return []
  const drafts = await teamCore.listGroupDrafts(sb, groupId)
  // A slot may hold several candidate champions (Draft Sim): the scrim shows the first of each.
  const names = (v: string): string[] => (arr(v) as unknown[])
    .map((s) => (Array.isArray(s) ? s.find((x) => typeof x === 'string' && x) : s))
    .filter((s): s is string => typeof s === 'string' && s.length > 0)
  return drafts.map((d) => ({
    id: d.id, ownerId: d.userId, name: d.name || '—', myTeamSide: d.myTeamSide ?? 'blue',
    bluePicks: names(d.bluePicks), redPicks: names(d.redPicks), blueBans: names(d.blueBans), redBans: names(d.redBans),
    notes: d.notes ?? null,
  }))
}

/** #49: the Planning slot of a scrim (scrims.calendar_event_id), for the old /scrims?scrim=<id> links. Null without one. */
export async function scrimCalendarEventId(scrimId: string): Promise<string | null> {
  const { data, error } = await sb.from('scrims').select('calendar_event_id').eq('id', scrimId).maybeSingle()
  if (error) return null // before the scrims_in_planning migration (no column), or no access
  return (data as { calendar_event_id?: string | null } | null)?.calendar_event_id ?? null
}
