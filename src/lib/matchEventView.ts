/**
 * #49, scrims in the Planning (docs/DESIGN_STATE.md § 13, contract docs/CONTRAT_SCRIMS_PLANNING.md): the pop-up's
 * Scrim / Officiel state and pure helpers between the screens and the contract (src/lib/matchEvent.ts). Pure, tested.
 */
import { parseMultiGgUrl } from './multiGgParser'
import {
  DEFAULT_MATCH_MINUTES, MATCH_ERROR_CODES, OPPONENT_ROLES, matchKindOf,
  type BoFormat, type MatchEventDetail, type MatchInput, type MatchSummary, type OpponentRole,
} from './matchEvent'

export { OPPONENT_ROLES }
export type { BoFormat, OpponentRole }

/** TOP / JGL / MID / ADC / SUP on screen; the contract's values are sent. */
export const ROLE_SHORT: Record<OpponentRole, string> = { TOP: 'TOP', JUNGLE: 'JGL', MID: 'MID', ADC: 'ADC', SUPPORT: 'SUP' }

/** "18:00" + Bo3 → "20:30" in minutes since midnight (capped at 24:00, the pop-up's last slot). */
export function endMinFor(startMin: number, bo: BoFormat): number {
  return Math.min(startMin + DEFAULT_MATCH_MINUTES[bo], 1440)
}

/** One opponent line: role, Riot ID, its region (from a pasted link), and its check. */
export interface OpponentRow {
  role: OpponentRole
  riotId: string
  region: string | null
  status: 'empty' | 'checking' | 'found' | 'not_found'
}

export const emptyOpponents = (): OpponentRow[] => OPPONENT_ROLES.map((role) => ({ role, riotId: '', region: null, status: 'empty' }))

/** "Name#TAG": 3-16 characters, then a 2-5 character tag. */
export const isRiotIdShape = (s: string): boolean => /^[^#]{3,16}#[A-Za-z0-9]{2,5}$/.test(s.trim())

/**
 * Fills the opponent lines from a pasted OP.GG / Blitz / … multi link (multiGgParser), in order, keeping each line's
 * role; the lines past the parsed players keep what they had. Null when nothing could be read.
 */
export function opponentsFromMultiLink(link: string, current: OpponentRow[]): OpponentRow[] | null {
  const parsed = parseMultiGgUrl(link)
  if (parsed.players.length === 0) return null
  return current.map((row, i) => {
    const p = parsed.players[i]
    return p ? { ...row, riotId: `${p.gameName}#${p.tagLine}`, region: p.region || parsed.inferredRegion || null, status: 'empty' as const } : row
  })
}

/** One of our five slots: the role, the player (a starter, or a substitute picked in the menu), their availability. */
export interface RosterSlot {
  role: OpponentRole
  userId: string | null
  name: string | null
  /** Free on that slot (availability rules and exceptions); null when unknown. */
  available: boolean | null
}

export const availableCount = (slots: RosterSlot[]): number => slots.filter((s) => s.userId && s.available).length

/** The pop-up's Scrim / Officiel state. */
export interface MatchDraft {
  bo: BoFormat
  opponentMode: 'known' | 'new'
  /** The known opponent's key (KnownOpponent.key) when « Équipe connue ». */
  knownKey: string | null
  name: string
  tag: string
  multiLink: string
  opponents: OpponentRow[]
  roster: RosterSlot[]
}

export const emptyMatchDraft = (roster: RosterSlot[]): MatchDraft => ({
  bo: 'bo3', opponentMode: 'new', knownKey: null, name: '', tag: '', multiLink: '', opponents: emptyOpponents(), roster,
})

/** § 13 validation: the name is required, the tag (optional) is 2-5 characters. An unknown Riot ID never blocks. */
export function matchDraftErrors(d: Pick<MatchDraft, 'name' | 'tag'>): { name?: 'required'; tag?: 'length' } {
  const out: { name?: 'required'; tag?: 'length' } = {}
  if (!d.name.trim()) out.name = 'required'
  const tag = d.tag.trim()
  if (tag && (tag.length < 2 || tag.length > 5)) out.tag = 'length'
  return out
}

/** The draft as the contract's MatchInput (empty Riot IDs dropped, the pasted link only when it is https). */
export function toMatchInput(d: MatchDraft): MatchInput {
  const players = d.opponents
    .filter((o) => o.riotId.trim())
    .map((o) => ({ role: o.role, riotId: o.riotId.trim(), region: o.region }))
  const link = d.multiLink.trim()
  return {
    boFormat: d.bo,
    opponent: d.name.trim()
      ? { name: d.name.trim(), tag: d.tag.trim() || null, opggUrl: /^https:\/\//i.test(link) ? link : null, players }
      : null,
  }
}

/** The pop-up's state for an existing match (edit): its format, opponent and our attendees in their slots. */
export function draftFromDetail(detail: MatchEventDetail, roster: RosterSlot[]): MatchDraft {
  const o = detail.opponent
  return {
    bo: detail.boFormat ?? 'bo3',
    opponentMode: o ? 'known' : 'new',
    knownKey: o?.key ?? null,
    name: o?.name ?? '',
    tag: o?.tag ?? '',
    multiLink: o?.source === 'match' && o.opggUrl ? o.opggUrl : '',
    opponents: OPPONENT_ROLES.map((role) => {
      const p = o?.players.find((x) => x.role === role)
      return { role, riotId: p?.riotId ?? '', region: p?.region ?? null, status: p?.riotId ? 'found' as const : 'empty' as const }
    }),
    roster,
  }
}

/** The grid card's badge: « vs Karmine Academy · BO3 » (null for a match without a known opponent). */
export function matchBadgeText(m: Pick<MatchSummary, 'opponentName' | 'boFormat'>): string | null {
  const who = m.opponentName?.trim()
  if (!who) return m.boFormat ? m.boFormat.toUpperCase() : null
  return m.boFormat ? `vs ${who} · ${m.boFormat.toUpperCase()}` : `vs ${who}`
}

/**
 * The #49 server side (functions, the scrims.calendar_event_id column, tables) arrives with a migration that may not be
 * live yet: a missing function (PostgREST PGRST202, Postgres 42883), table (PGRST205, 42P01) or column (PGRST204,
 * 42703) reads as « arrive avec la prochaine mise à jour du serveur », not as a generic error.
 */
export function isServerNotReadyError(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown } | null
  const code = typeof e?.code === 'string' ? e.code : ''
  const msg = typeof e?.message === 'string' ? e.message : err instanceof Error ? err.message : String(err ?? '')
  return ['PGRST202', 'PGRST204', 'PGRST205', '42883', '42P01', '42703'].includes(code)
    || /PGRST20[245]|42883|42P01|42703|could not find the (function|table)|could not find the '[^']+' column|(function|relation|column) [^ ]+ does not exist/i.test(msg)
}

