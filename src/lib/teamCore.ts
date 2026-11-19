import type { SupabaseClient } from '@supabase/supabase-js'
import type { PublishTeamInput, SharedDraft, SharedPoolEntry, SharedRosterMember, SharedScoutingEntry } from './team'
import { normalizeSlots, groupDuplicates } from './teamIdentity'
import { fail } from './supabaseErrors'

/**
 * Local mirrors of the desktop-facing Team/TeamMember/ChampionPoolEntry/
 * DraftPrep shapes (src/lib/ipc.ts) — intentionally NOT imported from
 * there: ipc.ts pulls in renderer/component types that don't belong in
 * tsconfig.node.json's project (this file is shared by both). Keep these
 * in sync with ipc.ts by hand; they're small and rarely change.
 */
export interface CoreTeamMember {
  id: string
  teamId: string
  displayName: string
  ign?: string | null
  tagLine?: string | null
  region?: string | null
  role: string
  puuid?: string | null
  champPool?: CoreChampionPoolEntry[]
}
export interface CoreTeam {
  id: string
  userId: string
  name: string
  tag?: string | null
  logo?: string | null
  notes?: string | null
  isOpponent: boolean
  scoutNotes?: string | null
  createdAt: string
  updatedAt: string
  members?: CoreTeamMember[]
}
export interface CoreChampionPoolEntry {
  id: string
  memberId: string
  championKey: string
  role: string
  tier: string
  notes?: string | null
  playRate?: number | null
  winRate?: number | null
  masteryPoints?: number | null
  kda?: number | null
  updatedAt: string
}
export interface CoreDraftPrep {
  id: string
  userId: string
  name: string
  vsTeamId?: string | null
  bluePicks: string
  blueBans: string
  redPicks: string
  redBans: string
  myTeamSide: 'blue' | 'red'
  notes?: string | null
  createdAt: string
  updatedAt: string
}

/**
 * Shared team workspace (E1) + full web CRUD (E14), same pattern as
 * collabCore.ts: pure functions over the signed-in Supabase client. Access
 * control is entirely in RLS — see supabase/migrations/20261113200000_e1_team_shared.sql
 * and 20261114190000_e14_team_scouting_rosters.sql (the write policies
 * already cover every function below: staff write anything in their group,
 * a player writes only their own roster's pool entries).
 *
 * Two families of functions here:
 *   - getSharedTeam / publishTeam: the original E1 read-only web view +
 *     desktop's one-shot "publish to group" snapshot.
 *   - Everything below "E14: full CRUD": returns the SAME Team/TeamMember/
 *     ChampionPoolEntry/DraftPrep shapes the desktop IPC does, so the real
 *     RosterTab/ChampPoolTab/DraftTab/ScoutingTab components
 *     (src/pages/Team/*.tsx) run unchanged on the web — see web/src/api.ts.
 */

interface RosterRow {
  id: string; group_id: string; user_id: string | null; display_name: string
  ign: string | null; tag_line: string | null; region: string | null
  role: SharedRosterMember['role']; status: SharedRosterMember['status']; puuid: string | null
  scouting_id: string | null
  created_at: string; updated_at: string
}
interface PoolRow {
  id: string; roster_id: string; champion_key: string; role: SharedPoolEntry['role']
  tier: SharedPoolEntry['tier']; notes: string | null
  play_rate: number | null; win_rate: number | null; mastery_points: number | null; kda: number | null
  updated_at: string
}
interface ScoutingRow {
  id: string; group_id: string; name: string; tag: string | null
  scout_notes: string | null; created_at: string; updated_at: string
}
interface DraftRow {
  id: string; group_id: string; name: string; vs_scouting_id: string | null
  blue_picks: string[][]; blue_bans: string[][]; red_picks: string[][]; red_bans: string[][]
  my_team_side: 'blue' | 'red'; notes: string | null; created_at: string; updated_at: string
}

const ROSTER_SELECT = 'id, group_id, user_id, display_name, ign, tag_line, region, role, status, puuid, scouting_id, created_at, updated_at'
const POOL_SELECT = 'id, roster_id, champion_key, role, tier, notes, play_rate, win_rate, mastery_points, kda, updated_at'
const SCOUTING_SELECT = 'id, group_id, name, tag, scout_notes, created_at, updated_at'
const DRAFT_SELECT = 'id, group_id, name, vs_scouting_id, blue_picks, blue_bans, red_picks, red_bans, my_team_side, notes, created_at, updated_at'

