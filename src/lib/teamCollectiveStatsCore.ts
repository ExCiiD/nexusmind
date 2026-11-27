/**
 * Collective stats of a team session (user decision 27/11/2026): what the team did together, per game and over the
 * session. Pure, shared by the desktop and the web, like playerSessionStatsCore.ts, whose geometry (isolation, respawn
 * delay) and timeline types it reuses so the "isolated deaths" figures are the same everywhere.
 *
 * Nothing here calls Riot: it reads the cached match (`match_json`) and the cached timeline summary. A figure that
 * needs the timeline is `null` when the game has none (never 0); the totals taken from the match still work.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { fail } from './supabaseErrors'
import { resolveOurTeamId } from './matchSide'
import { isCurrentTimeline, hasCurrentPlayers, hasWardEvents, hasObjectiveRules } from './teamTimelineCore'
import { ruleCountsOf, sumRuleCounts, type RuleCounts } from './objectiveRuleFigures'
import { MIN_GAME_SECONDS } from './weeklyAwardsCore'
import type { TeamGameTimeline } from './analyst'
import {
  EARLY_DEATH_LIMIT_MS, isIsolated,
  type ObjectiveKind, type PlayerGameInput, type TimelineKillEvent, type TimelineObjectiveEvent, type TimelinePlayers,
} from './playerSessionStatsCore'
import { matchParticipantToMember, participantName, type RiotIdMember, type RiotMatchParticipant } from './teamSessionStatsCore'

// ── Thresholds (tunable here only) ──────────────────────────────────────────────────────────────────────────────

/** Our lead (gold) at 15:00 from which a loss counts as "lost while ahead". */
export const LEAD_AHEAD_GOLD = 1500
/** Kills closer than this belong to the same fight. */
export const FIGHT_GAP_MS = 20_000
/** A fight is won with at least this many kills net (ours minus theirs). */
export const FIGHT_WON_NET_KILLS = 2
/** An objective taken within this delay after the fight's last kill converts the fight. */
export const CONVERSION_WINDOW_MS = 90_000
/** Wards of the team placed / cleared this long before an objective are its "setup". */
export const SETUP_WINDOW_MS = 60_000
/** A lost objective is "contested" when one of our kills happened within this delay of it. */
export const CONTEST_WINDOW_MS = 30_000
/** Phases of the game for the deaths: before 14:00, 14:00 to 25:00, after. */
export const MID_GAME_LIMIT_MS = 25 * 60_000
/** Duration buckets of the win rate (seconds). */
export const SHORT_GAME_SEC = 25 * 60
export const LONG_GAME_SEC = 35 * 60

// ── Types ───────────────────────────────────────────────────────────────────────────────────────────────────────

export interface Pair { ours: number; theirs: number }
export type FirstOwner = 'us' | 'them' | null
export type DragonType = 'fire' | 'water' | 'earth' | 'air' | 'hextech' | 'chemtech' | 'other'
export const DRAGON_TYPES: readonly DragonType[] = ['fire', 'water', 'earth', 'air', 'hextech', 'chemtech', 'other']

export interface CollectiveObjectives {
  /** 'timeline': counted from the events (dragon types and elder known); 'match': the match's team totals only. */
  source: 'timeline' | 'match'
  /** Elemental dragons (the elder is apart when the source is the timeline; in the match totals it may be included). */
  dragons: Pair
  dragonsByType: Record<DragonType, Pair> | null
  elder: Pair | null
  grubs: Pair
  herald: Pair
  baron: Pair
  towers: Pair
  firsts: { blood: FirstOwner; tower: FirstOwner; dragon: FirstOwner; herald: FirstOwner }
}

export interface GoldLead {
  /** Our team's gold minus theirs at 10 / 15 / 20 min; null when the game was shorter or has no timeline. */
  at10: number | null
  at15: number | null
  at20: number | null
  /** Lead of LEAD_AHEAD_GOLD or more at 15:00, then a loss. Null when the lead at 15 is unknown. */
  lostWhileAhead: boolean | null
  /** Lead of LEAD_AHEAD_GOLD or more at 15:00. */
  ahead15: boolean | null
}

export interface FightItem { atSec: number; kills: number; deaths: number; objective: ObjectiveKind | null; delaySec: number | null }
export interface Conversion { fightsWon: number; converted: number; items: FightItem[] }

