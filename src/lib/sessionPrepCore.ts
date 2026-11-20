import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  DraftSlots, PlayerObjectivesInput, PlayerSessionObjectives, SessionDraft, SessionDraftInput, SessionPrep,
} from './sessionPrep'
import { getObjectives } from './teamSessionsCore'
import { normalizeSlots } from './teamIdentity'
import { fail } from './supabaseErrors'

/**
 * Preparing a team session ahead (contract docs/contracts/session-prep.md, migration 20261120170000_team_session_prep).
 * Access is in Postgres RLS: the session's managers or the group's staff write while the session is scheduled; the group
 * reads it all.
 */

export const MAX_PLAYER_OBJECTIVES = 2
export const MAX_PLAYER_KPIS = 10
export const MAX_NOTE = 140
export const MAX_MESSAGE = 280
export const MAX_SLOTS = 5

type PgError = { code?: string; message: string } | null
const isMissingRelation = (e: PgError) => e?.code === '42P01' || e?.code === 'PGRST205'

/** The app's error for a refused write. */
function rethrow(error: PgError, what: string): never {
  if (isMissingRelation(error) || error?.code === 'PGRST202') throw new Error('NOT_AVAILABLE')
  // 42501: row-level security (not allowed, or the session ended). 23503: the player is not a user.
  if (error?.code === '42501') throw new Error('FORBIDDEN')
  if (error?.code === '23514' || error?.code === '22P02' || error?.code === '23503') throw new Error('INVALID')
  fail(error, what)
}

/** Validates and cleans a player's objectives (null when they hold nothing: removing them). */
export function cleanPlayerObjectives(v: PlayerObjectivesInput): PlayerObjectivesInput | null {
  const objectiveIds = [...new Set(v.objectiveIds.map((s) => s.trim()).filter(Boolean))]
  const kpiIds = [...new Set(v.kpiIds.map((s) => s.trim()).filter(Boolean))]
  const note = v.note?.trim() ? v.note.trim() : null
  if (objectiveIds.length > MAX_PLAYER_OBJECTIVES || kpiIds.length > MAX_PLAYER_KPIS || (note?.length ?? 0) > MAX_NOTE
      || objectiveIds.some((id) => id.length > 128) || kpiIds.some((id) => id.length > 128)) throw new Error('INVALID')
  if (objectiveIds.length === 0 && !note) return null
  return { objectiveIds, kpiIds, note }
}

/** Validates and cleans a draft (slots normalised, at most 5 per list). */
export function cleanDraft(d: SessionDraftInput): SessionDraftInput & { bluePicks: DraftSlots; blueBans: DraftSlots; redPicks: DraftSlots; redBans: DraftSlots } {
  const name = d.name.trim()
  const slots = [d.bluePicks, d.blueBans, d.redPicks, d.redBans].map((s) => normalizeSlots(s as string[][]))
  if (!name || name.length > 80 || slots.some((s) => s.length > MAX_SLOTS) || (d.notes?.length ?? 0) > 4000
      || (d.sourceId !== null && (d.sourceId.length < 1 || d.sourceId.length > 128)) || (d.myTeamSide !== 'blue' && d.myTeamSide !== 'red')) throw new Error('INVALID')
  const [bluePicks, blueBans, redPicks, redBans] = slots
  return { sourceId: d.sourceId, name, bluePicks, blueBans, redPicks, redBans, myTeamSide: d.myTeamSide, notes: d.notes?.trim() ? d.notes : null }
}

const toPlayerObjectives = (r: any): PlayerSessionObjectives => ({
  playerId: r.player_id, objectiveIds: r.objective_ids ?? [], kpiIds: r.kpi_ids ?? [], note: r.note ?? null, setBy: r.set_by ?? null, setAt: r.set_at,
})
const toDraft = (r: any): SessionDraft => ({
  id: r.id, sourceId: r.source_id ?? null, name: r.name,
  bluePicks: normalizeSlots(r.blue_picks), blueBans: normalizeSlots(r.blue_bans), redPicks: normalizeSlots(r.red_picks), redBans: normalizeSlots(r.red_bans),
  myTeamSide: r.my_team_side === 'red' ? 'red' : 'blue', notes: r.notes ?? null, position: r.position ?? 0,
  createdBy: r.created_by ?? null, createdAt: r.created_at, updatedAt: r.updated_at,
})
const DRAFT_COLS = 'id, source_id, name, blue_picks, blue_bans, red_picks, red_bans, my_team_side, notes, position, created_by, created_at, updated_at'

