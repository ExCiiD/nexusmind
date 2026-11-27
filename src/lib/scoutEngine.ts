import { matchStartOf, participantFor, type ChampionAgg } from './scoutingCore'
import { normalizeRole } from './teamIdentity'
import { tierPool } from './threatCore'
import { championPlaysRole, type Role } from './championRoles'

/**
 * Progressive team scout (Back-end, 27/11/2026, decision 24/11: speed, never less data).
 *
 * One engine for the desktop (electron/main/ipc/team.ipc.ts) and the web (web/src/scoutingWeb.ts): everything that
 * touches Riot, the match cache or the database is injected (`ScoutDeps`), so the ORDER and the DEDUPLICATION of the
 * work are testable without a network. Contract for the screens: docs/contracts/scouting-progressive.md.
 *
 *  1. every member's champion masteries first (1 request each) -> an instant first pool ("mastery" event);
 *  2. every member's season id list, then ONE list of unique ids for the whole team, most recent first
 *     (a game shared by several scouted players is downloaded once and counted for each of them);
 *  3. games already in the local cache are read first (free), then the missing ones are downloaded in recency order
 *     with a bounded number in flight; partial pools go out as "chunk" events;
 *  4. a member is written (deps.finalizeMember) as soon as all of their games are analysed.
 */

// ── Events ────────────────────────────────────────────────────────────────────────────────────────────────────

/** One champion of a (possibly partial) pool, as the screens show it. */
export interface ScoutPoolEntry {
  championKey: string
  role: string
  games: number
  wins: number
  /** Percent, null when no game yet (mastery-only). */
  winRate: number | null
  kda: number | null
  masteryPoints: number | null
  firstPlayedAt: number | null
  lastPlayedAt: number | null
  /** Provisional until `member-done`: the same rule as the final write, fed with the games seen so far. */
  tier: string
}

export interface ScoutStats {
  members: number
  /** Ids across the members' lists, duplicates included. */
  rawIds: number
  /** Distinct games for the whole team (what is read or downloaded at most). */
  uniqueIds: number
  /** Ids that several scouted players share (saved downloads: rawIds - uniqueIds). */
  sharedIds: number
  fromCache: number
  downloaded: number
  /** Games not analysed: Riot does not have them (404) or they could not be read after the retries. */
  failed: number
  /** Of `failed`, the ones that could NOT be read (network, proxy, Riot error), as opposed to a 404. */
  unreadable?: number
  /** ms from the start to the first mastery pool (null when none could be read). */
  firstPoolMs: number | null
  totalMs: number
}

export type ScoutEvent =
  | { type: 'start'; scoutId: string; members: Array<{ memberId: string; displayName: string }> }
  | { type: 'mastery'; scoutId: string; memberId: string; pool: ScoutPoolEntry[] }
  | { type: 'ids'; scoutId: string; memberId: string; total: number }
  | { type: 'plan'; scoutId: string; rawIds: number; uniqueIds: number; sharedIds: number }
  | { type: 'chunk'; scoutId: string; memberId: string; processed: number; total: number; pool: ScoutPoolEntry[]; history: { from: number | null; to: number | null } }
  | { type: 'member-done'; scoutId: string; memberId: string; upserted: number; totalMatches: number; sameRoleCount: number; failed?: number; unreadable?: number }
  | { type: 'member-error'; scoutId: string; memberId: string; code: 'RIOT_RATE_LIMITED' | 'CANCELLED' | 'FAILED'; message: string }
  | { type: 'done'; scoutId: string; cancelled: boolean; rateLimited: boolean; stats: ScoutStats }

// ── Pure helpers ──────────────────────────────────────────────────────────────────────────────────────────────

/** Riot embeds the game's creation time in a match id (`EUW1_7123456789`): bigger = more recent. */
export function matchIdRank(id: string): number {
  const n = parseInt(id.split('_')[1] ?? '0', 10)
  return Number.isFinite(n) ? n : 0
}

/**
 * One list of distinct ids for the whole team, most recent first, and who wants each. A game two scouted players
 * share appears once (so it is read or downloaded once) and is `wantedBy` both.
 */
