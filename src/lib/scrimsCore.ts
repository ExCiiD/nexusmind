import type { SupabaseClient } from '@supabase/supabase-js'
import type { ScrimSummary } from './scrims'
import { fail } from './supabaseErrors'

/** Read-only: any group member can see scheduled scrims (RLS already allows this — see W4's migration). */
export async function listScrimsForGroup(sb: SupabaseClient, groupId: string): Promise<ScrimSummary[]> {
  const { data, error } = await sb.from('scrims')
    .select('id, title, opponent, scheduled_at, duration_min, bo_format, opponent_scouting_id')
    .eq('group_id', groupId).order('scheduled_at', { ascending: false }).limit(100)
  if (error) fail(error, 'list scrims')
  return (data as Array<{ id: string; title: string; opponent: string | null; scheduled_at: string; duration_min: number; bo_format: string | null; opponent_scouting_id: string | null }>)
    .map((r) => ({
      id: r.id, title: r.title, opponent: r.opponent, scheduledAt: r.scheduled_at, durationMin: r.duration_min,
      boFormat: r.bo_format, opponentScoutingId: r.opponent_scouting_id,
    }))
}