export type SetupOutcome = 'taken' | 'lost' | 'contested'
export interface SetupItem { kind: 'dragon' | 'elder' | 'baron' | 'herald'; atSec: number; wardsPlaced: number; wardsCleared: number; outcome: SetupOutcome }
export interface Setup { items: SetupItem[] }

export interface DeathPhase { isolated: number; grouped: number; /** No position to judge. */ unknown: number }
export interface DeathBreakdown { early: DeathPhase; mid: DeathPhase; late: DeathPhase; total: number }

export interface PlayerKp { memberId: string; displayName: string; kpPct: number; gapPct: number }

export interface GameCollective {
  gameId: string
  gameIndex: number
  win: boolean
  /** A remake (under 5 minutes or an early surrender vote): kept in `games`, left out of every session figure. */
  remake: boolean
  durationSec: number
  side: 'blue' | 'red'
  timeline: 'ready' | 'no-players' | 'no-timeline'
  objectives: CollectiveObjectives
  goldLead: GoldLead | null
  conversion: Conversion | null
  /** Null without ward events (summaries cached before they were kept) or without a timeline. */
  setup: Setup | null
  deaths: DeathBreakdown | null
  /** Prio / crossmap / duo of the whole team in this game (objectiveRuleFigures.ts). Null without the block. */
  rules: RuleCounts | null
  kp: PlayerKp[]
}

export interface WinCount { games: number; wins: number }

export interface SessionCollective {
  /** Every game, remakes included (flagged). */
  games: GameCollective[]
  /** Games in the figures below: remakes are out. */
  gamesCounted: number
  remakes: number
  gamesWithTimeline: number
  objectives: {
    dragons: Pair; dragonsByType: Record<DragonType, Pair>; elder: Pair; grubs: Pair; herald: Pair; baron: Pair; towers: Pair
    /** Games where we got the first blood / tower / dragon / herald, and where they did. */
    firsts: Record<'blood' | 'tower' | 'dragon' | 'herald', { us: number; them: number; games: number }>
  }
  goldLead: { avgAt10: number | null; avgAt15: number | null; avgAt20: number | null; ahead15: number; lostWhileAhead: number; gamesJudged: number }
  conversion: { fightsWon: number; converted: number; ratePct: number | null }
  setup: {
    games: number
    byKind: Array<{ kind: SetupItem['kind']; taken: number; lost: number; contested: number; avgWardsTaken: number | null; avgWardsLost: number | null }>
  } | null
  deaths: DeathBreakdown | null
  /** Sum of the counted games' team figures; null when no game has the block. */
  rules: RuleCounts | null
  kp: Array<{ memberId: string; displayName: string; games: number; kpPct: number; gapPct: number }>
  bySide: { blue: WinCount; red: WinCount }
  byDuration: { short: WinCount; medium: WinCount; long: WinCount }
}

// ── Reading the match ───────────────────────────────────────────────────────────────────────────────────────────

type Part = RiotMatchParticipant & { participantId?: number }
interface MatchTeam {
  teamId?: number
  objectives?: Record<string, { first?: boolean; kills?: number } | undefined>
}

const zeroPair = (): Pair => ({ ours: 0, theirs: 0 })
const emptyTypes = (): Record<DragonType, Pair> => Object.fromEntries(DRAGON_TYPES.map((t) => [t, zeroPair()])) as Record<DragonType, Pair>
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

function dragonType(subType: string | undefined): DragonType {
  const t = (subType ?? '').toLowerCase()
  return (DRAGON_TYPES as readonly string[]).includes(t) && t !== 'other' ? (t as DragonType) : 'other'
}

function fromMatchTotals(teams: MatchTeam[], us: 100 | 200): CollectiveObjectives {
  const mine = teams.find((t) => t.teamId === us)?.objectives ?? {}
  const theirs = teams.find((t) => t.teamId !== us && (t.teamId === 100 || t.teamId === 200))?.objectives ?? {}
  const pair = (key: string): Pair => ({ ours: num(mine[key]?.kills), theirs: num(theirs[key]?.kills) })
  const first = (key: string): FirstOwner => (mine[key]?.first ? 'us' : theirs[key]?.first ? 'them' : null)
  return {
    source: 'match', dragons: pair('dragon'), dragonsByType: null, elder: null, grubs: pair('horde'), herald: pair('riftHerald'),
    baron: pair('baron'), towers: pair('tower'),
    firsts: { blood: first('champion'), tower: first('tower'), dragon: first('dragon'), herald: first('riftHerald') },
  }
}

