/**
 * #40 § 11 (docs/DESIGN_STATE.md): the draft log. Pure, shared by the desktop and the web: a draft read from a
 * match-v5 payload, the filters and the summary the screen shows. Storage is in analystCore.ts (table draft_log).
 *
 * Match-v5 gives picks, sides, result and teams[].bans (every ranked, Flex and Clash game in the cache has them;
 * a custom game without draft mode has none: bans are then null). It never gives the pick order: the analyst types it.
 */
import { normalizeRole } from './teamIdentity'
import type { TeamRole } from './team'
import type {
  DraftChampionRow, DraftLogEntry, DraftLogFilters, DraftLogInput, DraftLogSummary, DraftPick, TeamGameSource, TeamSide,
} from './analyst'
import { opponentKeyOf } from './analyst'
import { patchOf } from './teamTimelineCore'

const ROLE_ORDER: TeamRole[] = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT']
const isTeamRole = (r: string): r is TeamRole => (ROLE_ORDER as string[]).includes(r)

/** A draft log row as it is stored, plus the game it came from. */
export interface DraftFromMatch extends DraftLogInput {
  matchId: string
  patch: string | null
  durationSec: number | null
}

/**
 * The draft of a game from our side. `championName(id)` maps a champion id to its name (Data Dragon): bans only
 * carry ids. Picks are ordered top → support when roles are known.
 */
export function draftFromMatch(
  match: any,
  ourTeamId: 100 | 200,
  meta: { matchId: string; source: TeamGameSource; opponentName: string | null },
  championName: (id: number) => string | null,
): DraftFromMatch {
  const info = match?.info ?? {}
  const participants: any[] = info.participants ?? []
  const picksOf = (teamId: number): DraftPick[] => participants
    .filter((p) => p.teamId === teamId)
    .map((p) => {
      const role = normalizeRole(p.teamPosition || p.individualPosition)
      return { champion: String(p.championName ?? championName(p.championId) ?? '?'), role: isTeamRole(role) ? role : null }
    })
    .sort((a, b) => (a.role ? ROLE_ORDER.indexOf(a.role) : 9) - (b.role ? ROLE_ORDER.indexOf(b.role) : 9))
  const bansOf = (teamId: number): string[] | null => {
    const team = (info.teams ?? []).find((t: any) => t.teamId === teamId)
    const ids = ((team?.bans ?? []) as any[])
      .slice()
      .sort((a, b) => (a.pickTurn ?? 0) - (b.pickTurn ?? 0))
      .map((b) => b.championId)
      .filter((id) => typeof id === 'number' && id > 0)
    if (ids.length === 0) return null
    return ids.map((id) => championName(id) ?? String(id))
  }
  const them = ourTeamId === 100 ? 200 : 100
  const ourTeam = (info.teams ?? []).find((t: any) => t.teamId === ourTeamId)
  const win = typeof ourTeam?.win === 'boolean' ? ourTeam.win : participants.find((p) => p.teamId === ourTeamId)?.win ?? null
  const start = info.gameStartTimestamp ?? info.gameCreation
  return {
    matchId: meta.matchId,
    source: meta.source,
    playedAt: typeof start === 'number' ? new Date(start).toISOString() : new Date().toISOString(),
    patch: patchOf(info.gameVersion) || null,
    durationSec: typeof info.gameDuration === 'number' ? info.gameDuration : null,
    opponentName: meta.opponentName,
    side: ourTeamId === 100 ? 'blue' : 'red',
    win: typeof win === 'boolean' ? win : null,
    ourPicks: picksOf(ourTeamId),
    theirPicks: picksOf(them),
    ourBans: bansOf(ourTeamId),
    theirBans: bansOf(them),
  }
}

