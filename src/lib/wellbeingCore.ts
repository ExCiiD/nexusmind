import type { SupabaseClient } from '@supabase/supabase-js'
import type { EnergyWinrateCorrelation, NewWellbeingCheckinInput, WellbeingCheckin } from './wellbeing'
import { fail } from './supabaseErrors'

/**
 * Wellbeing & load (E6), same pattern as devPlanCore.ts. Purely server-side
 * — desktop and web call these identically.
 */

interface CheckinRow { id: string; user_id: string; energy: number; mood: number; sleep: number; note: string | null; created_at: string }

const toCheckin = (r: CheckinRow): WellbeingCheckin => ({
  id: r.id, userId: r.user_id, energy: r.energy, mood: r.mood, sleep: r.sleep, note: r.note, createdAt: r.created_at,
})

export async function addCheckin(sb: SupabaseClient, input: NewWellbeingCheckinInput): Promise<void> {
  const { error } = await sb.from('wellbeing_checkins').insert({
    energy: input.energy, mood: input.mood, sleep: input.sleep, note: input.note ?? null,
  })
  if (error) fail(error, 'add check-in')
}

export async function listMine(sb: SupabaseClient, userId: string, limit = 30): Promise<WellbeingCheckin[]> {
  const { data, error } = await sb.from('wellbeing_checkins')
    .select('id, user_id, energy, mood, sleep, note, created_at')
    .eq('user_id', userId).order('created_at', { ascending: false }).limit(limit)
  if (error) fail(error, 'list check-ins')
  return (data as CheckinRow[]).map(toCheckin)
}

/** RLS-filtered: rows for players who have not opted in (`share_wellbeing`) for this group are simply absent. */
export async function listForGroup(sb: SupabaseClient, playerIds: string[], limit = 200): Promise<WellbeingCheckin[]> {
  if (playerIds.length === 0) return []
  const { data, error } = await sb.from('wellbeing_checkins')
    .select('id, user_id, energy, mood, sleep, note, created_at')
    .in('user_id', playerIds).order('created_at', { ascending: false }).limit(limit)
  if (error) fail(error, 'list group check-ins')
  return (data as CheckinRow[]).map(toCheckin)
}

// ── Weekly load threshold (E6 v2) ───────────────────────────────────────
// The combined "weekly play load > X h + declining mood" alert
// (run_weekly_load_check, pg_cron) is server-side and gated on BOTH
// share_stats AND share_wellbeing — a player with only one of the two
// consents never triggers it. X itself is a per-group staff setting.

export async function getWeeklyLoadThreshold(sb: SupabaseClient, groupId: string): Promise<number> {
  const { data, error } = await sb.from('groups').select('weekly_load_threshold_hours').eq('id', groupId).single()
  if (error) fail(error, 'get weekly load threshold')
  return data.weekly_load_threshold_hours
}

/** Narrow RPC (not a direct table update) so coach/analyst can tune this
 *  one operational setting without the general `groups` UPDATE policy
 *  (owner-only, for name/kind) being widened for them. */
export async function setWeeklyLoadThreshold(sb: SupabaseClient, groupId: string, hours: number): Promise<void> {
  const { error } = await sb.rpc('set_weekly_load_threshold', { p_group: groupId, p_hours: hours })
  if (error) fail(error, 'set weekly load threshold')
}

// ── pure helpers (no I/O) ───────────────────────────────────────────────

/** True when the daily-average mood has strictly declined for the last 3 days that have a check-in. */
export function computeMoodDeclineAlert(checkins: WellbeingCheckin[]): boolean {
  const byDay = new Map<string, number[]>()
  for (const c of checkins) {
    const day = c.createdAt.slice(0, 10)
    const arr = byDay.get(day) ?? []
    arr.push(c.mood)
    byDay.set(day, arr)
  }
  const days = [...byDay.entries()]
    .map(([day, moods]) => ({ day, avg: moods.reduce((a, b) => a + b, 0) / moods.length }))
    .sort((a, b) => a.day.localeCompare(b.day))
  if (days.length < 3) return false
  const [d1, d2, d3] = days.slice(-3)
  return d1.avg > d2.avg && d2.avg > d3.avg
}

/** Win rate on days where the player's average logged energy was low (<=2) vs. every other day with a game. */
export function computeEnergyWinrateCorrelation(
  checkins: WellbeingCheckin[],
  games: Array<{ win: boolean; gameEndAt: number | string | null }>,
): EnergyWinrateCorrelation {
  const energyByDay = new Map<string, number[]>()
  for (const c of checkins) {
    const day = c.createdAt.slice(0, 10)
    const arr = energyByDay.get(day) ?? []
    arr.push(c.energy)
    energyByDay.set(day, arr)
  }

  let lowWins = 0, lowTotal = 0, otherWins = 0, otherTotal = 0
  for (const g of games) {
    if (g.gameEndAt == null) continue
    const day = new Date(g.gameEndAt).toISOString().slice(0, 10)
    const energies = energyByDay.get(day)
    if (!energies || energies.length === 0) continue
    const avgEnergy = energies.reduce((a, b) => a + b, 0) / energies.length
    if (avgEnergy <= 2) { lowTotal++; if (g.win) lowWins++ } else { otherTotal++; if (g.win) otherWins++ }
  }

  return {
    lowEnergyGames: lowTotal, lowEnergyWinrate: lowTotal > 0 ? Math.round((lowWins / lowTotal) * 100) : null,
    otherGames: otherTotal, otherWinrate: otherTotal > 0 ? Math.round((otherWins / otherTotal) * 100) : null,
  }
}