function fromTimeline(tp: TimelinePlayers, teams: MatchTeam[], us: 100 | 200): CollectiveObjectives {
  const base = fromMatchTotals(teams, us)
  const events = tp.objectives ?? []
  const count = (kind: ObjectiveKind): Pair => {
    const p = zeroPair()
    for (const e of events) if (e.kind === kind) { if (e.teamId === us) p.ours++; else p.theirs++ }
    return p
  }
  const byType = emptyTypes()
  for (const e of events) if (e.kind === 'dragon') byType[dragonType(e.subType)][e.teamId === us ? 'ours' : 'theirs']++
  // The match totals keep the first-blood / first-tower / first-dragon / first-herald flags (not in the events).
  return {
    ...base, source: 'timeline', dragons: count('dragon'), dragonsByType: byType, elder: count('elder'), grubs: count('grubs'),
    herald: count('herald'), baron: count('baron'), towers: count('tower'),
  }
}

// ── Timeline figures ────────────────────────────────────────────────────────────────────────────────────────────

function teamGoldAt(tp: TimelinePlayers, team: 100 | 200, minute: number): number | null {
  const rows = tp.players.filter((p) => p.teamId === team)
  if (rows.length === 0) return null
  let total = 0
  for (const r of rows) {
    const g = r.gold[minute]
    if (typeof g !== 'number') return null
    total += g
  }
  return total
}

function leadAt(tp: TimelinePlayers, us: 100 | 200, minute: number): number | null {
  const a = teamGoldAt(tp, us, minute), b = teamGoldAt(tp, us === 100 ? 200 : 100, minute)
  return a === null || b === null ? null : a - b
}

export function buildGoldLead(tp: TimelinePlayers, us: 100 | 200, win: boolean): GoldLead {
  const at10 = leadAt(tp, us, 10), at15 = leadAt(tp, us, 15), at20 = leadAt(tp, us, 20)
  const ahead15 = at15 === null ? null : at15 >= LEAD_AHEAD_GOLD
  return { at10, at15, at20, ahead15, lostWhileAhead: ahead15 === null ? null : ahead15 && !win }
}

const teamOfPid = (tp: TimelinePlayers, pid: number): number | null => tp.players.find((p) => p.pid === pid)?.teamId ?? null

/** Fights won (>= FIGHT_WON_NET_KILLS net) and whether an objective of ours followed within CONVERSION_WINDOW_MS. */
export function buildConversion(tp: TimelinePlayers, us: 100 | 200): Conversion {
  const kills = [...tp.kills].sort((a, b) => a.t - b.t)
  const fights: TimelineKillEvent[][] = []
  for (const k of kills) {
    const last = fights[fights.length - 1]
    if (last && k.t - last[last.length - 1].t <= FIGHT_GAP_MS) last.push(k)
    else fights.push([k])
  }
  const ours = (tp.objectives ?? []).filter((o) => o.teamId === us)
  const items: FightItem[] = []
  for (const f of fights) {
    const ourKills = f.filter((k) => teamOfPid(tp, k.victim) !== us && teamOfPid(tp, k.victim) !== null).length
    const ourDeaths = f.filter((k) => teamOfPid(tp, k.victim) === us).length
    if (ourKills - ourDeaths < FIGHT_WON_NET_KILLS) continue
    const end = f[f.length - 1].t
    const next = ours.find((o) => o.t > end - 1 && o.t <= end + CONVERSION_WINDOW_MS)
    items.push({
      atSec: Math.round(end / 1000), kills: ourKills, deaths: ourDeaths,
      objective: next?.kind ?? null, delaySec: next ? Math.round((next.t - end) / 1000) : null,
    })
  }
  return { fightsWon: items.length, converted: items.filter((i) => i.objective).length, items }
}