const toPool = (r: PoolRow): SharedPoolEntry => ({
  id: r.id, rosterId: r.roster_id, championKey: r.champion_key, role: r.role, tier: r.tier,
  notes: r.notes, playRate: r.play_rate, winRate: r.win_rate, masteryPoints: r.mastery_points, kda: r.kda,
  updatedAt: r.updated_at,
})
const toDraft = (r: DraftRow): SharedDraft => ({
  id: r.id, groupId: r.group_id, name: r.name, vsScoutingId: r.vs_scouting_id,
  bluePicks: (r.blue_picks ?? []).flat(), blueBans: (r.blue_bans ?? []).flat(),
  redPicks: (r.red_picks ?? []).flat(), redBans: (r.red_bans ?? []).flat(),
  myTeamSide: r.my_team_side, notes: r.notes, createdAt: r.created_at, updatedAt: r.updated_at,
})

// ── E1: read-only web view + desktop's one-shot publish ────────────────────

export async function getSharedTeam(sb: SupabaseClient, groupId: string): Promise<{
  roster: SharedRosterMember[]; drafts: SharedDraft[]; scouting: SharedScoutingEntry[]
}> {
  const [rosterRes, poolRes, draftsRes, scoutingRes] = await Promise.all([
    sb.from('team_rosters').select(ROSTER_SELECT).eq('group_id', groupId).order('display_name'),
    sb.from('team_pool_entries').select(POOL_SELECT),
    sb.from('team_drafts').select(DRAFT_SELECT).eq('group_id', groupId).order('created_at', { ascending: false }),
    sb.from('team_scouting').select(SCOUTING_SELECT).eq('group_id', groupId).order('name'),
  ])
  if (rosterRes.error) fail(rosterRes.error, 'roster')
  if (poolRes.error) fail(poolRes.error, 'pool')
  if (draftsRes.error) fail(draftsRes.error, 'drafts')
  if (scoutingRes.error) fail(scoutingRes.error, 'scouting')

  const rosterRows = rosterRes.data as RosterRow[]
  const rosterIds = new Set(rosterRows.map((r) => r.id))
  const poolByRoster = new Map<string, SharedPoolEntry[]>()
  for (const row of poolRes.data as PoolRow[]) {
    if (!rosterIds.has(row.roster_id)) continue // belongs to a different group's roster
    const arr = poolByRoster.get(row.roster_id) ?? []
    arr.push(toPool(row))
    poolByRoster.set(row.roster_id, arr)
  }

  const toRosterShared = (r: RosterRow): SharedRosterMember => ({
    id: r.id, groupId: r.group_id, userId: r.user_id, displayName: r.display_name,
    ign: r.ign, tagLine: r.tag_line, region: r.region, role: r.role, status: r.status, puuid: r.puuid,
    scoutingId: r.scouting_id, pool: poolByRoster.get(r.id) ?? [],
    createdAt: r.created_at, updatedAt: r.updated_at,
  })

  const roster = rosterRows.filter((r) => !r.scouting_id).map(toRosterShared)
  const scoutedRosterByScoutingId = new Map<string, SharedRosterMember[]>()
  for (const r of rosterRows) {
    if (!r.scouting_id) continue
    const arr = scoutedRosterByScoutingId.get(r.scouting_id) ?? []
    arr.push(toRosterShared(r))
    scoutedRosterByScoutingId.set(r.scouting_id, arr)
  }

  return {
    roster,
    drafts: (draftsRes.data as DraftRow[]).map(toDraft),
    scouting: (scoutingRes.data as ScoutingRow[]).map((r) => ({
      id: r.id, groupId: r.group_id, name: r.name, tag: r.tag, scoutNotes: r.scout_notes,
      roster: scoutedRosterByScoutingId.get(r.id) ?? [],
      createdAt: r.created_at, updatedAt: r.updated_at,
    })),
  }
}

