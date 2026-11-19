/**
 * #49, scrims planned from the Planning (supabase/migrations/20261120120000_scrims_in_planning.sql,
 * docs/PROPOSITION_SCRIMS_PLANNING.md, mockup docs/DESIGN_STATE.md section 13). The contract shared by the desktop
 * (IPC), the web adapter and the screens: types, the API surface, and small pure helpers.
 *
 * A calendar slot of kind 'scrim' or 'tournament' (shown "Officiel") is a match. Its detail lives in a `scrims` row,
 * its opponent in the group's scouting (team_scouting), identified by `opponentKey` (analyst.ts opponentKeyOf).
 */
import type { AttendeeScope, CalendarEvent, CalendarEventKind } from './calendar'
import { buildOpggMultiUrl, buildOpggUrl } from './opgg'

/** The calendar kinds that are matches. */
export type MatchEventKind = Extract<CalendarEventKind, 'scrim' | 'tournament'>
/** What the scrim row calls them. */
export type MatchKind = 'scrim' | 'official'
export type BoFormat = 'bo1' | 'bo3' | 'bo5'
/** Roles as team_rosters stores them (same as the desktop's TeamRole). */
export type OpponentRole = 'TOP' | 'JUNGLE' | 'MID' | 'ADC' | 'SUPPORT'
export type MatchStatus = 'planned' | 'done' | 'cancelled'

export const OPPONENT_ROLES: OpponentRole[] = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT']
export const BO_FORMATS: BoFormat[] = ['bo1', 'bo3', 'bo5']

/**
 * CHOICE 1 (confirmed by the user, 20/11/2026): "Officiel" is the existing kind 'tournament'. Mirrors
 * private.match_kind_of in the migration: change both together.
 */
export function matchKindOf(kind: CalendarEventKind): MatchKind | null {
  return kind === 'scrim' ? 'scrim' : kind === 'tournament' ? 'official' : null
}
export const isMatchKind = (kind: CalendarEventKind): kind is MatchEventKind => matchKindOf(kind) !== null

/** The mockup's default length per format (minutes), recomputed when the format is picked, editable after. */
export const DEFAULT_MATCH_MINUTES: Record<BoFormat, number> = { bo1: 60, bo3: 150, bo5: 240 }

/** What the grid shows on a match card without loading the detail (CalendarEvent.match). */
export interface MatchSummary {
  scrimId: string
  kind: MatchKind
  opponentName: string | null
  opponentKey: string | null
  boFormat: BoFormat | null
  status: MatchStatus
}

export interface MatchEventInput {
  /** Absent to create the slot, set to edit it. */
  id?: string
  kind: MatchEventKind
  title: string
  startsAt: string
  endsAt: string
  notes?: string | null
  attendeeScope?: AttendeeScope
  /** Our 5 players (the mockup's "Notre roster"). Omitted on an edit: the attendees stay as they are. */
  attendeeUserIds?: string[]
}

export interface MatchOpponentPlayerInput {
  role: OpponentRole
  /** "Name#TAG", or null/empty when unknown (a slot can be created with 0 to 5 known players). */
  riotId?: string | null
  /** Riot platform (EUW1, NA1, ...), for the OP.GG links. */
  region?: string | null
}

export interface MatchOpponentInput {
  /** 1 to 80 characters. Its key (spaces and case ignored) finds the team already scouted. */
  name: string
  tag?: string | null
  /** A multi-search link from op.gg, blitz.gg, u.gg, porofessor.gg, deeplol.gg, mobalytics.gg or leagueofgraphs.com (https). */
  opggUrl?: string | null
  /** At most 5, one per role. */
  players?: MatchOpponentPlayerInput[]
}

export interface MatchInput {
  boFormat?: BoFormat | null
  /** null: a match without a known opponent. */
  opponent?: MatchOpponentInput | null
}

export interface MatchOpponentPlayer {
  role: OpponentRole
  riotId: string | null
  region: string | null
  /** The player's OP.GG page, null without a full Riot ID and a known region. */
  opggUrl: string | null
}

export interface MatchOpponent {
  key: string
  name: string
  tag: string | null
  /** The link pasted by the staff, else one built from the players' Riot IDs (null when none is known). */
  opggUrl: string | null
  /** 'match': created from a slot, 'publish': published from the desktop's Team page. */
  source: 'publish' | 'match'
  players: MatchOpponentPlayer[]
  /** A published dossier (#40) exists for this opponent. False before that feature reaches the database. */
  hasDossier: boolean
}

