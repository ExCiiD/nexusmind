import type { SupabaseClient } from '@supabase/supabase-js'
import { getEvent } from './calendarCore'
import {
  isMatchKind, MATCH_ERROR_CODES, opponentOpggUrl, toOpponentPlayer,
  type KnownOpponent, type MatchDetailPatch, type MatchEventDetail, type MatchEventInput, type MatchInput,
  type MatchOpponent, type MatchOpponentPlayer, type OpponentRole,
} from './matchEvent'
import { fail } from './supabaseErrors'

/**
 * #49, scrims planned from the Planning (supabase/migrations/20261120120000_scrims_in_planning.sql). Server-side
 * only, desktop (IPC), web and bot call these the same way. Writes go through the two RPCs, which check the rights
 * (save_match_event: the calendar's editors, update_match_detail: those plus the analyst). Reads go through RLS
 * (any member of the group).
 */

type DbError = { message?: string; code?: string } | null

/** The RPC's own error code when there is one (screens translate it), else the usual mapping. */
function failMatch(error: DbError, what: string): never {
  for (const code of MATCH_ERROR_CODES) if (error?.message?.includes(code)) throw new Error(code)
  fail(error as { message: string; code?: string }, what)
}

export async function saveMatchEvent(sb: SupabaseClient, groupId: string, event: MatchEventInput, match: MatchInput): Promise<string> {
  const p_event: Record<string, unknown> = {
    kind: event.kind, title: event.title, startsAt: event.startsAt, endsAt: event.endsAt,
    notes: event.notes ?? null, attendeeScope: event.attendeeScope ?? 'custom',
  }
  if (event.id) p_event.id = event.id
  // Omitted on an edit: the RPC then keeps the attendees as they are.
  if (event.attendeeUserIds) p_event.attendeeUserIds = event.attendeeUserIds
  const p_match = {
    boFormat: match.boFormat ?? null,
    opponent: match.opponent
      ? {
          name: match.opponent.name, tag: match.opponent.tag ?? null, opggUrl: match.opponent.opggUrl ?? null,
          players: (match.opponent.players ?? []).map((p) => ({ role: p.role, riotId: p.riotId ?? null, region: p.region ?? null })),
        }
      : null,
  }
  const { data, error } = await sb.rpc('save_match_event', { p_group: groupId, p_event, p_match })
  if (error) failMatch(error, 'save match event')
  return data as string
}

export async function updateMatchDetail(sb: SupabaseClient, scrimId: string, patch: MatchDetailPatch): Promise<void> {
  const p_patch: Record<string, unknown> = {}
  if (patch.prepNotes !== undefined) p_patch.prepNotes = patch.prepNotes ?? ''
  if (patch.reviewNotes !== undefined) p_patch.reviewNotes = patch.reviewNotes ?? ''
  if (patch.checklist !== undefined) p_patch.checklist = patch.checklist
  if (patch.draftIds !== undefined) p_patch.draftIds = patch.draftIds
  if (patch.status !== undefined) p_patch.status = patch.status
  if (patch.opponentRoles !== undefined) p_patch.opponentRoles = patch.opponentRoles.map((r) => ({ riotId: r.riotId, role: r.role }))
  const { error } = await sb.rpc('update_match_detail', { p_scrim: scrimId, p_patch })
  if (error) failMatch(error, 'update match detail')
}

type ScoutingRow = { id: string; name: string; tag: string | null; opponent_key: string; opgg_url: string | null; source: 'publish' | 'match' }
type RosterRow = { scouting_id: string; role: OpponentRole; ign: string | null; tag_line: string | null; region: string | null; created_at: string }

const ROLE_ORDER: OpponentRole[] = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT']
function playersOf(rows: RosterRow[]): MatchOpponentPlayer[] {
  // One per role (the first known one), in lane order.
  const byRole = new Map<OpponentRole, RosterRow>()
  for (const r of [...rows].sort((a, b) => Number(!a.ign) - Number(!b.ign) || a.created_at.localeCompare(b.created_at))) {
    if (!byRole.has(r.role)) byRole.set(r.role, r)
  }
  return ROLE_ORDER.filter((role) => byRole.has(role)).map((role) => {
    const r = byRole.get(role) as RosterRow
    return toOpponentPlayer(role, r.ign, r.tag_line, r.region)
  })
}

async function rostersOf(sb: SupabaseClient, scoutingIds: string[]): Promise<Map<string, RosterRow[]>> {
  const out = new Map<string, RosterRow[]>()
  if (scoutingIds.length === 0) return out
  const { data, error } = await sb.from('team_rosters').select('scouting_id, role, ign, tag_line, region, created_at').in('scouting_id', scoutingIds)
  if (error) fail(error, 'list opponent rosters')
  for (const r of (data ?? []) as RosterRow[]) out.set(r.scouting_id, [...(out.get(r.scouting_id) ?? []), r])
  return out
}