/**
 * Replaces the group's published roster/pools/drafts/scouting with the
 * given snapshot ("dernier qui écrit gagne" — simplest concurrency model
 * for v1, matching the E1 plan). Existing rows are deleted first so a
 * player removed locally also disappears from the shared copy. Deleting a
 * group's team_scouting rows cascades to their roster + pool entries too,
 * so opponents are fully replaced, not just their name/notes stub.
 */
export async function publishTeam(sb: SupabaseClient, groupId: string, data: PublishTeamInput): Promise<{ published: number }> {
  const { data: existingRoster, error: existingErr } = await sb.from('team_rosters').select('id').eq('group_id', groupId).is('scouting_id', null)
  if (existingErr) fail(existingErr, 'read existing roster')
  const existingIds = (existingRoster ?? []).map((r: { id: string }) => r.id)
  if (existingIds.length > 0) {
    const { error } = await sb.from('team_rosters').delete().in('id', existingIds)
    if (error) fail(error, 'clear roster') // cascades to team_pool_entries
  }
  { const { error } = await sb.from('team_drafts').delete().eq('group_id', groupId); if (error) fail(error, 'clear drafts') }
  // Cascades: team_scouting -> team_rosters (scouting_id) -> team_pool_entries.
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
          notes: p.notes, play_rate: p.playRate, win_rate: p.winRate, mastery_points: p.masteryPoints, kda: p.kda,
        })),
      )
      if (poolErr) fail(poolErr, 'publish pool')
    }
  }
  if (data.drafts.length > 0) {
    const { error } = await sb.from('team_drafts').insert(
      data.drafts.map((d) => ({
        group_id: groupId, name: d.name, blue_picks: normalizeSlots(d.bluePicks), blue_bans: normalizeSlots(d.blueBans),
        red_picks: normalizeSlots(d.redPicks), red_bans: normalizeSlots(d.redBans), my_team_side: d.myTeamSide, notes: d.notes,
      })),
    )
    if (error) fail(error, 'publish drafts')
    published += data.drafts.length
  }
  for (const opp of data.scouting) {
    const { data: scoutRow, error: scoutErr } = await sb.from('team_scouting').insert({
      group_id: groupId, name: opp.name, tag: opp.tag, scout_notes: opp.scoutNotes,
    }).select('id').single()
    if (scoutErr) fail(scoutErr, 'publish scouting team')
    published++
    for (const member of opp.roster) {
      const { data: insertedOpp, error: oppErr } = await sb.from('team_rosters').insert({
        group_id: groupId, scouting_id: scoutRow.id, display_name: member.displayName, ign: member.ign,
        tag_line: member.tagLine, region: member.region, role: member.role, puuid: member.puuid,
      }).select('id').single()
      if (oppErr) fail(oppErr, 'publish scouted roster member')
      published++
      if (member.pool.length > 0) {
        const { error: oppPoolErr } = await sb.from('team_pool_entries').insert(
          member.pool.map((p) => ({
            roster_id: insertedOpp.id, champion_key: p.championKey, role: p.role, tier: p.tier,
            notes: p.notes, play_rate: p.playRate, win_rate: p.winRate, mastery_points: p.masteryPoints, kda: p.kda,
          })),
        )
        if (oppPoolErr) fail(oppPoolErr, 'publish scouted pool')
      }
    }
  }
  return { published }
}

// ── E14: full CRUD, desktop-shaped (Team/TeamMember/ChampionPoolEntry/DraftPrep) ──

const toChampionPoolEntry = (r: PoolRow): CoreChampionPoolEntry => ({
  id: r.id, memberId: r.roster_id, championKey: r.champion_key, role: r.role, tier: r.tier,
  notes: r.notes, playRate: r.play_rate, winRate: r.win_rate, masteryPoints: r.mastery_points, kda: r.kda,
  updatedAt: r.updated_at,
})

const toTeamMember = (r: RosterRow, pool: CoreChampionPoolEntry[]): CoreTeamMember => ({
  id: r.id, teamId: r.scouting_id ?? r.group_id, displayName: r.display_name,
  ign: r.ign, tagLine: r.tag_line, region: r.region, role: r.role, puuid: r.puuid, champPool: pool,
})