/** The vision the team put down before each dragon / elder / baron / herald, and how it went. Null without ward events. */
export function buildSetup(tp: TimelinePlayers, us: 100 | 200): Setup | null {
  if (!tp.wards || !tp.objectives) return null
  const wards = tp.wards
  const ourKillTimes = tp.kills.filter((k) => teamOfPid(tp, k.killer) === us).map((k) => k.t)
  const items: SetupItem[] = []
  for (const o of tp.objectives as TimelineObjectiveEvent[]) {
    if (o.kind !== 'dragon' && o.kind !== 'elder' && o.kind !== 'baron' && o.kind !== 'herald') continue
    const inWindow = (w: { t: number }) => w.t >= o.t - SETUP_WINDOW_MS && w.t < o.t
    const taken = o.teamId === us
    const fought = ourKillTimes.some((t) => Math.abs(t - o.t) <= CONTEST_WINDOW_MS)
    items.push({
      kind: o.kind, atSec: Math.round(o.t / 1000),
      wardsPlaced: wards.filter((w) => w.kind === 'place' && inWindow(w)).length,
      wardsCleared: wards.filter((w) => w.kind === 'clear' && inWindow(w)).length,
      outcome: taken ? 'taken' : fought ? 'contested' : 'lost',
    })
  }
  return { items }
}

const emptyPhase = (): DeathPhase => ({ isolated: 0, grouped: 0, unknown: 0 })

/** Our deaths by phase, isolated (same rule as the player sheets: isIsolated, ISOLATION_DISTANCE) or grouped. */
export function buildDeathBreakdown(tp: TimelinePlayers, ourPids: number[]): DeathBreakdown {
  const out: DeathBreakdown = { early: emptyPhase(), mid: emptyPhase(), late: emptyPhase(), total: 0 }
  for (const k of tp.kills) {
    if (!ourPids.includes(k.victim)) continue
    const phase = k.t < EARLY_DEATH_LIMIT_MS ? out.early : k.t < MID_GAME_LIMIT_MS ? out.mid : out.late
    const iso = k.x === null || k.y === null ? null : isIsolated(tp, ourPids, k.victim, k.t, k.x, k.y)
    if (iso === null) phase.unknown++
    else if (iso) phase.isolated++
    else phase.grouped++
    out.total++
  }
  return out
}

// ── One game ────────────────────────────────────────────────────────────────────────────────────────────────────

export interface CollectiveContext {
  members: RiotIdMember[]
}

/** The collective figures of one game, or null when the cached match is unusable (no side, no participants). */
export function buildGameCollective(g: PlayerGameInput, gameIndex: number, members: RiotIdMember[]): GameCollective | null {
  const match = g.matchJson as { info?: { participants?: Part[]; gameDuration?: number; teams?: MatchTeam[] } } | null
  const participants = match?.info?.participants
  const durationSec = match?.info?.gameDuration
  if (!Array.isArray(participants) || typeof durationSec !== 'number' || durationSec <= 0) return null
  const us = g.ourTeamId ?? resolveOurTeamId(participants, members.map((m) => m.riotId ?? '').filter(Boolean))
  if (us !== 100 && us !== 200) return null
  const ours = participants.filter((p) => p.teamId === us)
  if (ours.length === 0) return null
  const teams = match?.info?.teams ?? []
  const summary = isCurrentTimeline(g.timelineSummary) ? (g.timelineSummary as TeamGameTimeline) : null
  const tp = summary?.players ?? null
  const timeline: GameCollective['timeline'] = summary ? (hasCurrentPlayers(summary) ? 'ready' : 'no-players') : 'no-timeline'
  const ready = timeline === 'ready' && tp ? tp : null
  const win = !!ours[0].win
  const remake = durationSec < MIN_GAME_SECONDS || participants.some((p) => (p as { gameEndedInEarlySurrender?: boolean }).gameEndedInEarlySurrender === true)
  const ourPids = ours.map((p) => p.participantId).filter((n): n is number => typeof n === 'number')

  const teamKills = ours.reduce((s, p) => s + num(p.kills), 0)
  const kpOf = (p: Part) => (teamKills > 0 ? ((num(p.kills) + num(p.assists)) / teamKills) * 100 : 0)
  const teamAvg = ours.reduce((s, p) => s + kpOf(p), 0) / ours.length
  const kp: PlayerKp[] = []
  for (const p of ours) {
    const m = matchParticipantToMember(p, members)
    if (!m) continue
    kp.push({ memberId: m.userId, displayName: m.displayName ?? participantName(p), kpPct: kpOf(p), gapPct: kpOf(p) - teamAvg })
  }

  return {
    gameId: g.id, gameIndex, win, remake, durationSec, side: us === 100 ? 'blue' : 'red', timeline,
    objectives: ready ? fromTimeline(ready, teams, us) : fromMatchTotals(teams, us),
    goldLead: ready ? buildGoldLead(ready, us, win) : null,
    conversion: ready ? buildConversion(ready, us) : null,
    setup: ready ? buildSetup(ready, us) : null,
    deaths: ready && ready.players.some((p) => p.x) ? buildDeathBreakdown(ready, ourPids) : null,
    rules: ready ? ruleCountsOf(ready.objectiveRules, null) : null,
    kp,
  }
}

