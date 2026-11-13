import type { SupabaseClient } from '@supabase/supabase-js'
import type { PublishTeamInput, SharedDraft, SharedPoolEntry, SharedRosterMember, SharedScoutingEntry } from './team'

/**
 * Shared team workspace (E1), same pattern as collabCore.ts: pure functions
 * over the signed-in Supabase client. Access control is entirely in RLS —
 * see supabase/migrations/20261113200000_e1_team_shared.sql.
 */

function fail(error: { message: string; code?: string } | null, fallback: string): never {
  const msg = error?.message ?? fallback
  if (/forbidden|permission/i.test(msg) || error?.code === '42501') throw new Error('FORBIDDEN')
  throw new Error(msg)
}

interface RosterRow {
  id: string; group_id: string; user_id: string | null; display_name: string
  ign: string | null; tag_line: string | null; region: string | null
  role: SharedRosterMember['role']; status: SharedRosterMember['status']; puuid: string | null
  created_at: string; updated_at: string
}
interface PoolRow {
  id: string; roster_id: string; champion_key: string; role: SharedPoolEntry['role']
  tier: SharedPoolEntry['tier']; notes: string | null
  play_rate: number | null; win_rate: number | null; mastery_points: number | null
  updated_at: string
}
interface ScoutingRow {
  id: string; group_id: string; name: string; tag: string | null
  scout_notes: string | null; created_at: string; updated_at: string
}
interface DraftRow {
  id: string; group_id: string; name: string; vs_scouting_id: string | null
  blue_picks: string[]; blue_bans: string[]; red_picks: string[]; red_bans: string[]
  my_team_side: 'blue' | 'red'; notes: string | null; created_at: string; updated_at: string
}

const toPool = (r: PoolRow): SharedPoolEntry => ({
  id: r.id, rosterId: r.roster_id, championKey: r.champion_key, role: r.role, tier: r.tier,
  notes: r.notes, playRate: r.play_rate, winRate: r.win_rate, masteryPoints: r.mastery_points,
  updatedAt: r.updated_at,
})
const toScouting = (r: ScoutingRow): SharedScoutingEntry => ({
  id: r.id, groupId: r.group_id, name: r.name, tag: r.tag, scoutNotes: r.scout_notes,
  createdAt: r.created_at, updatedAt: r.updated_at,
})
const toDraft = (r: DraftRow): SharedDraft => ({
  id: r.id, groupId: r.group_id, name: r.name, vsScoutingId: r.vs_scouting_id,
  bluePicks: r.blue_picks ?? [], blueBans: r.blue_bans ?? [], redPicks: r.red_picks ?? [], redBans: r.red_bans ?? [],
  myTeamSide: r.my_team_side, notes: r.notes, createdAt: r.created_at, updatedAt: r.updated_at,
})

