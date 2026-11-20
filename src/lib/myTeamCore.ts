import type { SupabaseClient } from '@supabase/supabase-js'
import type { MyNextEvent, MySessionObjectives, MyTask, MyVodActionItem } from './myTeam'
import { meetingConcerned, type MeetingMember } from './teamSessionHistoryCore'
import { prepReadyForEvents } from './sessionPrepCore'
import { fail } from './supabaseErrors'

/** The liaisons L2-L6 of docs/AUDIT_LIAISONS.md: what my groups give me, across all of them. Contract: myTeam.ts. */

const isMissingRelation = (e: { code?: string } | null) => e?.code === '42P01' || e?.code === 'PGRST205'
/** Event kinds that are not something to show up for. */
const NOT_AN_APPOINTMENT = new Set(['rest'])

interface Membership { groupId: string; role: string; staffRoles: string[]; alsoPlays: boolean }

async function myMemberships(sb: SupabaseClient, uid: string): Promise<Membership[]> {
  const { data, error } = await sb.from('group_members').select('group_id, role, staff_roles, also_plays').eq('user_id', uid)
  if (error) fail(error, 'memberships')
  return (data ?? []).map((m: any) => ({ groupId: m.group_id, role: m.role, staffRoles: m.staff_roles ?? [], alsoPlays: !!m.also_plays }))
}

async function groupNames(sb: SupabaseClient, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map()
  const { data } = await sb.from('groups').select('id, name').in('id', ids)
  return new Map((data ?? []).map((g: any) => [g.id as string, g.name as string]))
}

/** Whether an event concerns me: its scope (whole team, players, staff) or its invitees. */
export function eventConcerns(scope: string | null | undefined, me: Membership & { userId: string }, invitees: string[]): boolean {
  const member: MeetingMember = { userId: me.userId, role: me.role, staffRoles: me.staffRoles, alsoPlays: me.alsoPlays }
  return meetingConcerned(scope, [member], invitees).length === 1
}

export async function getMyNextEvent(sb: SupabaseClient, uid: string, now = Date.now()): Promise<MyNextEvent | null> {
  const memberships = await myMemberships(sb, uid)
  if (memberships.length === 0) return null
  const { data: events, error } = await sb.from('calendar_events')
    .select('id, group_id, kind, title, starts_at, ends_at, attendee_scope')
    .in('group_id', memberships.map((m) => m.groupId))
    .gt('ends_at', new Date(now).toISOString())
    .order('starts_at').limit(50)
  if (error) fail(error, 'events')
  const candidates = (events ?? []).filter((e: any) => !NOT_AN_APPOINTMENT.has(e.kind))
  if (candidates.length === 0) return null
  const { data: invited, error: iErr } = await sb.from('calendar_event_attendees').select('event_id').eq('user_id', uid).in('event_id', candidates.map((e: any) => e.id))
  if (iErr) fail(iErr, 'attendees')
  const invitedTo = new Set((invited ?? []).map((a: any) => a.event_id as string))
  const next = candidates.find((e: any) => {
    const m = memberships.find((x) => x.groupId === e.group_id)!
    return eventConcerns(e.attendee_scope, { ...m, userId: uid }, invitedTo.has(e.id) ? [uid] : [])
  }) as any
  if (!next) return null
  const [response, session, names, ready] = await Promise.all([
    sb.from('calendar_event_responses').select('status').eq('event_id', next.id).eq('user_id', uid).maybeSingle(),
    sb.from('team_sessions').select('id').eq('calendar_event_id', next.id).maybeSingle(),
    groupNames(sb, [next.group_id]),
    prepReadyForEvents(sb, [next.id]),
  ])
  const status = (response.data as { status?: string } | null)?.status
  return {
    eventId: next.id, groupId: next.group_id, groupName: names.get(next.group_id) ?? null, kind: next.kind, title: next.title,
    startsAt: next.starts_at, endsAt: next.ends_at,
    myResponse: status === 'confirmed' || status === 'declined' ? status : null,
    sessionId: (session.data as { id?: string } | null)?.id ?? null,
    prepReady: ready.includes(next.id),
  }
}