export interface MatchChecklistItem { label: string; done: boolean }

/** The detail panel (mockup section 13.2). */
export interface MatchEventDetail {
  event: CalendarEvent
  scrimId: string
  kind: MatchKind
  boFormat: BoFormat | null
  status: MatchStatus
  opponent: MatchOpponent | null
  prepNotes: string | null
  reviewNotes: string | null
  checklist: MatchChecklistItem[]
  /** DraftPrep ids (team_drafts) linked to the scrim. */
  draftIds: string[]
}

export interface MatchDetailPatch {
  prepNotes?: string | null
  reviewNotes?: string | null
  checklist?: MatchChecklistItem[]
  draftIds?: string[]
  status?: MatchStatus
  /**
   * The roles of this scrim's opponent players, from the detail panel (MatchOpponentPlayer.riotId, "Name#TAG").
   * Only those players' roles change, nothing else of the scouted team. At most 5, each role and each Riot ID once
   * (two players may swap). A Riot ID that is not one of the opponent's players: INVALID_DETAIL, nothing written.
   */
  opponentRoles?: Array<{ riotId: string; role: OpponentRole }>
}

/** The "Équipe connue" select of the pop-up: the group's scouted teams, newest match first. */
export interface KnownOpponent {
  key: string
  name: string
  tag: string | null
  opggUrl: string | null
  /** Start of the latest match against them, null if never played. */
  lastMatchAt: string | null
  players: MatchOpponentPlayer[]
}

/** Error codes the screens translate (everything else is a generic error). */
export const MATCH_ERROR_CODES = ['FORBIDDEN', 'NOT_FOUND', 'INVALID_KIND', 'INVALID_EVENT', 'INVALID_OPPONENT', 'INVALID_DETAIL'] as const
export type MatchErrorCode = typeof MATCH_ERROR_CODES[number]

/**
 * Desktop (IPC) and web adapter. Optional: absent on a build without #49, and their calls fail with a generic error
 * until the migration reaches the database.
 */
export interface MatchEventApi {
  /** Creates or edits the slot, its attendees, the scrim and the opponent at once. Returns the slot's id. */
  calendarSaveMatchEvent?: (groupId: string, event: MatchEventInput, match: MatchInput) => Promise<string>
  /** Null when the slot does not exist or is not a match. */
  calendarGetMatchEvent?: (calendarEventId: string) => Promise<MatchEventDetail | null>
  calendarUpdateMatchDetail?: (scrimId: string, patch: MatchDetailPatch) => Promise<void>
  calendarListKnownOpponents?: (groupId: string) => Promise<KnownOpponent[]>
  /**
   * Whether an opponent's Riot ID ("Name#TAG") exists on that platform (EUW1, NA1, ...): "✓ trouvé" / "Introuvable"
   * in the pop-up, checked when the field loses focus. { exists: false } for no such account or a value without a
   * tag. Throws on anything else (rate limit, offline): show "—" then. src/lib/riotAccountCheck.ts.
   */
  riotAccountExists?: (riotId: string, region: string) => Promise<{ exists: boolean; puuid?: string }>
}

/** "Name#TAG" → [name, tag]; the tag is cut at the last '#'. Null for an empty value. */
export function splitRiotIdInput(riotId: string | null | undefined): [string, string | null] | null {
  const v = (riotId ?? '').trim()
  if (!v) return null
  const i = v.lastIndexOf('#')
  if (i < 0) return [v, null]
  const name = v.slice(0, i).trim()
  const tag = v.slice(i + 1).trim()
  return name ? [name, tag || null] : null
}

/** One opponent player as the screens show it, from a team_rosters row. */
export function toOpponentPlayer(role: OpponentRole, ign: string | null, tagLine: string | null, region: string | null): MatchOpponentPlayer {
  return {
    role,
    riotId: ign ? (tagLine ? `${ign}#${tagLine}` : ign) : null,
    region,
    opggUrl: buildOpggUrl(ign, tagLine, region),
  }
}

/** The pasted link, else a multi-search built from the players (their first known region). */
export function opponentOpggUrl(pasted: string | null, players: MatchOpponentPlayer[]): string | null {
  if (pasted) return pasted
  const region = players.find((p) => p.region)?.region ?? null
  const named = players.map((p) => splitRiotIdInput(p.riotId)).filter((x): x is [string, string | null] => !!x && !!x[1])
  return buildOpggMultiUrl(named.map(([ign, tagLine]) => ({ ign, tagLine: tagLine as string })), region)
}