export function planTeamMatches(lists: Array<{ memberId: string; ids: string[] }>): {
  order: string[]
  wantedBy: Map<string, string[]>
  rawIds: number
  sharedIds: number
} {
  const wantedBy = new Map<string, string[]>()
  let rawIds = 0
  for (const { memberId, ids } of lists) {
    for (const id of new Set(ids)) {
      rawIds++
      const who = wantedBy.get(id)
      if (who) who.push(memberId)
      else wantedBy.set(id, [memberId])
    }
  }
  const order = Array.from(wantedBy.keys()).sort((a, b) => matchIdRank(b) - matchIdRank(a))
  return { order, wantedBy, rawIds, sharedIds: rawIds - order.length }
}

/**
 * Runs `fn` over `items` with at most `limit` in flight, starting them IN ORDER (the next item starts the moment a
 * slot frees). `shouldStop` is checked before each start; started items always finish.
 */
export async function runBounded<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<void>,
  shouldStop: () => boolean = () => false,
): Promise<void> {
  let next = 0
  const worker = async () => {
    while (!shouldStop()) {
      const i = next++
      if (i >= items.length) return
      await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker))
}

/** The games of one player, added one at a time (same counting rules as aggregateChampionPlays). */
export class PoolAccumulator {
  private readonly agg = new Map<string, ChampionAgg>()
  readonly history = { from: null as number | null, to: null as number | null }
  sameRoleCount = 0
  processed = 0
  failed = 0

  constructor(private readonly puuid: string, private readonly opts: { roleOnly?: boolean; memberRole?: string } = {}) {}

  /** A downloaded or cached game. */
  add(match: any): void {
    this.processed++
    const p = participantFor(match, this.puuid)
    if (!p) return
    const at = matchStartOf(match)
    if (at != null) {
      this.history.from = this.history.from == null ? at : Math.min(this.history.from, at)
      this.history.to = this.history.to == null ? at : Math.max(this.history.to, at)
    }
    const role = normalizeRole(p.teamPosition || p.individualPosition)
    if (!role || role === 'UNKNOWN' || role === 'INVALID' || role === 'NONE') return
    const memberRole = (this.opts.memberRole || '').toUpperCase()
    if (this.opts.roleOnly && memberRole && role !== memberRole) return
    this.sameRoleCount++
    const key = `${p.championName}|${role}`
    const e = this.agg.get(key)
    if (e) {
      e.count++
      if (p.win) e.wins++
      e.kills += p.kills ?? 0
      e.deaths += p.deaths ?? 0
      e.assists += p.assists ?? 0
      if (at != null) {
        e.firstAt = e.firstAt == null ? at : Math.min(e.firstAt, at)
        e.lastAt = e.lastAt == null ? at : Math.max(e.lastAt, at)
      }
    } else {
      this.agg.set(key, {
        championKey: p.championName, role, count: 1, wins: p.win ? 1 : 0,
        kills: p.kills ?? 0, deaths: p.deaths ?? 0, assists: p.assists ?? 0, masteryPoints: 0, firstAt: at, lastAt: at,
      })
    }
  }

  /** A game that could not be read (404, error). */
  markFailed(): void {
    this.processed++
    this.failed++
  }

  /** The entries so far, with the mastery attached (the final write reads these). */
  entries(masteryByKey: Map<string, number>): ChampionAgg[] {
    return Array.from(this.agg.values()).map((e) => ({ ...e, masteryPoints: masteryByKey.get(e.championKey) ?? 0 }))
  }
}

/** Entries -> what the screens show, tiered with the shared rule (provisional while games are still coming). */
export function toPoolEntries(
  entries: ChampionAgg[],
  history: { from: number | null; to: number | null },
): ScoutPoolEntry[] {
  const winRate = (e: ChampionAgg) => (e.count > 0 ? Math.round((e.wins / e.count) * 100) : null)
  const tiers = tierPool(
    entries.map((e) => ({
      championKey: e.championKey, role: e.role, games: e.count, winRate: winRate(e),
      masteryPoints: e.masteryPoints || null, firstPlayedAt: e.firstAt ?? null, lastPlayedAt: e.lastAt ?? null,
    })),
    { historyFrom: history.from, historyTo: history.to },
  )
  return entries.map((e, i) => ({
    championKey: e.championKey, role: e.role, games: e.count, wins: e.wins, winRate: winRate(e),
    kda: e.count > 0 ? (e.kills + e.assists) / Math.max(1, e.deaths) : null,
    masteryPoints: e.masteryPoints > 0 ? e.masteryPoints : null,
    firstPlayedAt: e.firstAt ?? null, lastPlayedAt: e.lastAt ?? null, tier: tiers[i],
  }))
}