export async function getSessionPrep(sb: SupabaseClient, sessionId: string): Promise<SessionPrep> {
  const { data: session, error: sErr } = await sb.from('team_sessions').select('id').eq('id', sessionId).maybeSingle()
  if (sErr) fail(sErr, 'session')
  if (!session) throw new Error('NOT_FOUND')
  const [objectives, players, drafts, can, note] = await Promise.all([
    getObjectives(sb, sessionId),
    sb.from('team_session_player_objectives').select('player_id, objective_ids, kpi_ids, note, set_by, set_at').eq('session_id', sessionId),
    sb.from('team_session_drafts').select(DRAFT_COLS).eq('session_id', sessionId).order('position').order('created_at'),
    sb.rpc('can_prepare_team_session', { p_session: sessionId }),
    sb.from('team_session_prep_notes').select('message, set_by, set_at').eq('session_id', sessionId).maybeSingle(),
  ])
  const available = !isMissingRelation(players.error) && !isMissingRelation(drafts.error)
  if (available) for (const r of [players, drafts, note]) if (r.error) fail(r.error, 'session prep')
  const n = available ? (note.data as { message: string; set_by: string | null; set_at: string } | null) : null
  return {
    sessionId,
    available,
    canPrepare: available && can.data === true,
    objectives,
    message: n ? { text: n.message, setBy: n.set_by ?? null, setAt: n.set_at } : null,
    playerObjectives: available ? (players.data ?? []).map(toPlayerObjectives) : [],
    drafts: available ? (drafts.data ?? []).map(toDraft) : [],
  }
}

/** The events (of those given) whose session has at least one objective set, collective or individual. */
export async function prepReadyForEvents(sb: SupabaseClient, calendarEventIds: string[]): Promise<string[]> {
  const ids = [...new Set(calendarEventIds)].slice(0, 200)
  if (ids.length === 0) return []
  const { data: sessions, error } = await sb.from('team_sessions').select('id, calendar_event_id').in('calendar_event_id', ids)
  if (error) fail(error, 'sessions')
  const sessionIds = (sessions ?? []).map((s: any) => s.id as string)
  if (sessionIds.length === 0) return []
  const [collective, individual] = await Promise.all([
    sb.from('team_session_objectives').select('session_id, objective_ids').in('session_id', sessionIds),
    sb.from('team_session_player_objectives').select('session_id').in('session_id', sessionIds),
  ])
  if (collective.error) fail(collective.error, 'objectives')
  if (individual.error && !isMissingRelation(individual.error)) fail(individual.error, 'player objectives')
  const ready = new Set<string>([
    ...(collective.data ?? []).filter((o: any) => (o.objective_ids ?? []).length > 0).map((o: any) => o.session_id as string),
    ...(individual.error ? [] : (individual.data ?? []).map((o: any) => o.session_id as string)),
  ])
  return (sessions ?? []).filter((s: any) => ready.has(s.id)).map((s: any) => s.calendar_event_id as string)
}

export async function setPrepMessage(sb: SupabaseClient, sessionId: string, text: string | null): Promise<void> {
  const message = text?.trim() ?? ''
  if (message.length > MAX_MESSAGE) throw new Error('INVALID')
  if (!message) {
    const { error } = await sb.from('team_session_prep_notes').delete().eq('session_id', sessionId)
    if (error) rethrow(error, 'remove message')
    return
  }
  const { error } = await sb.from('team_session_prep_notes').upsert({ session_id: sessionId, message, set_at: new Date().toISOString() }, { onConflict: 'session_id' })
  if (error) rethrow(error, 'set message')
}

export async function setPlayerObjectives(sb: SupabaseClient, sessionId: string, playerId: string, value: PlayerObjectivesInput | null): Promise<void> {
  const clean = value ? cleanPlayerObjectives(value) : null
  if (!clean) {
    const { error } = await sb.from('team_session_player_objectives').delete().eq('session_id', sessionId).eq('player_id', playerId)
    if (error) rethrow(error, 'remove player objectives')
    return
  }
  const { error } = await sb.from('team_session_player_objectives').upsert({
    session_id: sessionId, player_id: playerId, objective_ids: clean.objectiveIds, kpi_ids: clean.kpiIds, note: clean.note, set_at: new Date().toISOString(),
  }, { onConflict: 'session_id,player_id' })
  if (error) rethrow(error, 'set player objectives')
}

