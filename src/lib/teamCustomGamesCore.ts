import type { SupabaseClient } from '@supabase/supabase-js'
import { fail } from './supabaseErrors'

/**
 * #41a: scrim and tournament games of a group (team_custom_games), so the group's players get the Scrim / Tournoi
 * stats the staff imported. Same pattern as teamCore.ts: every member reads, the staff writes (RLS). Desktop only
 * for now (the import reads a Replaybook CSV on the staff's PC).
 */

export type CustomGameType = 'scrim' | 'tournament'

/** A custom game as the desktop stores it locally (Prisma CustomGame), the shape the stats code reads. */
export interface LocalCustomGame {
  id: string
  gameType: string
  gameDate: Date | string | null
  durationSec: number
  win: boolean | null
  participantsJson: string
  sourceFile: string | null
}

interface Row {
  id: string; group_id: string; game_type: CustomGameType; game_date: string | null; duration_sec: number
  win: boolean | null; participants: unknown; source_file: string | null; local_id: string | null; created_at: string
}

const SELECT = 'id, group_id, game_type, game_date, duration_sec, win, participants, source_file, local_id, created_at'

/** A group game in the local shape (id prefixed so it can never collide with a local id). Pure, tested. */
export function fromGroupRow(r: Row, teamId: string): LocalCustomGame & { teamId: string; importedAt: string; notes: null; source: 'group'; localId: string | null } {
  return {
    id: `group:${r.id}`,
    teamId,
    gameType: r.game_type,
    gameDate: r.game_date,
    durationSec: r.duration_sec,
    win: r.win,
    participantsJson: JSON.stringify(Array.isArray(r.participants) ? r.participants : []),
    sourceFile: r.source_file,
    importedAt: r.created_at,
    notes: null,
    source: 'group',
    localId: r.local_id,
  }
}

/**
 * Local games plus the group's, without the group copies of games this PC imported itself (same local id). Pure,
 * tested: what the Scrim / Tournoi stats and the games list read for a team linked to a group.
 */
export function mergeWithGroupGames<L extends { id: string }, G extends { localId: string | null }>(local: L[], group: G[]): Array<L | G> {
  const mine = new Set(local.map((g) => g.id))
  return [...local, ...group.filter((g) => !g.localId || !mine.has(g.localId))]
}

/** Publishes (or re-publishes) a local game to the group. Idempotent on (group_id, local_id). */
export async function publishCustomGame(sb: SupabaseClient, groupId: string, g: LocalCustomGame): Promise<void> {
  let participants: unknown
  try { participants = JSON.parse(g.participantsJson) } catch { participants = [] }
  const gameDate = g.gameDate instanceof Date ? g.gameDate.toISOString() : g.gameDate
  const { error } = await sb.from('team_custom_games').upsert({
    group_id: groupId, game_type: g.gameType, game_date: gameDate, duration_sec: g.durationSec, win: g.win,
    participants, source_file: g.sourceFile, local_id: g.id,
  }, { onConflict: 'group_id,local_id' })
  if (error) fail(error, 'publish custom game')
}

export async function listGroupCustomGames(sb: SupabaseClient, groupId: string, gameType?: CustomGameType): Promise<Row[]> {
  let q = sb.from('team_custom_games').select(SELECT).eq('group_id', groupId)
  if (gameType) q = q.eq('game_type', gameType)
  const { data, error } = await q.order('created_at', { ascending: false }).limit(500)
  if (error) fail(error, 'list custom games')
  return data as Row[]
}

/** Local ids already published to the group (for the one-time backfill of earlier imports). */
export async function listPublishedLocalIds(sb: SupabaseClient, groupId: string): Promise<Set<string>> {
  const { data, error } = await sb.from('team_custom_games').select('local_id').eq('group_id', groupId).not('local_id', 'is', null).limit(2000)
  if (error) fail(error, 'list published custom games')
  return new Set((data as { local_id: string }[]).map((r) => r.local_id))
}

/**
 * Deletes a group game: by its own id (`group:<uuid>`, as listed), or by the local id it was published under in
 * `groupId`. Staff only (RLS: a player's delete removes nothing).
 */
export async function deleteGroupCustomGame(sb: SupabaseClient, id: string, groupId?: string | null): Promise<void> {
  const q = sb.from('team_custom_games').delete()
  if (id.startsWith('group:')) {
    const { error } = await q.eq('id', id.slice('group:'.length))
    if (error) fail(error, 'delete custom game')
    return
  }
  if (!groupId) return
  const { error } = await q.eq('group_id', groupId).eq('local_id', id)
  if (error) fail(error, 'delete custom game')
}