// ── The session ─────────────────────────────────────────────────────────────────────────────────────────────────

const addPair = (a: Pair, b: Pair) => { a.ours += b.ours; a.theirs += b.theirs }
const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null)
const known = (xs: Array<number | null>): number[] => xs.filter((x): x is number => typeof x === 'number')
const bump = (w: WinCount, win: boolean) => { w.games++; if (win) w.wins++ }

/** Every game of the session plus their sum. `games` keeps the game order; a game with no usable match is left out. */
export function buildSessionCollective(inputs: PlayerGameInput[], members: RiotIdMember[]): SessionCollective | null {
  const games: GameCollective[] = []
  inputs.forEach((g, i) => {
    const c = buildGameCollective(g, i + 1, members)
    if (c) games.push(c)
  })
  if (games.length === 0) return null
  const all = games
  const counted = games.filter((g) => !g.remake)

  const objectives: SessionCollective['objectives'] = {
    dragons: zeroPair(), dragonsByType: emptyTypes(), elder: zeroPair(), grubs: zeroPair(), herald: zeroPair(), baron: zeroPair(), towers: zeroPair(),
    firsts: { blood: { us: 0, them: 0, games: 0 }, tower: { us: 0, them: 0, games: 0 }, dragon: { us: 0, them: 0, games: 0 }, herald: { us: 0, them: 0, games: 0 } },
  }
  for (const g of counted) {
    const o = g.objectives
    addPair(objectives.dragons, o.dragons); addPair(objectives.grubs, o.grubs); addPair(objectives.herald, o.herald)
    addPair(objectives.baron, o.baron); addPair(objectives.towers, o.towers)
    if (o.elder) addPair(objectives.elder, o.elder)
    if (o.dragonsByType) for (const t of DRAGON_TYPES) addPair(objectives.dragonsByType[t], o.dragonsByType[t])
    for (const k of ['blood', 'tower', 'dragon', 'herald'] as const) {
      const f = o.firsts[k]
      if (f === null) continue
      objectives.firsts[k].games++
      objectives.firsts[k][f]++
    }
  }

  const leads = counted.map((g) => g.goldLead).filter((l): l is GoldLead => !!l)
  const judged = leads.filter((l) => l.ahead15 !== null)
  const goldLead: SessionCollective['goldLead'] = {
    avgAt10: mean(known(leads.map((l) => l.at10))), avgAt15: mean(known(leads.map((l) => l.at15))), avgAt20: mean(known(leads.map((l) => l.at20))),
    ahead15: judged.filter((l) => l.ahead15).length, lostWhileAhead: judged.filter((l) => l.lostWhileAhead).length, gamesJudged: judged.length,
  }

  const conv = counted.map((g) => g.conversion).filter((c): c is Conversion => !!c)
  const fightsWon = conv.reduce((s, c) => s + c.fightsWon, 0), converted = conv.reduce((s, c) => s + c.converted, 0)

  const setups = counted.map((g) => g.setup).filter((s): s is Setup => !!s)
  const kinds: SetupItem['kind'][] = ['dragon', 'elder', 'baron', 'herald']
  const setup: SessionCollective['setup'] = setups.length === 0 ? null : {
    games: setups.length,
    byKind: kinds.map((kind) => {
      const items = setups.flatMap((s) => s.items).filter((i) => i.kind === kind)
      const of = (o: SetupOutcome) => items.filter((i) => i.outcome === o)
      return {
        kind, taken: of('taken').length, lost: of('lost').length, contested: of('contested').length,
        avgWardsTaken: mean(of('taken').map((i) => i.wardsPlaced)), avgWardsLost: mean([...of('lost'), ...of('contested')].map((i) => i.wardsPlaced)),
      }
    }),
  }

  const deathGames = counted.map((g) => g.deaths).filter((d): d is DeathBreakdown => !!d)
  const deaths: DeathBreakdown | null = deathGames.length === 0 ? null : deathGames.reduce((acc, d) => {
    for (const p of ['early', 'mid', 'late'] as const) { acc[p].isolated += d[p].isolated; acc[p].grouped += d[p].grouped; acc[p].unknown += d[p].unknown }
    acc.total += d.total
    return acc
  }, { early: emptyPhase(), mid: emptyPhase(), late: emptyPhase(), total: 0 } as DeathBreakdown)

  const kpById = new Map<string, { displayName: string; kp: number[]; gap: number[] }>()
  for (const g of counted) for (const k of g.kp) {
    const row = kpById.get(k.memberId) ?? { displayName: k.displayName, kp: [], gap: [] }
    row.kp.push(k.kpPct); row.gap.push(k.gapPct)
    kpById.set(k.memberId, row)
  }

  const bySide = { blue: { games: 0, wins: 0 }, red: { games: 0, wins: 0 } }
  const byDuration = { short: { games: 0, wins: 0 }, medium: { games: 0, wins: 0 }, long: { games: 0, wins: 0 } }
  for (const g of counted) {
    bump(bySide[g.side], g.win)
    bump(g.durationSec < SHORT_GAME_SEC ? byDuration.short : g.durationSec < LONG_GAME_SEC ? byDuration.medium : byDuration.long, g.win)
  }

  return {
    games: all, gamesCounted: counted.length, remakes: all.length - counted.length, gamesWithTimeline: counted.filter((g) => g.timeline === 'ready').length,
    objectives, goldLead,
    conversion: { fightsWon, converted, ratePct: fightsWon > 0 ? (converted / fightsWon) * 100 : null },
    setup, deaths,
    rules: sumRuleCounts(counted.map((g) => g.rules)),
    kp: [...kpById.entries()].map(([memberId, r]) => ({ memberId, displayName: r.displayName, games: r.kp.length, kpPct: mean(r.kp) ?? 0, gapPct: mean(r.gap) ?? 0 })),
    bySide, byDuration,
  }
}