export async function attachDraft(sb: SupabaseClient, sessionId: string, draft: SessionDraftInput): Promise<string> {
  const d = cleanDraft(draft)
  const row = {
    session_id: sessionId, source_id: d.sourceId, name: d.name, blue_picks: d.bluePicks, blue_bans: d.blueBans,
    red_picks: d.redPicks, red_bans: d.redBans, my_team_side: d.myTeamSide, notes: d.notes,
  }
  // The same source attached again replaces its copy (unique session_id, source_id); a draft without a source is new.
  const query = d.sourceId
    ? sb.from('team_session_drafts').upsert(row, { onConflict: 'session_id,source_id' }).select('id').single()
    : sb.from('team_session_drafts').insert(row).select('id').single()
  const { data, error } = await query
  if (error) rethrow(error, 'attach draft')
  return (data as { id: string }).id
}

/** A shared team draft (team_drafts), copied. */
export async function attachSharedDraft(sb: SupabaseClient, sessionId: string, teamDraftId: string): Promise<string> {
  const [draft, session] = await Promise.all([
    sb.from('team_drafts').select('id, group_id, name, blue_picks, blue_bans, red_picks, red_bans, my_team_side, notes').eq('id', teamDraftId).maybeSingle(),
    sb.from('team_sessions').select('group_id').eq('id', sessionId).maybeSingle(),
  ])
  for (const r of [draft, session]) if (r.error) fail(r.error, 'shared draft')
  const data = draft.data as any
  if (!data || !session.data) throw new Error('NOT_FOUND')
  // CyberSecurity (beta.13): only a draft of the session's own group (the database checks it too).
  if (data.group_id !== (session.data as { group_id: string }).group_id) throw new Error('FORBIDDEN')
  return attachDraft(sb, sessionId, {
    sourceId: `team:${data.id}`, name: data.name, bluePicks: data.blue_picks, blueBans: data.blue_bans, redPicks: data.red_picks, redBans: data.red_bans,
    myTeamSide: data.my_team_side, notes: data.notes,
  })
}

/** A local Draft Sim draft (Prisma DraftPrep: slots as JSON strings), as the desktop reads it. */
export function draftInputFromLocal(d: { id: string; name: string; bluePicks: string; blueBans: string; redPicks: string; redBans: string; myTeamSide: string; notes: string | null }): SessionDraftInput {
  const parse = (s: string): Array<string | string[]> => { try { const v = JSON.parse(s); return Array.isArray(v) ? v : [] } catch { return [] } }
  return {
    sourceId: `local:${d.id}`, name: d.name, bluePicks: parse(d.bluePicks), blueBans: parse(d.blueBans), redPicks: parse(d.redPicks), redBans: parse(d.redBans),
    myTeamSide: d.myTeamSide === 'red' ? 'red' : 'blue', notes: d.notes,
  }
}

export async function removeDraft(sb: SupabaseClient, draftId: string): Promise<void> {
  const { data, error } = await sb.from('team_session_drafts').delete().eq('id', draftId).select('id')
  if (error) rethrow(error, 'remove draft')
  // RLS hides what the reader may not delete: nothing deleted is "not found or not allowed".
  if (!data?.length) throw new Error('NOT_FOUND')
}

export async function reorderDrafts(sb: SupabaseClient, sessionId: string, draftIds: string[]): Promise<void> {
  if (new Set(draftIds).size !== draftIds.length || draftIds.length > 100) throw new Error('INVALID')
  const { data, error } = await sb.from('team_session_drafts').select('id').eq('session_id', sessionId)
  if (error) rethrow(error, 'drafts')
  const ids = (data ?? []).map((r: any) => r.id as string)
  if (ids.length !== draftIds.length || draftIds.some((id) => !ids.includes(id))) throw new Error('INVALID')
  for (const [position, id] of draftIds.entries()) {
    const { error: uErr } = await sb.from('team_session_drafts').update({ position }).eq('id', id).eq('session_id', sessionId)
    if (uErr) rethrow(uErr, 'reorder drafts')
  }
}