/** The instant pool: masteries only, in the member's role (same filter as the Lobby card, `team:card-champions`). */
export function masteryPool(masteries: Array<{ championKey: string; championPoints: number }>, role: string): ScoutPoolEntry[] {
  const primary = (role || 'MID').toUpperCase() as Role
  const entries: ChampionAgg[] = masteries
    .filter((m) => championPlaysRole(m.championKey, primary))
    .map((m) => ({
      championKey: m.championKey, role: primary, count: 0, wins: 0, kills: 0, deaths: 0, assists: 0,
      masteryPoints: m.championPoints, firstAt: null, lastAt: null,
    }))
  return toPoolEntries(entries, { from: null, to: null })
}

// ── The engine ────────────────────────────────────────────────────────────────────────────────────────────────

export interface ScoutMember {
  id: string
  displayName: string
  role: string
}

export interface ResolvedMember {
  puuid: string
  region: string
}

export interface MemberSnapshot {
  entries: ChampionAgg[]
  history: { from: number | null; to: number | null }
  sameRoleCount: number
  /** Games analysed for this member (matches their list). */
  totalMatches: number
  failed: number
}

export interface ScoutDeps {
  /** Puuid and server of a member (one account call when the puuid is unknown). Throws when impossible. */
  resolveMember(member: ScoutMember): Promise<ResolvedMember>
  /** Champion masteries as champion keys (empty on failure: the scout goes on without). */
  getMasteries(member: ScoutMember, r: ResolvedMember): Promise<Array<{ championKey: string; championPoints: number }>>
  /** The member's season ids, most recent first (desktop: incremental from the last scout). */
  getSeasonIds(member: ScoutMember, r: ResolvedMember): Promise<string[]>
  /** The ids of `ids` already in the local cache, with their match. Called in chunks. */
  loadCached(ids: string[]): Promise<Map<string, any>>
  /** One game from Riot (null: Riot does not have it, it is not asked again). Throws on any other failure. */
  fetchMatch(id: string, region: string): Promise<any | null>
  /** Keeps a downloaded game (cache write). Failures are the caller's business: never thrown. */
  saveMatch(id: string, match: any): Promise<void>
  /** Writes one member's final pool (cleanup, tiers, scout cache). Returns the entries written. */
  finalizeMember(member: ScoutMember, r: ResolvedMember, snapshot: MemberSnapshot, allSeasonIds: string[]): Promise<number>
  emit(event: ScoutEvent): void
  isCancelled(): boolean
  now?(): number
}

export interface ScoutOptions {
  scoutId: string
  /** Games per member (quick scope = 100); <= 0 or not finite = the whole season. */
  count: number
  roleOnly: boolean
  /** Games in flight at once (the Riot limiter / proxy budget still decides the real pace). */
  concurrency: number
  /** A chunk event every this many analysed games per member, or this often (ms). */
  chunkEvery?: number
  chunkIntervalMs?: number
  /** A `count` above this means "the whole season" (no cap); it is not a cut of the lists. */
  maxIds?: number
  /** An error that stops the whole scout (a signed-out session): nothing else can succeed. */
  isFatal?: (err: unknown) => boolean
  /** Extra tries of one game after a transient failure (default 2), waiting `retryDelayMs` x try (default 1500). */
  fetchRetries?: number
  retryDelayMs?: number
  /** Stops the downloads when true for an error (a rate limit that outlasted the retries). */
  isRateLimit?: (err: unknown) => boolean
}

export interface ScoutMemberResult {
  memberId: string
  ok: boolean
  upserted: number
  totalMatches: number
  sameRoleCount: number
  failed?: number
  unreadable?: number
  error?: { code: 'RIOT_RATE_LIMITED' | 'CANCELLED' | 'FAILED'; message: string; cause?: unknown }
}

export interface ScoutResult {
  scoutId: string
  cancelled: boolean
  rateLimited: boolean
  members: ScoutMemberResult[]
  stats: ScoutStats
}