/** The drafts the filters keep. */
export function filterDrafts(entries: DraftLogEntry[], f: DraftLogFilters): DraftLogEntry[] {
  const champ = f.champion?.trim().toLowerCase() || null
  return entries.filter((d) => {
    if (f.opponentKey && d.opponentKey !== f.opponentKey) return false
    if (f.sources && f.sources.length > 0 && !f.sources.includes(d.source)) return false
    if (f.side && f.side !== 'both' && d.side !== f.side) return false
    if (f.patch && d.patch !== f.patch) return false
    if (f.result === 'win' && d.win !== true) return false
    if (f.result === 'loss' && d.win !== false) return false
    if (champ) {
      const names = [...d.ourPicks, ...d.theirPicks].map((p) => p.champion).concat(d.ourBans ?? [], d.theirBans ?? [])
      if (!names.some((n) => n.toLowerCase() === champ)) return false
    }
    return true
  })
}

const rate = (wins: number, games: number): number | null => (games ? wins / games : null)

function championRows(entries: DraftLogEntry[], side: 'ours' | 'theirs'): DraftChampionRow[] {
  const rows = new Map<string, DraftChampionRow & { roles: Map<string, number> }>()
  for (const d of entries) {
    const picks = side === 'ours' ? d.ourPicks : d.theirPicks
    for (const p of picks) {
      const row = rows.get(p.champion) ?? { champion: p.champion, games: 0, wins: 0, winRate: null, role: null, roles: new Map() }
      row.games++
      // For their picks, a "win" is theirs: we lost.
      if (d.win !== null && (side === 'ours' ? d.win : !d.win)) row.wins++
      if (p.role) row.roles.set(p.role, (row.roles.get(p.role) ?? 0) + 1)
      rows.set(p.champion, row)
    }
  }
  return [...rows.values()]
    .map(({ roles, ...r }) => ({
      ...r,
      winRate: rate(r.wins, r.games),
      role: ([...roles.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null) as TeamRole | null,
    }))
    .sort((a, b) => b.games - a.games || a.champion.localeCompare(b.champion))
}

/**
 * The first pick of a draft with a typed pick order: true when ours. Blue picks 1st, 4th, 5th, 8th and 9th in
 * B1 R1 R2 B2 B3 R3 R4 B4 B5 R5, so the first name of the order is blue's.
 */
export function weHadFirstPick(d: DraftLogEntry): boolean | null {
  if (!d.pickOrder || d.pickOrder.length === 0) return null
  return d.side === 'blue'
}

/** The summary tiles and the champion tables of the screen, for the drafts given (already filtered). */
export function summarizeDrafts(entries: DraftLogEntry[]): DraftLogSummary {
  const known = entries.filter((d) => d.win !== null)
  const wins = known.filter((d) => d.win).length
  const sideStat = (side: TeamSide) => {
    const s = known.filter((d) => d.side === side)
    const w = s.filter((d) => d.win).length
    return { share: rate(w, s.length), games: s.length, wins: w }
  }
  const withOrder = known.filter((d) => weHadFirstPick(d) === true)
  const fpWins = withOrder.filter((d) => d.win).length
  const banned = new Map<string, number>()
  for (const d of entries) for (const b of d.theirBans ?? []) banned.set(b, (banned.get(b) ?? 0) + 1)
  return {
    count: entries.length,
    wins,
    losses: known.length - wins,
    blue: sideStat('blue'),
    red: sideStat('red'),
    ourFirstPick: entries.some((d) => d.pickOrder && d.pickOrder.length > 0)
      ? { share: rate(fpWins, withOrder.length), games: withOrder.length, wins: fpWins }
      : null,
    bannedAgainstUs: [...banned.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3).map(([champion, count]) => ({ champion, count })),
    ourPicks: championRows(entries, 'ours'),
    theirPicks: championRows(entries, 'theirs'),
  }
}

/** The opponent key of a draft input (null without a name). */
export const draftOpponentKey = (name: string | null | undefined): string | null => (name && name.trim() ? opponentKeyOf(name) : null)