export async function getSharedTeam(sb: SupabaseClient, groupId: string): Promise<{
  roster: SharedRosterMember[]; drafts: SharedDraft[]; scouting: SharedScoutingEntry[]
}> {
  const [rosterRes, poolRes, draftsRes, scoutingRes] = await Promise.all([
    sb.from('team_rosters').select('id, group_id, user_id, display_name, ign, tag_line, region, role, status, puuid, created_at, updated_at')
      .eq('group_id', groupId).order('display_name'),
    sb.from('team_pool_entries').select('id, roster_id, champion_key, role, tier, notes, play_rate, win_rate, mastery_points, updated_at'),
    sb.from('team_drafts').select('id, group_id, name, vs_scouting_id, blue_picks, blue_bans, red_picks, red_bans, my_team_side, notes, created_at, updated_at')
      .eq('group_id', groupId).order('created_at', { ascending: false }),
    sb.from('team_scouting').select('id, group_id, name, tag, scout_notes, created_at, updated_at')
      .eq('group_id', groupId).order('name'),
  ])
  if (rosterRes.error) fail(rosterRes.error, 'roster')
  if (poolRes.error) fail(poolRes.error, 'pool')
  if (draftsRes.error) fail(draftsRes.error, 'drafts')
  if (scoutingRes.error) fail(scoutingRes.error, 'scouting')

  const rosterIds = new Set((rosterRes.data as RosterRow[]).map((r) => r.id))
  const poolByRoster = new Map<string, SharedPoolEntry[]>()
  for (const row of poolRes.data as PoolRow[]) {
    if (!rosterIds.has(row.roster_id)) continue // belongs to a different group's roster
    const arr = poolByRoster.get(row.roster_id) ?? []
    arr.push(toPool(row))
    poolByRoster.set(row.roster_id, arr)
  }

  const roster: SharedRosterMember[] = (rosterRes.data as RosterRow[]).map((r) => ({
    id: r.id, groupId: r.group_id, userId: r.user_id, displayName: r.display_name,
    ign: r.ign, tagLine: r.tag_line, region: r.region, role: r.role, status: r.status, puuid: r.puuid,
    pool: poolByRoster.get(r.id) ?? [],
    createdAt: r.created_at, updatedAt: r.updated_at,
  }))

  return {
    roster,
    drafts: (draftsRes.data as DraftRow[]).map(toDraft),
    scouting: (scoutingRes.data as ScoutingRow[]).map(toScouting),
  }
}

/**
 * Replaces the group's published roster/pools/drafts/scouting with the
 * given snapshot ("dernier qui écrit gagne" — simplest concurrency model
 * for v1, matching the E1 plan). Existing rows are deleted first so a
 * player removed locally also disappears from the shared copy.
 */
export async function publishTeam(sb: SupabaseClient, groupId: string, data: PublishTeamInput): Promise<{ published: number }> {
  const { data: existingRoster, error: existingErr } = await sb.from('team_rosters').select('id').eq('group_id', groupId)
  if (existingErr) fail(existingErr, 'read existing roster')
  const existingIds = (existingRoster ?? []).map((r: { id: string }) => r.id)
  if (existingIds.length > 0) {
    const { error } = await sb.from('team_rosters').delete().in('id', existingIds)
    if (error) fail(error, 'clear roster') // cascades to team_pool_entries
  }
  { const { error } = await sb.from('team_drafts').delete().eq('group_id', groupId); if (error) fail(error, 'clear drafts') }
  { const { error } = await sb.from('team_scouting').delete().eq('group_id', groupId); if (error) fail(error, 'clear scouting') }

  let published = 0
  for (const member of data.roster) {
    const { data: inserted, error } = await sb.from('team_rosters').insert({
      group_id: groupId, display_name: member.displayName, ign: member.ign, tag_line: member.tagLine,
      region: member.region, role: member.role, puuid: member.puuid,
    }).select('id').single()
    if (error) fail(error, 'publish roster member')
    published++
    if (member.pool.length > 0) {
      const { error: poolErr } = await sb.from('team_pool_entries').insert(
        member.pool.map((p) => ({
          roster_id: inserted.id, champion_key: p.championKey, role: p.role, tier: p.tier,
          notes: p.notes, play_rate: p.playRate, win_rate: p.winRate, mastery_points: p.masteryPoints,
        })),
      )
      if (poolErr) fail(poolErr, 'publish pool')
    }
  }
  if (data.drafts.length > 0) {
    const { error } = await sb.from('team_drafts').insert(
      data.drafts.map((d) => ({
        group_id: groupId, name: d.name, blue_picks: d.bluePicks, blue_bans: d.blueBans,
        red_picks: d.redPicks, red_bans: d.redBans, my_team_side: d.myTeamSide, notes: d.notes,
      })),
    )
    if (error) fail(error, 'publish drafts')
    published += data.drafts.length
  }
  if (data.scouting.length > 0) {
    const { error } = await sb.from('team_scouting').insert(
      data.scouting.map((s) => ({ group_id: groupId, name: s.name, tag: s.tag, scout_notes: s.scoutNotes })),
    )
    if (error) fail(error, 'publish scouting')
    published += data.scouting.length
  }
  return { published }
}