/** What `scoutTeam` resolves with (the same data as `ScoutResult`, without the errors' `cause`: it crosses IPC). */
export interface ScoutTeamResult {
  scoutId: string
  cancelled: boolean
  rateLimited: boolean
  stats: ScoutStats
  members: Array<Omit<ScoutMemberResult, 'error'> & { error?: { code: 'RIOT_RATE_LIMITED' | 'CANCELLED' | 'FAILED'; message: string } }>
}

export function toTeamResult(r: ScoutResult): ScoutTeamResult {
  return {
    scoutId: r.scoutId, cancelled: r.cancelled, rateLimited: r.rateLimited, stats: r.stats,
    members: r.members.map((m) => ({ ...m, error: m.error ? { code: m.error.code, message: m.error.message } : undefined })),
  }
}

const defaultIsRateLimit =(err: unknown) => {
  const code = (err as { code?: string } | null)?.code
  return code === 'RIOT_RATE_LIMITED' || code === 'rate-limited'
}

interface MemberState {
  member: ScoutMember
  r: ResolvedMember
  acc: PoolAccumulator
  ids: string[]
  allSeasonIds: string[]
  remaining: number
  masteryByKey: Map<string, number>
  lastChunkAt: number
  sinceChunk: number
  done: boolean
  /** Games that could not be read (not a 404). */
  unreadable: number
}