const toDraftPrep = (r: DraftRow): CoreDraftPrep => ({
  id: r.id, userId: '', name: r.name, vsTeamId: r.vs_scouting_id,
  bluePicks: JSON.stringify(r.blue_picks ?? []), blueBans: JSON.stringify(r.blue_bans ?? []),
  redPicks: JSON.stringify(r.red_picks ?? []), redBans: JSON.stringify(r.red_bans ?? []),
  myTeamSide: r.my_team_side, notes: r.notes, createdAt: r.created_at, updatedAt: r.updated_at,
})

async function fetchPoolsByRosterIds(sb: SupabaseClient, rosterIds: string[]): Promise<Map<string, CoreChampionPoolEntry[]>> {
  const map = new Map<string, CoreChampionPoolEntry[]>()
  if (rosterIds.length === 0) return map
  const { data, error } = await sb.from('team_pool_entries').select(POOL_SELECT).in('roster_id', rosterIds)
  if (error) fail(error, 'list pool entries')
  for (const row of data as PoolRow[]) {
    const arr = map.get(row.roster_id) ?? []
    arr.push(toChampionPoolEntry(row))
    map.set(row.roster_id, arr)
  }
  return map
}

/**
 * `listTeams({isOpponent})` equivalent. The group's own roster has no
 * separate "team" entity server-side — the group IS the team — so
 * `isOpponent: false` always returns exactly one synthetic Team keyed by
 * the group id. `isOpponent: true` returns one Team per scouted opponent
 * (a team_scouting row), each with its own roster + pools.
 */
export async function listGroupTeams(sb: SupabaseClient, groupId: string, opts: { isOpponent?: boolean } = {}): Promise<CoreTeam[]> {
  const now = new Date().toISOString()
  if (!opts.isOpponent) {
    const { data, error } = await sb.from('team_rosters').select(ROSTER_SELECT).eq('group_id', groupId).is('scouting_id', null).order('display_name')
    if (error) fail(error, 'list roster')
    const rows = data as RosterRow[]
    const pools = await fetchPoolsByRosterIds(sb, rows.map((r) => r.id))
    return [{
      id: groupId, userId: '', name: 'My team', tag: null, logo: null, notes: null,
      isOpponent: false, scoutNotes: null, createdAt: now, updatedAt: now,
      members: rows.map((r) => toTeamMember(r, pools.get(r.id) ?? [])),
    }]
  }
  const { data: scoutData, error: sErr } = await sb.from('team_scouting').select(SCOUTING_SELECT).eq('group_id', groupId).order('name')
  if (sErr) fail(sErr, 'list scouting teams')
  const scouts = scoutData as ScoutingRow[]
  if (scouts.length === 0) return []
  const { data: rosterData, error: rErr } = await sb.from('team_rosters').select(ROSTER_SELECT).in('scouting_id', scouts.map((s) => s.id)).order('display_name')
  if (rErr) fail(rErr, 'list scouted rosters')
  const rows = rosterData as RosterRow[]
  const pools = await fetchPoolsByRosterIds(sb, rows.map((r) => r.id))
  const membersByScouting = new Map<string, CoreTeamMember[]>()
  for (const r of rows) {
    const arr = membersByScouting.get(r.scouting_id as string) ?? []
    arr.push(toTeamMember(r, pools.get(r.id) ?? []))
    membersByScouting.set(r.scouting_id as string, arr)
  }
  return scouts.map((s) => ({
    id: s.id, userId: '', name: s.name, tag: s.tag, logo: null, notes: null,
    isOpponent: true, scoutNotes: s.scout_notes, createdAt: s.created_at, updatedAt: s.updated_at,
    members: membersByScouting.get(s.id) ?? [],
  }))
}

/** `createTeam({name, isOpponent:true})` equivalent — the own-team case has
 *  nothing to create server-side (see listGroupTeams) and is never actually
 *  invoked by the web Team page, which always has a group to key off. */
export async function createOpponentTeam(sb: SupabaseClient, groupId: string, data: { name: string; tag?: string | null; notes?: string | null }): Promise<CoreTeam> {
  const { data: row, error } = await sb.from('team_scouting').insert({
    group_id: groupId, name: data.name, tag: data.tag ?? null, scout_notes: data.notes ?? null,
  }).select(SCOUTING_SELECT).single()
  if (error) fail(error, 'create opponent team')
  const s = row as ScoutingRow
  return {
    id: s.id, userId: '', name: s.name, tag: s.tag, logo: null, notes: null,
    isOpponent: true, scoutNotes: s.scout_notes, createdAt: s.created_at, updatedAt: s.updated_at, members: [],
  }
}