/**
 * `teamSessionCollectiveStats(sessionId)`: the session's games (cached match + timeline summary, same rights as
 * getPlayerSessionStats: NOT_FOUND when unreadable) and their collective figures. `enrichLocal(gameId)` re-extracts, game
 * by game as the session is opened, a summary that lacks the per-player block or the ward events. It must read the raw
 * timeline kept on this machine only (never Riot): a game it cannot rebuild keeps what it has (no setup).
 */
export async function getSessionCollective(
  sb: SupabaseClient, sessionId: string,
  enrichLocal?: (gameId: string) => Promise<unknown>,
): Promise<SessionCollective | null> {
  const { data: s, error } = await sb.from('team_sessions').select('id, group_id').eq('id', sessionId).maybeSingle()
  if (error) fail(error, 'session')
  if (!s) throw new Error('NOT_FOUND')
  const [gameRows, memberRows] = await Promise.all([
    sb.from('team_session_games').select('id, match_id, created_at, match_json, our_team_id, timeline_summary').eq('session_id', sessionId),
    sb.from('group_members').select('user_id, riot_id, display_name').eq('group_id', s.group_id),
  ])
  for (const r of [gameRows, memberRows]) if (r.error) fail(r.error, 'collective stats')
  const startOf = (g: any) => Number(g.match_json?.info?.gameStartTimestamp) || Date.parse(g.created_at)
  const rows = [...(gameRows.data ?? [])].sort((a: any, b: any) => startOf(a) - startOf(b))
  if (enrichLocal) {
    for (const g of rows as any[]) {
      const sum = g.timeline_summary as TeamGameTimeline
      if (!g.match_json || (isCurrentTimeline(sum) && hasCurrentPlayers(sum) && hasWardEvents(sum) && hasObjectiveRules(sum))) continue
      try {
        const fresh = await enrichLocal(g.id)
        if (fresh && typeof fresh === 'object' && !('unavailable' in fresh)) g.timeline_summary = fresh
      } catch { /* this game's timeline figures stay null */ }
    }
  }
  const members: RiotIdMember[] = (memberRows.data ?? []).map((m: any) => ({ userId: m.user_id, riotId: m.riot_id, displayName: m.display_name }))
  return buildSessionCollective(rows.map((g: any) => ({
    id: g.id, matchId: g.match_id, matchJson: g.match_json, ourTeamId: g.our_team_id, timelineSummary: g.timeline_summary,
  })), members)
}