export async function runScout(deps: ScoutDeps, members: ScoutMember[], opts: ScoutOptions): Promise<ScoutResult> {
  const now = deps.now ?? Date.now
  const t0 = now()
  const { scoutId } = opts
  const chunkEvery = opts.chunkEvery ?? 10
  const chunkIntervalMs = opts.chunkIntervalMs ?? 1000
  const maxIds = opts.maxIds ?? 2500
  const isRateLimit = opts.isRateLimit ?? defaultIsRateLimit
  const noCap = !Number.isFinite(opts.count) || opts.count <= 0 || opts.count > maxIds
  const stats: ScoutStats = {
    members: members.length, rawIds: 0, uniqueIds: 0, sharedIds: 0, fromCache: 0, downloaded: 0, failed: 0, unreadable: 0,
    firstPoolMs: null, totalMs: 0,
  }
  const results = new Map<string, ScoutMemberResult>()
  const states = new Map<string, MemberState>()
  let rateLimited = false
  let fatal: unknown = null
  const isFatal = opts.isFatal ?? (() => false)
  const stop = () => deps.isCancelled() || rateLimited || fatal != null

  deps.emit({ type: 'start', scoutId, members: members.map((m) => ({ memberId: m.id, displayName: m.displayName })) })

  const fail = (m: ScoutMember, code: 'RIOT_RATE_LIMITED' | 'CANCELLED' | 'FAILED', err: unknown) => {
    if (results.has(m.id)) return
    const message = (err as Error)?.message ?? String(err)
    results.set(m.id, { memberId: m.id, ok: false, upserted: 0, totalMatches: 0, sameRoleCount: 0, error: { code, message, cause: err } })
    deps.emit({ type: 'member-error', scoutId, memberId: m.id, code, message })
  }

  // 1 + 2. Account, masteries (instant pool) and season ids, every member side by side.
  await Promise.all(members.map(async (member) => {
    const halted = () => {
      if (!stop()) return false
      fail(member, fatal != null ? 'FAILED' : rateLimited ? 'RIOT_RATE_LIMITED' : 'CANCELLED', fatal ?? new Error(rateLimited ? 'RIOT_RATE_LIMITED: too many Riot requests right now.' : 'Scout cancelled'))
      return true
    }
    try {
      if (halted()) return
      const r = await deps.resolveMember(member)
      if (halted()) return
      const masteryByKey = new Map<string, number>()
      const [, allSeasonIds] = await Promise.all([
        deps.getMasteries(member, r).then((ms) => {
          for (const m of ms) masteryByKey.set(m.championKey, m.championPoints)
          if (ms.length > 0 && !stop()) {
            if (stats.firstPoolMs == null) stats.firstPoolMs = now() - t0
            deps.emit({ type: 'mastery', scoutId, memberId: member.id, pool: masteryPool(ms, member.role) })
          }
          return ms
        }, () => [] as Array<{ championKey: string; championPoints: number }>),
        deps.getSeasonIds(member, r),
      ])
      if (halted()) return
      const ids = noCap ? allSeasonIds : allSeasonIds.slice(0, Math.max(1, opts.count))
      deps.emit({ type: 'ids', scoutId, memberId: member.id, total: ids.length })
      states.set(member.id, {
        member, r, ids, allSeasonIds, masteryByKey, remaining: new Set(ids).size,
        acc: new PoolAccumulator(r.puuid, { roleOnly: opts.roleOnly, memberRole: member.role }),
        lastChunkAt: now(), sinceChunk: 0, done: false, unreadable: 0,
      })
    } catch (err) {
      fail(member, isRateLimit(err) ? 'RIOT_RATE_LIMITED' : 'FAILED', err)
      if (isRateLimit(err)) rateLimited = true
      else if (isFatal(err)) fatal = err
    }
  }))

  // A member with no game: nothing to analyse (as before: no write).
  for (const st of states.values()) {
    if (st.ids.length === 0) {
      st.done = true
      results.set(st.member.id, { memberId: st.member.id, ok: true, upserted: 0, totalMatches: 0, sameRoleCount: 0 })
      deps.emit({ type: 'member-done', scoutId, memberId: st.member.id, upserted: 0, totalMatches: 0, sameRoleCount: 0, failed: 0, unreadable: 0 })
    }
  }

  // 3. One plan for the whole team.
  const active = Array.from(states.values()).filter((s) => !s.done)
  const plan = planTeamMatches(active.map((s) => ({ memberId: s.member.id, ids: s.ids })))
  stats.rawIds = plan.rawIds
  stats.uniqueIds = plan.order.length
  stats.sharedIds = plan.sharedIds
  deps.emit({ type: 'plan', scoutId, rawIds: plan.rawIds, uniqueIds: plan.order.length, sharedIds: plan.sharedIds })

  // Members are written one at a time (SQLite) as soon as they are complete.
  let writes: Promise<void> = Promise.resolve()
  const finish = (st: MemberState) => {
    st.done = true
    writes = writes.then(async () => {
      // Too many games that could not be read: the pool would be a partial one passing for the whole season, and it
      // would replace yesterday's complete pool (and a member whose every game failed has nothing at all). Nothing is written; the games read stay in the cache.
      const limit = Math.max(2, Math.ceil(st.ids.length * 0.02))
      if (st.unreadable > limit || (st.ids.length > 0 && st.unreadable >= st.ids.length)) {
        fail(st.member, 'FAILED', new Error(`${st.unreadable} of ${st.ids.length} games could not be read (network or Riot error): the pool was not updated, try again.`))
        return
      }
      try {
        const snapshot: MemberSnapshot = {
          entries: st.acc.entries(st.masteryByKey), history: st.acc.history,
          sameRoleCount: st.acc.sameRoleCount, totalMatches: st.ids.length, failed: st.acc.failed,
        }
        const upserted = await deps.finalizeMember(st.member, st.r, snapshot, st.allSeasonIds)
        results.set(st.member.id, { memberId: st.member.id, ok: true, upserted, totalMatches: st.ids.length, sameRoleCount: st.acc.sameRoleCount, failed: st.acc.failed, unreadable: st.unreadable })
        deps.emit({ type: 'member-done', scoutId, memberId: st.member.id, upserted, totalMatches: st.ids.length, sameRoleCount: st.acc.sameRoleCount, failed: st.acc.failed, unreadable: st.unreadable })
      } catch (err) {
        fail(st.member, isRateLimit(err) ? 'RIOT_RATE_LIMITED' : 'FAILED', err)
      }
    })
  }

  const emitChunk = (st: MemberState, force = false) => {
    const t = now()
    if (!force && st.sinceChunk < chunkEvery && t - st.lastChunkAt < chunkIntervalMs) return
    if (st.sinceChunk === 0 && !force) return
    st.sinceChunk = 0
    st.lastChunkAt = t
    const entries = st.acc.entries(st.masteryByKey)
    deps.emit({
      type: 'chunk', scoutId, memberId: st.member.id, processed: st.acc.processed, total: st.remaining + st.acc.processed,
      pool: toPoolEntries(entries, st.acc.history), history: { ...st.acc.history },
    })
  }

  const deliver = (id: string, match: any | null, unreadable = false) => {
    for (const memberId of plan.wantedBy.get(id) ?? []) {
      const st = states.get(memberId)
      if (!st || st.done) continue
      if (match) st.acc.add(match)
      else { st.acc.markFailed(); if (unreadable) st.unreadable++ }
      st.remaining--
      st.sinceChunk++
      if (st.remaining === 0) { emitChunk(st, true); finish(st) } else emitChunk(st)
    }
  }

  // 4. What the local cache has, read in chunks (a match body is ~50 KB: never all in memory at once).
  const missing: string[] = []
  const CACHE_CHUNK = 100
  for (let i = 0; i < plan.order.length; i += CACHE_CHUNK) {
    if (stop()) break
    const slice = plan.order.slice(i, i + CACHE_CHUNK)
    const cached = await deps.loadCached(slice)
    for (const id of slice) {
      const m = cached.get(id)
      if (m) { stats.fromCache++; deliver(id, m) } else missing.push(id)
    }
  }

  // 5. The rest from Riot, most recent first, a bounded number at once.
  const retries = opts.fetchRetries ?? 2
  const retryDelay = opts.retryDelayMs ?? 1500
  await runBounded(missing, opts.concurrency, async (id) => {
    const region = states.get(plan.wantedBy.get(id)![0])?.r.region ?? ''
    for (let attempt = 0; ; attempt++) {
      try {
        const match = await deps.fetchMatch(id, region)
        if (match) {
          stats.downloaded++
          await deps.saveMatch(id, match)
        } else stats.failed++
        deliver(id, match)
        return
      } catch (err) {
        if (isRateLimit(err)) { rateLimited = true; return }
        if (isFatal(err)) { fatal = err; return }
        // Transient (network, proxy 502, Riot 5xx): tried again, then counted as unreadable (not as "Riot has no such game").
        if (attempt < retries && !stop()) { await new Promise((r) => setTimeout(r, retryDelay * (attempt + 1))); continue }
        // Stopped meanwhile (rate limit, cancel, fatal): the failure is a consequence, not a game that cannot be read.
        if (stop()) return
        stats.failed++
        stats.unreadable = (stats.unreadable ?? 0) + 1
        deliver(id, null, true)
        return
      }
    }
  }, stop)

  // Whoever is not complete: a clear error (their games stay in the cache, a new scout picks up from there).
  for (const st of states.values()) {
    if (st.done) continue
    if (st.sinceChunk > 0) emitChunk(st, true)
    if (fatal != null) fail(st.member, 'FAILED', fatal)
    else fail(st.member, rateLimited ? 'RIOT_RATE_LIMITED' : 'CANCELLED',
      new Error(rateLimited ? 'RIOT_RATE_LIMITED: too many Riot requests right now, the games already downloaded are kept.' : 'Scout cancelled'))
  }
  await writes

  stats.totalMs = now() - t0
  const cancelled = deps.isCancelled()
  deps.emit({ type: 'done', scoutId, cancelled, rateLimited, stats })
  return { scoutId, cancelled, rateLimited, members: members.map((m) => results.get(m.id)!).filter(Boolean), stats }
}