/** Deletes a scouted opponent team (cascades its roster + pool entries). */
export async function deleteOpponentTeam(sb: SupabaseClient, scoutingId: string): Promise<void> {
  const { error } = await sb.from('team_scouting').delete().eq('id', scoutingId)
  if (error) fail(error, 'delete opponent team')
}

function findExistingRoster(rows: RosterRow[], data: { puuid?: string | null; ign?: string | null; tagLine?: string | null; displayName?: string }): RosterRow | null {
  const norm = (s?: string | null) => (s ?? '').toLowerCase().trim()
  if (data.puuid) { const m = rows.find((r) => r.puuid === data.puuid); if (m) return m }
  if (data.ign && data.tagLine) { const m = rows.find((r) => norm(r.ign) === norm(data.ign) && norm(r.tag_line) === norm(data.tagLine)); if (m) return m }
  if (data.ign) { const m = rows.find((r) => r.ign && norm(r.ign) === norm(data.ign)); if (m) return m }
  if (data.displayName) { const m = rows.find((r) => norm(r.display_name) === norm(data.displayName)); if (m) return m }
  return null
}

/**
 * `addTeamMember(teamId, data)` equivalent. `scoutingId` is null for the
 * group's own roster, or a team_scouting id for a scouted opponent's
 * roster. Idempotent add, same identity matching as desktop (team.ipc.ts):
 * re-adding the same Riot identity updates the existing row in place
 * instead of creating a duplicate.
 */
export async function addRosterMember(
  sb: SupabaseClient, groupId: string, scoutingId: string | null,
  data: { displayName: string; ign?: string | null; tagLine?: string | null; region?: string | null; role: string; puuid?: string | null },
): Promise<CoreTeamMember> {
  let query = sb.from('team_rosters').select(ROSTER_SELECT).eq('group_id', groupId)
  query = scoutingId ? query.eq('scouting_id', scoutingId) : query.is('scouting_id', null)
  const { data: existingRows, error: exErr } = await query
  if (exErr) fail(exErr, 'read roster for add')
  const existing = findExistingRoster(existingRows as RosterRow[], data)
  if (existing) {
    const { data: row, error } = await sb.from('team_rosters').update({
      display_name: data.displayName || existing.display_name,
      role: data.role || existing.role,
      ign: data.ign ?? existing.ign,
      tag_line: data.tagLine ?? existing.tag_line,
      region: data.region ?? existing.region,
      puuid: data.puuid ?? existing.puuid,
    }).eq('id', existing.id).select(ROSTER_SELECT).single()
    if (error) fail(error, 'update existing roster member')
    return toTeamMember(row as RosterRow, [])
  }
  const { data: row, error } = await sb.from('team_rosters').insert({
    group_id: groupId, scouting_id: scoutingId, display_name: data.displayName,
    ign: data.ign ?? null, tag_line: data.tagLine ?? null, region: data.region ?? null,
    role: data.role, puuid: data.puuid ?? null,
  }).select(ROSTER_SELECT).single()
  if (error) fail(error, 'add roster member')
  return toTeamMember(row as RosterRow, [])
}

export async function updateRosterMember(
  sb: SupabaseClient, rosterId: string,
  data: Partial<{ displayName: string; ign: string | null; tagLine: string | null; region: string | null; role: string; puuid: string | null }>,
): Promise<CoreTeamMember> {
  const patch: Record<string, unknown> = {}
  if (data.displayName !== undefined) patch.display_name = data.displayName
  if (data.ign !== undefined) patch.ign = data.ign
  if (data.tagLine !== undefined) patch.tag_line = data.tagLine
  if (data.region !== undefined) patch.region = data.region
  if (data.role !== undefined) patch.role = data.role
  if (data.puuid !== undefined) patch.puuid = data.puuid
  const { data: row, error } = await sb.from('team_rosters').update(patch).eq('id', rosterId).select(ROSTER_SELECT).single()
  if (error) fail(error, 'update roster member')
  const pool = await fetchPoolsByRosterIds(sb, [rosterId])
  return toTeamMember(row as RosterRow, pool.get(rosterId) ?? [])
}