/** Published dossiers (#40) of these opponents. Empty before the analyst migration reaches the database. */
async function dossierKeys(sb: SupabaseClient, groupId: string, keys: string[]): Promise<Set<string>> {
  if (keys.length === 0) return new Set()
  try {
    const { data, error } = await sb.from('opponent_dossiers').select('opponent_key').eq('group_id', groupId).eq('status', 'published').in('opponent_key', keys)
    if (error) return new Set()
    return new Set(((data ?? []) as Array<{ opponent_key: string }>).map((r) => r.opponent_key))
  } catch { return new Set() }
}

/** The detail panel of a Scrim / Officiel slot. Null when the slot does not exist, is not a match, or has no detail. */
export async function getMatchEvent(sb: SupabaseClient, calendarEventId: string): Promise<MatchEventDetail | null> {
  const event = await getEvent(sb, calendarEventId)
  if (!event || !isMatchKind(event.kind)) return null
  const { data, error } = await sb.from('scrims')
    .select('id, kind, bo_format, status, opponent, opponent_key, opponent_scouting_id, prep_notes, review_notes, checklist, draft_ids')
    .eq('calendar_event_id', calendarEventId).maybeSingle()
  if (error) fail(error, 'get match')
  if (!data) return null
  const s = data as {
    id: string; kind: MatchEventDetail['kind']; bo_format: MatchEventDetail['boFormat']; status: MatchEventDetail['status']
    opponent: string | null; opponent_key: string | null; opponent_scouting_id: string | null
    prep_notes: string | null; review_notes: string | null; checklist: MatchEventDetail['checklist'] | null; draft_ids: string[] | null
  }

  let opponent: MatchOpponent | null = null
  if (s.opponent_key) {
    // By key first: the id changes when the desktop republishes an older version of the team.
    const { data: rows, error: scErr } = await sb.from('team_scouting').select('id, name, tag, opponent_key, opgg_url, source')
      .eq('group_id', event.groupId).eq('opponent_key', s.opponent_key).limit(1)
    if (scErr) fail(scErr, 'get match opponent')
    const team = ((rows ?? []) as ScoutingRow[])[0]
    const players = team ? playersOf((await rostersOf(sb, [team.id])).get(team.id) ?? []) : []
    const dossiers = await dossierKeys(sb, event.groupId, [s.opponent_key])
    opponent = {
      key: s.opponent_key,
      name: team?.name ?? s.opponent ?? s.opponent_key,
      tag: team?.tag ?? null,
      opggUrl: opponentOpggUrl(team?.opgg_url ?? null, players),
      source: team?.source ?? 'match',
      players,
      hasDossier: dossiers.has(s.opponent_key),
    }
  }
  return {
    event, scrimId: s.id, kind: s.kind, boFormat: s.bo_format, status: s.status, opponent,
    prepNotes: s.prep_notes, reviewNotes: s.review_notes, checklist: s.checklist ?? [], draftIds: s.draft_ids ?? [],
  }
}

/** The group's scouted teams for the pop-up's "Équipe connue", the most recently played first, then by name. */
export async function listKnownOpponents(sb: SupabaseClient, groupId: string): Promise<KnownOpponent[]> {
  const [teams, scrims] = await Promise.all([
    sb.from('team_scouting').select('id, name, tag, opponent_key, opgg_url, source').eq('group_id', groupId),
    sb.from('scrims').select('opponent_key, scheduled_at').eq('group_id', groupId).not('opponent_key', 'is', null),
  ])
  if (teams.error) fail(teams.error, 'list known opponents')
  const lastByKey = new Map<string, string>()
  if (!scrims.error) {
    for (const r of (scrims.data ?? []) as Array<{ opponent_key: string; scheduled_at: string }>) {
      if ((lastByKey.get(r.opponent_key) ?? '') < r.scheduled_at) lastByKey.set(r.opponent_key, r.scheduled_at)
    }
  }
  const rows = (teams.data ?? []) as ScoutingRow[]
  const rosters = await rostersOf(sb, rows.map((t) => t.id))
  return rows
    .map((t) => {
      const players = playersOf(rosters.get(t.id) ?? [])
      return { key: t.opponent_key, name: t.name, tag: t.tag, opggUrl: opponentOpggUrl(t.opgg_url, players), lastMatchAt: lastByKey.get(t.opponent_key) ?? null, players }
    })
    .sort((a, b) => (b.lastMatchAt ?? '').localeCompare(a.lastMatchAt ?? '') || a.name.localeCompare(b.name))
}
