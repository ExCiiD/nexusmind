import type { SupabaseClient } from '@supabase/supabase-js'
import type { ScrimSummary } from './scrims'
import { fail } from './supabaseErrors'

type ScrimRow = {
  id: string; title: string; opponent: string | null; scheduled_at: string; duration_min: number; bo_format: string | null
  opponent_scouting_id: string | null; calendar_event_id?: string | null; kind?: 'scrim' | 'official' | null; opponent_key?: string | null
}

const BASE = 'id, title, opponent, scheduled_at, duration_min, bo_format, opponent_scouting_id'
/** #49 (scrims_in_planning): the slot, official or not, the opponent's key. Missing before that migration. */
const PLANNING = ', calendar_event_id, kind, opponent_key'

/** Read-only: any group member can see scheduled scrims (RLS already allows this — see W4's migration). */
export async function listScrimsForGroup(sb: SupabaseClient, groupId: string): Promise<ScrimSummary[]> {
  // The select is built at run time, so the typed client cannot read its columns: the row type is ScrimRow.
  const read = (cols: string) => sb.from('scrims').select(cols).eq('group_id', groupId).order('scheduled_at', { ascending: false }).limit(100) as unknown as
    PromiseLike<{ data: ScrimRow[] | null; error: { message: string; code?: string } | null }>
  let res = await read(BASE + PLANNING)
  if (res.error?.code === '42703') res = await read(BASE)
  if (res.error) fail(res.error, 'list scrims')
  return (res.data ?? []).map((r) => ({
    id: r.id, title: r.title, opponent: r.opponent, scheduledAt: r.scheduled_at, durationMin: r.duration_min,
    boFormat: r.bo_format, opponentScoutingId: r.opponent_scouting_id,
    calendarEventId: r.calendar_event_id ?? null, kind: r.kind ?? 'scrim', opponentKey: r.opponent_key ?? null,
  }))
}

/** "Scrim vs KCA (BO3)" / "Official vs KCA": how the bot names a match. */
export function describeMatch(m: { kind?: 'scrim' | 'official' | null; opponent?: string | null; opponentName?: string | null; boFormat?: string | null }): string {
  const name = m.opponent ?? m.opponentName ?? null
  return `${m.kind === 'official' ? 'Official' : 'Scrim'}${name ? ` vs ${name}` : ''}${m.boFormat ? ` (${m.boFormat.toUpperCase()})` : ''}`
}
