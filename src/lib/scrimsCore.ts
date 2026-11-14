import type { SupabaseClient } from '@supabase/supabase-js'
import type { ScrimSummary } from './scrims'

function fail(error: { message: string; code?: string } | null, fallback: string): never {
  const msg = error?.message ?? fallback
  if (/permission|forbidden/i.test(msg) || error?.code === '42501') throw new Error('FORBIDDEN')
  throw new Error(msg)
}

/** Read-only: any group member can see scheduled scrims (RLS already allows this — see W4's migration). */
export async function listScrimsForGroup(sb: SupabaseClient, groupId: string): Promise<ScrimSummary[]> {
  const { data, error } = await sb.from('scrims')
    .select('id, title, opponent, scheduled_at, duration_min')
    .eq('group_id', groupId).order('scheduled_at', { ascending: false }).limit(100)
  if (error) fail(error, 'list scrims')
  return (data as Array<{ id: string; title: string; opponent: string | null; scheduled_at: string; duration_min: number }>)
    .map((r) => ({ id: r.id, title: r.title, opponent: r.opponent, scheduledAt: r.scheduled_at, durationMin: r.duration_min }))
}
