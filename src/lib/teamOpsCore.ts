import type { SupabaseClient } from '@supabase/supabase-js'
import type { Announcement, NewAnnouncementInput, NewTaskInput, StaffNote, Task, TaskStatus } from './teamOps'

/**
 * Communication & tasks (E7), same pattern as devPlanCore.ts. Purely
 * server-side — desktop and web call these identically.
 */

function fail(error: { message: string; code?: string } | null, fallback: string): never {
  const msg = error?.message ?? fallback
  if (/permission|forbidden/i.test(msg) || error?.code === '42501') throw new Error('FORBIDDEN')
  throw new Error(msg)
}

interface AnnouncementRow { id: string; group_id: string; title: string; body: string; pinned: boolean; created_by: string; created_at: string; updated_at: string }
interface TaskRow { id: string; group_id: string; title: string; assignee_id: string | null; due_date: string | null; status: TaskStatus; created_by: string; created_at: string; updated_at: string }
interface StaffNoteRow { id: string; group_id: string; player_id: string; body: string; created_by: string; created_at: string; updated_at: string }

const toAnnouncement = (r: AnnouncementRow): Announcement => ({
  id: r.id, groupId: r.group_id, title: r.title, body: r.body, pinned: r.pinned,
  createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at,
})
const toTask = (r: TaskRow): Task => ({
  id: r.id, groupId: r.group_id, title: r.title, assigneeId: r.assignee_id, dueDate: r.due_date, status: r.status,
  createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at,
})
const toStaffNote = (r: StaffNoteRow): StaffNote => ({
  id: r.id, groupId: r.group_id, playerId: r.player_id, body: r.body,
  createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at,
})

export async function listAnnouncements(sb: SupabaseClient, groupId: string): Promise<Announcement[]> {
  const { data, error } = await sb.from('announcements')
    .select('id, group_id, title, body, pinned, created_by, created_at, updated_at')
    .eq('group_id', groupId).order('pinned', { ascending: false }).order('created_at', { ascending: false })
  if (error) fail(error, 'list announcements')
  return (data as AnnouncementRow[]).map(toAnnouncement)
}

export async function createAnnouncement(sb: SupabaseClient, groupId: string, input: NewAnnouncementInput): Promise<string> {
  const { data, error } = await sb.from('announcements').insert({
    group_id: groupId, title: input.title, body: input.body, pinned: input.pinned ?? false,
  }).select('id').single()
  if (error) fail(error, 'create announcement')
  return data.id
}

export async function setAnnouncementPinned(sb: SupabaseClient, id: string, pinned: boolean): Promise<void> {
  const { error } = await sb.from('announcements').update({ pinned }).eq('id', id)
  if (error) fail(error, 'set pinned')
}

export async function deleteAnnouncement(sb: SupabaseClient, id: string): Promise<void> {
  const { error } = await sb.from('announcements').delete().eq('id', id)
  if (error) fail(error, 'delete announcement')
}

export async function listTasks(sb: SupabaseClient, groupId: string): Promise<Task[]> {
  const { data, error } = await sb.from('tasks')
    .select('id, group_id, title, assignee_id, due_date, status, created_by, created_at, updated_at')
    .eq('group_id', groupId).order('status').order('due_date', { ascending: true, nullsFirst: false })
  if (error) fail(error, 'list tasks')
  return (data as TaskRow[]).map(toTask)
}

export async function createTask(sb: SupabaseClient, groupId: string, input: NewTaskInput): Promise<string> {
  const { data, error } = await sb.from('tasks').insert({
    group_id: groupId, title: input.title, assignee_id: input.assigneeId ?? null, due_date: input.dueDate ?? null,
  }).select('id').single()
  if (error) fail(error, 'create task')
  return data.id
}

export async function setTaskStatus(sb: SupabaseClient, id: string, status: TaskStatus): Promise<void> {
  const { error } = await sb.from('tasks').update({ status }).eq('id', id)
  if (error) fail(error, 'set task status')
}

export async function deleteTask(sb: SupabaseClient, id: string): Promise<void> {
  const { error } = await sb.from('tasks').delete().eq('id', id)
  if (error) fail(error, 'delete task')
}

export async function listStaffNotes(sb: SupabaseClient, groupId: string, playerId: string): Promise<StaffNote[]> {
  const { data, error } = await sb.from('staff_notes')
    .select('id, group_id, player_id, body, created_by, created_at, updated_at')
    .eq('group_id', groupId).eq('player_id', playerId).order('created_at', { ascending: false })
  if (error) fail(error, 'list staff notes')
  return (data as StaffNoteRow[]).map(toStaffNote)
}

export async function addStaffNote(sb: SupabaseClient, groupId: string, playerId: string, body: string): Promise<void> {
  const { error } = await sb.from('staff_notes').insert({ group_id: groupId, player_id: playerId, body })
  if (error) fail(error, 'add staff note')
}

export async function deleteStaffNote(sb: SupabaseClient, id: string): Promise<void> {
  const { error } = await sb.from('staff_notes').delete().eq('id', id)
  if (error) fail(error, 'delete staff note')
}