/** Removes a roster member (cascades their pool entries). */
export async function removeRosterMember(sb: SupabaseClient, rosterId: string): Promise<void> {
  const { error } = await sb.from('team_rosters').delete().eq('id', rosterId)
  if (error) fail(error, 'remove roster member')
}

/**
 * Fetches a single roster row by id, no pool attached — used by the web's
 * scout/auto-fill flow (web/src/scoutingWeb.ts) to resolve a memberId into
 * the ign/tagLine/region/role/puuid it needs before calling Riot, since
 * (unlike desktop's Prisma-backed handlers) it has no local DB to read.
 */
export async function getRosterMember(sb: SupabaseClient, rosterId: string): Promise<CoreTeamMember> {
  const { data, error } = await sb.from('team_rosters').select(ROSTER_SELECT).eq('id', rosterId).single()
  if (error) fail(error, 'read roster member')
  return toTeamMember(data as RosterRow, [])
}

/**
 * `dedupeTeamMembers(teamId)` equivalent — same identity grouping and pool
 * merge as team.ipc.ts's `team:dedupe-members` (src/lib/teamIdentity.ts),
 * scoped to one roster (own or a given opponent's).
 */
export async function dedupeRosterMembers(sb: SupabaseClient, groupId: string, scoutingId: string | null): Promise<{ removed: number }> {
  let query = sb.from('team_rosters').select(ROSTER_SELECT).eq('group_id', groupId).order('created_at', { ascending: true })
  query = scoutingId ? query.eq('scouting_id', scoutingId) : query.is('scouting_id', null)
  const { data, error } = await query
  if (error) fail(error, 'read roster for dedupe')
  const rows = data as RosterRow[]
  const pools = await fetchPoolsByRosterIds(sb, rows.map((r) => r.id))
  const members = rows.map((r) => ({ row: r, pool: pools.get(r.id) ?? [] }))
  const identityInput = members.map((m) => ({ ref: m, puuid: m.row.puuid, ign: m.row.ign, tagLine: m.row.tag_line, displayName: m.row.display_name }))
  const groups = groupDuplicates(identityInput).map((g) => g.map((x) => x.ref))

  let removed = 0
  for (const group of groups) {
    const [keeper, ...dups] = group
    const keeperKeys = new Set(keeper.pool.map((e) => `${e.championKey}|${e.role}`))
    for (const dup of dups) {
      for (const entry of dup.pool) {
        const k = `${entry.championKey}|${entry.role}`
        if (keeperKeys.has(k)) continue
        const { error: mvErr } = await sb.from('team_pool_entries').update({ roster_id: keeper.row.id }).eq('id', entry.id)
        if (mvErr) fail(mvErr, 'merge pool entry')
        keeperKeys.add(k)
      }
      const { error: delErr } = await sb.from('team_rosters').delete().eq('id', dup.row.id)
      if (delErr) fail(delErr, 'delete duplicate roster member')
      removed++
    }
  }
  return { removed }
}

export async function listPoolForMember(sb: SupabaseClient, rosterId: string): Promise<CoreChampionPoolEntry[]> {
  const { data, error } = await sb.from('team_pool_entries').select(POOL_SELECT).eq('roster_id', rosterId).order('tier').order('champion_key')
  if (error) fail(error, 'list champion pool')
  return (data as PoolRow[]).map(toChampionPoolEntry)
}

export async function upsertPoolEntry(
  sb: SupabaseClient, rosterId: string, championKey: string, role: string,
  data: Partial<{ tier: string; notes: string | null; playRate: number | null; winRate: number | null; masteryPoints: number | null; kda: number | null }>,
): Promise<CoreChampionPoolEntry> {
  const patch: Record<string, unknown> = { roster_id: rosterId, champion_key: championKey, role }
  if (data.tier !== undefined) patch.tier = data.tier
  if (data.notes !== undefined) patch.notes = data.notes
  if (data.playRate !== undefined) patch.play_rate = data.playRate
  if (data.winRate !== undefined) patch.win_rate = data.winRate
  if (data.masteryPoints !== undefined) patch.mastery_points = data.masteryPoints
  if (data.kda !== undefined) patch.kda = data.kda
  const { data: row, error } = await sb.from('team_pool_entries')
    .upsert(patch, { onConflict: 'roster_id,champion_key,role' })
    .select(POOL_SELECT).single()
  if (error) fail(error, 'upsert pool entry')
  return toChampionPoolEntry(row as PoolRow)
}