// ── Limits on scouts running at once (security audit 27/11, F1/F3/F4) ───────────────────────────────────────────

/** Scouts running at the same time (per window / tab). More are refused with TOO_MANY_SCOUTS. */
export const MAX_ACTIVE_SCOUTS = 3
/** Members per scout call (desktop validates it with zod, the web adapter with this). */
export const MAX_SCOUT_MEMBERS = 20

/** Takes the slot of `scoutId`: refuses a scout already running with this id and too many scouts at once. */
export function registerScout(
  active: Map<string, { cancelled: boolean }>,
  scoutId: string,
  cancelled = false,
  max = MAX_ACTIVE_SCOUTS,
): { cancelled: boolean } {
  if (active.has(scoutId)) throw new Error('A scout with this id is already running')
  if (active.size >= max) throw new Error(`TOO_MANY_SCOUTS: ${max} scouts are already running, wait for one to finish.`)
  const flag = { cancelled }
  active.set(scoutId, flag)
  return flag
}

/** Frees the slot, but only if it is still this scout's own flag. */
export function releaseScout(active: Map<string, { cancelled: boolean }>, scoutId: string, flag: { cancelled: boolean }): void {
  if (active.get(scoutId) === flag) active.delete(scoutId)
}

export function assertScoutMemberCount(n: number): void {
  if (n < 1 || n > MAX_SCOUT_MEMBERS) throw new Error(`A scout takes 1 to ${MAX_SCOUT_MEMBERS} members (got ${n}).`)
}
