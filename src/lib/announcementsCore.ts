import type { SupabaseClient } from '@supabase/supabase-js'
import type { Announcement, AnnouncementDismissal, NewAnnouncementInput } from './announcements'

/**
 * Announcements (E7, moved into Planning's permission model — Phase 2 of
 * docs/PLAN_GESTION_EQUIPE.md §9). Same pattern as calendarCore.ts. Purely
 * server-side — desktop and web call these identically.
 */

function fail(error: { message: string; code?: string } | null, fallback: string): never {
  const msg = error?.message ?? fallback
  if (/permission|forbidden/i.test(msg) || error?.code === '42501') throw new Error('FORBIDDEN')
  throw new Error(msg)
}

interface AnnouncementRow { id: string; group_id: string; title: string; body: string; pinned: boolean; created_by: string; created_at: string; updated_at: string }
interface DismissalRow { announcement_id: string; user_id: string; dismissed_at: string }

const toAnnouncement = (r: AnnouncementRow): Announcement => ({
  id: r.id, groupId: r.group_id, title: r.title, body: r.body, pinned: r.pinned,
  createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at,
})
const toDismissal = (r: DismissalRow): AnnouncementDismissal => ({
  announcementId: r.announcement_id, userId: r.user_id, dismissedAt: r.dismissed_at,
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

/** Every dismissal the caller has ever recorded (RLS already scopes this to
 *  `user_id = auth.uid()`) — read once, not per group, since the bubble
 *  stack needs to cross-reference it against announcements from every
 *  group the user is in. */
export async function listMyDismissals(sb: SupabaseClient): Promise<AnnouncementDismissal[]> {
  const { data, error } = await sb.from('announcement_dismissals').select('announcement_id, user_id, dismissed_at')
  if (error) fail(error, 'list dismissals')
  return (data as DismissalRow[]).map(toDismissal)
}

export async function dismissAnnouncement(sb: SupabaseClient, announcementId: string): Promise<void> {
  const { data: userData, error: userErr } = await sb.auth.getUser()
  if (userErr || !userData.user) fail(userErr, 'dismiss announcement')
  const { error } = await sb.from('announcement_dismissals').upsert({ announcement_id: announcementId, user_id: userData.user.id })
  if (error) fail(error, 'dismiss announcement')
}

// ── pure helper (no I/O) ────────────────────────────────────────────────

/** The announcements a user hasn't explicitly closed yet, across every
 *  group — this is exactly what AnnouncementBubbleStack renders. Newest
 *  first, pinned ones leading, same ordering `listAnnouncements` already
 *  returns per group. */
export function undismissedFor(announcements: Announcement[], dismissals: AnnouncementDismissal[], userId: string): Announcement[] {
  const dismissed = new Set(dismissals.filter((d) => d.userId === userId).map((d) => d.announcementId))
  return announcements.filter((a) => !dismissed.has(a.id))
}