/** The i18n key for a #49 error: server not ready, one of the contract's codes, else `fallback`. */
export function matchErrorKey(err: unknown, fallback = 'planning.match.errors.generic'): string {
  if (isServerNotReadyError(err)) return 'planning.match.errors.notDeployed'
  const msg = (err as Error)?.message ?? ''
  const code = MATCH_ERROR_CODES.find((c) => msg.includes(c))
  return code ? `planning.match.errors.${code}` : fallback
}

/**
 * The panel's role select (contract § 2, opponentRoles): giving `riotId` the role `role`. When another opponent holds
 * that role, the two swap, in the same patch. Empty when nothing changes or the Riot ID is not one of the players.
 */
export function opponentRoleChange(
  players: ReadonlyArray<{ role: OpponentRole; riotId: string | null }>, riotId: string, role: OpponentRole,
): Array<{ riotId: string; role: OpponentRole }> {
  const me = players.find((p) => p.riotId === riotId)
  if (!me || me.role === role) return []
  const holder = players.find((p) => p.role === role && p.riotId && p.riotId !== riotId)
  return holder?.riotId ? [{ riotId, role }, { riotId: holder.riotId, role: me.role }] : [{ riotId, role }]
}

/** The detail with opponentRoles applied (the panel's optimistic update), opponents kept in role order. */
export function applyOpponentRoles(detail: MatchEventDetail, roles: ReadonlyArray<{ riotId: string; role: OpponentRole }>): MatchEventDetail {
  if (!detail.opponent || roles.length === 0) return detail
  const players = detail.opponent.players
    .map((p) => ({ ...p, role: roles.find((r) => r.riotId === p.riotId)?.role ?? p.role }))
    .sort((a, b) => OPPONENT_ROLES.indexOf(a.role) - OPPONENT_ROLES.indexOf(b.role))
  return { ...detail, opponent: { ...detail.opponent, players } }
}

/** « Créer le scrim » / « Créer le match officiel » key for a match kind. */
export const createLabelKey = (kind: 'scrim' | 'tournament'): string =>
  matchKindOf(kind) === 'official' ? 'planning.match.createOfficial' : 'planning.match.createScrim'
