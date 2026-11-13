import type { SupabaseClient } from '@supabase/supabase-js'
import type { EnergyWinrateCorrelation, NewWellbeingCheckinInput, WellbeingCheckin } from './wellbeing'

/**
 * Wellbeing & load (E6), same pattern as devPlanCore.ts. Purely server-side
 * — desktop and web call these identically.
 */

function fail(error: { message: string; code?: string } | null, fallback: string): never {
  const msg = error?.message ?? fallback
  if (/permission|forbidden/i.test(msg) || error?.code === '42501') throw new Error('FORBIDDEN')
  throw new Error(msg)
}

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