export async function removePoolEntry(sb: SupabaseClient, entryId: string): Promise<void> {
  const { error } = await sb.from('team_pool_entries').delete().eq('id', entryId)
  if (error) fail(error, 'remove pool entry')
}

export async function listGroupDrafts(sb: SupabaseClient, groupId: string): Promise<CoreDraftPrep[]> {
  const { data, error } = await sb.from('team_drafts').select(DRAFT_SELECT).eq('group_id', groupId).order('created_at', { ascending: false })
  if (error) fail(error, 'list drafts')
  return (data as DraftRow[]).map(toDraftPrep)
}

export async function createGroupDraft(
  sb: SupabaseClient, groupId: string,
  data: { name: string; vsTeamId?: string | null; bluePicks?: string[][] | string[]; blueBans?: string[][] | string[]; redPicks?: string[][] | string[]; redBans?: string[][] | string[]; myTeamSide?: 'blue' | 'red'; notes?: string | null },
): Promise<CoreDraftPrep> {
  const { data: row, error } = await sb.from('team_drafts').insert({
    group_id: groupId, name: data.name, vs_scouting_id: data.vsTeamId ?? null,
    blue_picks: normalizeSlots(data.bluePicks), blue_bans: normalizeSlots(data.blueBans),
    red_picks: normalizeSlots(data.redPicks), red_bans: normalizeSlots(data.redBans),
    my_team_side: data.myTeamSide ?? 'blue', notes: data.notes ?? null,
  }).select(DRAFT_SELECT).single()
  if (error) fail(error, 'create draft')
  return toDraftPrep(row as DraftRow)
}

export async function updateGroupDraft(
  sb: SupabaseClient, id: string,
  data: Partial<{ name: string; vsTeamId: string | null; bluePicks: string[][] | string[]; blueBans: string[][] | string[]; redPicks: string[][] | string[]; redBans: string[][] | string[]; myTeamSide: 'blue' | 'red'; notes: string | null }>,
): Promise<CoreDraftPrep> {
  const patch: Record<string, unknown> = {}
  if (data.name !== undefined) patch.name = data.name
  if (data.vsTeamId !== undefined) patch.vs_scouting_id = data.vsTeamId
  if (data.bluePicks !== undefined) patch.blue_picks = normalizeSlots(data.bluePicks)
  if (data.blueBans !== undefined) patch.blue_bans = normalizeSlots(data.blueBans)
  if (data.redPicks !== undefined) patch.red_picks = normalizeSlots(data.redPicks)
  if (data.redBans !== undefined) patch.red_bans = normalizeSlots(data.redBans)
  if (data.myTeamSide !== undefined) patch.my_team_side = data.myTeamSide
  if (data.notes !== undefined) patch.notes = data.notes
  const { data: row, error } = await sb.from('team_drafts').update(patch).eq('id', id).select(DRAFT_SELECT).single()
  if (error) fail(error, 'update draft')
  return toDraftPrep(row as DraftRow)
}

export async function deleteGroupDraft(sb: SupabaseClient, id: string): Promise<void> {
  const { error } = await sb.from('team_drafts').delete().eq('id', id)
  if (error) fail(error, 'delete draft')
}

export async function duplicateGroupDraft(sb: SupabaseClient, groupId: string, id: string): Promise<CoreDraftPrep> {
  const { data: row, error } = await sb.from('team_drafts').select(DRAFT_SELECT).eq('id', id).single()
  if (error) fail(error, 'read draft to duplicate')
  const r = row as DraftRow
  const { data: created, error: insErr } = await sb.from('team_drafts').insert({
    group_id: groupId, name: `${r.name} (copy)`, vs_scouting_id: r.vs_scouting_id,
    blue_picks: r.blue_picks, blue_bans: r.blue_bans, red_picks: r.red_picks, red_bans: r.red_bans,
    my_team_side: r.my_team_side, notes: r.notes,
  }).select(DRAFT_SELECT).single()
  if (insErr) fail(insErr, 'duplicate draft')
  return toDraftPrep(created as DraftRow)
}
