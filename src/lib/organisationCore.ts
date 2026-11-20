import type { SupabaseClient } from '@supabase/supabase-js'
import type { EventReminder, PublishedDossier, RemindResult } from './organisation'
import { opponentKeyOf } from './analyst'
import { ourWinOf } from './teamSessionHistoryCore'
import { fail } from './supabaseErrors'

/** § 18 (contract docs/contracts/organisation.md): "Relancer" and the published dossiers. */

const isMissing = (e: { code?: string } | null) => e?.code === '42P01' || e?.code === 'PGRST205' || e?.code === 'PGRST202' || e?.code === '42883'

export async function remindEventResponses(sb: SupabaseClient, eventId: string, userIds?: string[]): Promise<RemindResult> {
  const { data, error } = await sb.rpc('remind_event_responses', { p_event: eventId, p_user_ids: userIds?.length ? userIds : null })
  if (error) {
    if (isMissing(error)) throw new Error('NOT_AVAILABLE')
    for (const code of ['FORBIDDEN', 'NOT_FOUND', 'EVENT_PAST']) if (error.message?.includes(code)) throw new Error(code)
    if (error.code === '42501') throw new Error('FORBIDDEN')
    fail(error, 'remind')
  }
  const r = (data ?? {}) as { reminded?: string[]; skipped?: Array<{ userId: string; nextAt: string }> }
  return { reminded: r.reminded ?? [], skipped: r.skipped ?? [] }
}

export async function listEventReminders(sb: SupabaseClient, eventIds: string[]): Promise<EventReminder[]> {
  const ids = [...new Set(eventIds)].slice(0, 200)
  if (ids.length === 0) return []
  const { data, error } = await sb.from('event_response_reminders').select('event_id, user_id, sent_by, sent_at').in('event_id', ids)
  if (isMissing(error)) return []
  if (error) fail(error, 'reminders')
  return (data ?? []).map((r: any) => ({ eventId: r.event_id, userId: r.user_id, sentBy: r.sent_by ?? null, sentAt: r.sent_at }))
}

export async function listPublishedDossiers(sb: SupabaseClient, groupId: string): Promise<PublishedDossier[]> {
  const { data: dossiers, error } = await sb.from('opponent_dossiers')
    .select('opponent_key, opponent_name, published_at, updated_by').eq('group_id', groupId).eq('status', 'published')
    .order('published_at', { ascending: false })
  if (error) fail(error, 'dossiers')
  const rows = (dossiers ?? []) as Array<{ opponent_key: string; opponent_name: string; published_at: string; updated_by: string | null }>
  if (rows.length === 0) return []
  const authors = [...new Set(rows.map((r) => r.updated_by).filter((x): x is string => !!x))]
  const [scouting, members, sessions] = await Promise.all([
    sb.from('team_scouting').select('opponent_key, tag').eq('group_id', groupId).in('opponent_key', rows.map((r) => r.opponent_key)),
    authors.length ? sb.from('group_members').select('user_id, display_name').eq('group_id', groupId).in('user_id', authors) : Promise.resolve({ data: [], error: null }),
    sb.from('team_sessions').select('id').eq('group_id', groupId),
  ])
  for (const r of [scouting, members, sessions]) if (r.error) fail(r.error, 'dossiers')
  const sessionIds = (sessions.data ?? []).map((s: any) => s.id as string)
  const { data: games, error: gErr } = sessionIds.length
    ? await sb.from('team_session_games').select('enemy_team_name, our_team_id, teams:match_json->info->teams').in('session_id', sessionIds).not('enemy_team_name', 'is', null)
    : { data: [] as any[], error: null }
  if (gErr) fail(gErr, 'games')
  const record = new Map<string, { wins: number; losses: number }>()
  for (const g of games ?? []) {
    const key = opponentKeyOf(String((g as any).enemy_team_name ?? ''))
    const win = ourWinOf((g as any).teams, (g as any).our_team_id)
    if (!key || win === null) continue
    const r = record.get(key) ?? { wins: 0, losses: 0 }
    if (win) r.wins++; else r.losses++
    record.set(key, r)
  }
  const tagOf = new Map((scouting.data ?? []).map((s: any) => [s.opponent_key as string, (s.tag ?? null) as string | null]))
  const nameOf = new Map((members.data ?? []).map((m: any) => [m.user_id as string, (m.display_name ?? null) as string | null]))
  return rows.map((r) => ({
    opponentKey: r.opponent_key, name: r.opponent_name, tag: tagOf.get(r.opponent_key) ?? null, publishedAt: r.published_at,
    publishedBy: r.updated_by, publishedByName: r.updated_by ? nameOf.get(r.updated_by) ?? null : null,
    record: record.get(r.opponent_key) ?? { wins: 0, losses: 0 },
  }))
}