export async function listMyOpenTasks(sb: SupabaseClient, uid: string, now = Date.now()): Promise<MyTask[]> {
  const { data, error } = await sb.from('tasks').select('id, group_id, title, due_date, status').eq('assignee_id', uid).eq('status', 'open')
  if (error) fail(error, 'tasks')
  const rows = (data ?? []) as Array<{ id: string; group_id: string; title: string; due_date: string | null }>
  const names = await groupNames(sb, [...new Set(rows.map((r) => r.group_id))])
  const today = new Date(now).toISOString().slice(0, 10)
  return rows
    .map((r) => ({ id: r.id, groupId: r.group_id, groupName: names.get(r.group_id) ?? null, title: r.title, dueDate: r.due_date, overdue: !!r.due_date && r.due_date < today }))
    .sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'))
}

export async function listMySessionObjectives(sb: SupabaseClient, uid: string): Promise<MySessionObjectives[]> {
  const { data, error } = await sb.from('team_session_player_objectives').select('session_id, objective_ids, kpi_ids, note').eq('player_id', uid)
  if (isMissingRelation(error)) return [] // before migration 20261120110520
  if (error) fail(error, 'my session objectives')
  const rows = (data ?? []) as Array<{ session_id: string; objective_ids: string[]; kpi_ids: string[]; note: string | null }>
  if (rows.length === 0) return []
  const { data: sessions, error: sErr } = await sb.from('team_sessions').select('id, group_id, calendar_event_id, status').in('id', rows.map((r) => r.session_id)).neq('status', 'ended')
  if (sErr) fail(sErr, 'sessions')
  const open = (sessions ?? []) as Array<{ id: string; group_id: string; calendar_event_id: string | null; status: 'scheduled' | 'live' }>
  const eventIds = open.map((s) => s.calendar_event_id).filter((id): id is string => !!id)
  const { data: events } = eventIds.length ? await sb.from('calendar_events').select('id, title, starts_at').in('id', eventIds) : { data: [] as any[] }
  const eventById = new Map((events ?? []).map((e: any) => [e.id as string, e]))
  return open.map((s) => {
    const r = rows.find((x) => x.session_id === s.id)!
    const e = s.calendar_event_id ? eventById.get(s.calendar_event_id) : undefined
    return {
      sessionId: s.id, calendarEventId: s.calendar_event_id, groupId: s.group_id, title: e?.title ?? '', startsAt: e?.starts_at ?? null,
      status: s.status, objectiveIds: r.objective_ids ?? [], kpiIds: r.kpi_ids ?? [], note: r.note ?? null,
    }
  }).sort((a, b) => (a.startsAt ?? '').localeCompare(b.startsAt ?? ''))
}

export async function listMyVodActionItems(sb: SupabaseClient, uid: string, all = false): Promise<MyVodActionItem[]> {
  const { data: assigned, error } = await sb.from('vod_review_assignments').select('session_id').eq('player_id', uid)
  if (error) fail(error, 'vod assignments')
  const sessionIds = [...new Set((assigned ?? []).map((a: any) => a.session_id as string))]
  if (sessionIds.length === 0) return []
  const [sessions, items] = await Promise.all([
    sb.from('vod_review_sessions').select('id, group_id, title').in('id', sessionIds),
    sb.from('vod_review_action_items').select('id, session_id, text, done, created_at').in('session_id', sessionIds).order('created_at'),
  ])
  for (const r of [sessions, items]) if (r.error) fail(r.error, 'vod actions')
  const sessionById = new Map((sessions.data ?? []).map((s: any) => [s.id as string, s]))
  return (items.data ?? [])
    .filter((i: any) => all || !i.done)
    .flatMap((i: any) => {
      const s = sessionById.get(i.session_id) as any
      return s ? [{ id: i.id, vodSessionId: i.session_id, groupId: s.group_id, vodTitle: s.title, text: i.text, done: !!i.done, createdAt: i.created_at }] : []
    })
}
