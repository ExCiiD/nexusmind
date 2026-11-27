import type { ScoutEvent, ScoutPoolEntry, ScoutStats } from '@/lib/scoutEngine'
import type { TeamMember } from '@/lib/ipc'
import type { FetchScope } from '@/lib/riotLimits'

/**
 * Live view of a progressive team scout (contract: docs/contracts/scouting-progressive.md).
 * Pure state + reducer: the store feeds it the IPC events, the Scouting tab only reads it.
 * `pool` is always the member's COMPLETE list at that instant (replace, never merge).
 */

export type ScoutMemberStatus = 'waiting' | 'mastery' | 'running' | 'done' | 'error' | 'cancelled'

export interface ScoutLiveMember {
  memberId: string
  displayName: string
  status: ScoutMemberStatus
  /** Mastery pool first (games = 0), then the partial season pool, then the final one. */
  pool: ScoutPoolEntry[]
  /** Where `pool` comes from: mastery only, games analysed so far, or the final write. */
  poolSource: 'none' | 'mastery' | 'games' | 'final'
  processed: number
  /** Games of the member's list (0 until the list is read). */
  total: number
  /** `ids` event received: `total` is trustworthy (a total of 0 = no game). */
  idsKnown: boolean
  upserted: number | null
  totalMatches: number | null
  /** Games not analysed (Riot 404 + unreadable) and, among them, those that could not be read (network, proxy, Riot error). */
  failed: number
  unreadable: number
  errorCode: 'RIOT_RATE_LIMITED' | 'CANCELLED' | 'FAILED' | null
  errorMessage: string | null
}

export interface ScoutLive {
  scoutId: string
  teamId: string
  startedAt: number
  /** Members in the order of the team (not the order of arrival). */
  order: string[]
  /** What the user asked for: « Reprendre » reuses it (kept here, not in the tab, so it survives a tab change). */
  scope: FetchScope
  label: string
  /** The members of this scout (full records, to restart some of them). */
  roster: TeamMember[]
  members: Record<string, ScoutLiveMember>
  plan: { rawIds: number; uniqueIds: number; sharedIds: number } | null
  /** First `chunk`: the rate is measured from there (cache reads and the mastery step would skew it). */
  firstChunk: { at: number; processed: number } | null
  phase: 'running' | 'finished'
  cancelRequested: boolean
  cancelled: boolean
  rateLimited: boolean
  /** The call itself failed (validation, IPC), nothing came back. */
  failure: string | null
  stats: ScoutStats | null
  finishedAt: number | null
}

export function createScoutLive(args: {
  scoutId: string
  teamId: string
  members: Array<{ id: string; displayName: string }>
  scope?: FetchScope
  label?: string
  roster?: TeamMember[]
  /** A resumed scout: members already done keep their result, the others start again. */
  previous?: ScoutLive
  now?: number
}): ScoutLive {
  const members: Record<string, ScoutLiveMember> = {}
  const order = args.previous && args.previous.order.length > args.members.length ? args.previous.order : args.members.map((m) => m.id)
  for (const m of args.members) {
    members[m.id] = {
      memberId: m.id, displayName: m.displayName, status: 'waiting', pool: [], poolSource: 'none',
      processed: 0, total: 0, idsKnown: false, upserted: null, totalMatches: null, failed: 0, unreadable: 0, errorCode: null, errorMessage: null,
    }
  }
  if (args.previous) {
    for (const id of order) if (!members[id] && args.previous.members[id]) members[id] = args.previous.members[id]
  }
  return {
    scoutId: args.scoutId, teamId: args.teamId, startedAt: args.now ?? Date.now(), order, members,
    scope: args.scope ?? args.previous?.scope ?? 'quick', label: args.label ?? args.previous?.label ?? '',
    roster: args.previous ? args.previous.roster : (args.roster ?? []),
    plan: null, firstChunk: null, phase: 'running', cancelRequested: false, cancelled: false, rateLimited: false,
    failure: null, stats: null, finishedAt: null,
  }
}

function patchMember(live: ScoutLive, id: string, patch: Partial<ScoutLiveMember>): ScoutLive {
  const cur = live.members[id]
  if (!cur) return live
  return { ...live, members: { ...live.members, [id]: { ...cur, ...patch } } }
}

export function reduceScoutEvent(live: ScoutLive, ev: ScoutEvent, now: number = Date.now()): ScoutLive {
  if (ev.scoutId !== live.scoutId) return live
  switch (ev.type) {
    case 'start':
      return live
    case 'mastery': {
      const cur = live.members[ev.memberId]
      // A mastery pool never replaces games already analysed (events of other members interleave, this one should not arrive late).
      if (!cur || cur.poolSource === 'games' || cur.poolSource === 'final') return live
      return patchMember(live, ev.memberId, { pool: ev.pool, poolSource: 'mastery', status: cur.status === 'waiting' ? 'mastery' : cur.status })
    }
    case 'ids': {
      const cur = live.members[ev.memberId]
      if (!cur) return live
      return patchMember(live, ev.memberId, { total: ev.total, idsKnown: true })
    }
    case 'plan':
      return { ...live, plan: { rawIds: ev.rawIds, uniqueIds: ev.uniqueIds, sharedIds: ev.sharedIds } }
    case 'chunk': {
      const cur = live.members[ev.memberId]
      if (!cur) return live
      const next = patchMember(live, ev.memberId, {
        pool: ev.pool, poolSource: 'games', status: 'running', processed: Math.max(cur.processed, ev.processed), total: ev.total, idsKnown: true,
      })
      return next.firstChunk ? next : { ...next, firstChunk: { at: now, processed: totalProcessed(live) } }
    }
    case 'member-done': {
      const cur = live.members[ev.memberId]
      if (!cur) return live
      // No game at all: the mastery pool shown meanwhile is not a result (nothing was written), drop it.
      const noGamesRead = (ev.totalMatches ?? 0) === 0 && (ev.upserted ?? 0) === 0
      return patchMember(live, ev.memberId, {
        status: 'done', ...(noGamesRead ? { pool: [], poolSource: 'none' as const } : { poolSource: cur.poolSource === 'none' ? 'none' as const : 'final' as const }), upserted: ev.upserted, totalMatches: ev.totalMatches, failed: ev.failed ?? 0, unreadable: ev.unreadable ?? 0,
        processed: Math.max(cur.processed, cur.total), idsKnown: true,
      })
    }
    case 'member-error':
      return patchMember(live, ev.memberId, {
        status: ev.code === 'CANCELLED' ? 'cancelled' : 'error', errorCode: ev.code, errorMessage: ev.message,
      })
    case 'done':
      return { ...live, phase: 'finished', cancelled: ev.cancelled, rateLimited: ev.rateLimited, stats: ev.stats, finishedAt: now }
  }
}

export function totalProcessed(live: ScoutLive): number {
  let n = 0
  for (const id of live.order) n += live.members[id]?.processed ?? 0
  return n
}

export function totalGames(live: ScoutLive): number {
  let n = 0
  for (const id of live.order) n += live.members[id]?.total ?? 0
  return n
}

/** True once every member's list is read: the total is then final, not still growing. */
export function totalsKnown(live: ScoutLive): boolean {
  return live.order.every((id) => live.members[id]?.idsKnown || live.members[id]?.status === 'error' || live.members[id]?.status === 'cancelled')
}

/**
 * Remaining time from the rate measured since the first `chunk`. null while it would be a guess
 * (lists not all read, fewer than 10 games or 10 s of measure). Cached games make the start fast, so the
 * estimate is optimistic at first: the screen shows it with a "~".
 */
export function estimateRemainingMs(live: ScoutLive, now: number): number | null {
  if (live.phase !== 'running' || !live.firstChunk || !totalsKnown(live)) return null
  const elapsed = now - live.firstChunk.at
  const done = totalProcessed(live) - live.firstChunk.processed
  const left = totalGames(live) - totalProcessed(live)
  if (elapsed < 10_000 || done < 10 || left <= 0) return null
  return Math.round((left / done) * elapsed)
}

export type ScoutOutcome = 'running' | 'done' | 'cancelled' | 'rateLimited' | 'sessionExpired' | 'error' | 'noGames'

/** The Ascend session ended (the engine stops the whole scout with a FAILED error saying so): sign in again, do not just resume. */
export function isSessionExpiredMessage(msg: string | null | undefined): boolean {
  return !!msg && /LOGIN_REQUIRED|session expired|sign in again/i.test(msg)
}

/** Members to start again: everyone who did not finish (cancelled, limit, failure). */
export function incompleteMemberIds(live: ScoutLive): string[] {
  return live.order.filter((id) => live.members[id] && live.members[id].status !== 'done')
}

export function failedGames(live: ScoutLive): { failed: number; unreadable: number } {
  let failed = 0
  let unreadable = 0
  for (const id of live.order) { failed += live.members[id]?.failed ?? 0; unreadable += live.members[id]?.unreadable ?? 0 }
  return { failed, unreadable }
}

/** The state the banner shows once the scout stopped (or 'running'). */
export function scoutOutcome(live: ScoutLive): ScoutOutcome {
  if (live.phase === 'running') return 'running'
  if (live.failure) return isSessionExpiredMessage(live.failure) ? 'sessionExpired' : 'error'
  if (live.cancelled) return 'cancelled'
  const list = live.order.map((id) => live.members[id])
  if (live.rateLimited || list.some((m) => m.errorCode === 'RIOT_RATE_LIMITED')) return 'rateLimited'
  if (list.some((m) => m.status === 'error' && isSessionExpiredMessage(m.errorMessage))) return 'sessionExpired'
  // A failed list, too many unreadable games: a member error, never « no games ».
  if (list.some((m) => m.status === 'error')) return 'error'
  // « No games » only when every member finished with totalMatches 0.
  if (list.length > 0 && list.every((m) => m.status === 'done' && (m.totalMatches ?? 0) === 0)) return 'noGames'
  return 'done'
}

export type ScoutErrorKind = 'session' | 'rateLimited' | 'unreadable' | 'list' | 'tooMany' | 'tooManyScouts' | 'network' | 'generic'

/**
 * Class of a scout error from its (English, technical) message: the screen shows a translated text per class,
 * never the raw message. `unreadable` also returns the counts when the message carries them.
 */
export function scoutErrorKind(msg: string | null | undefined): { kind: ScoutErrorKind; bad?: number; of?: number } {
  const m = msg ?? ''
  if (isSessionExpiredMessage(m)) return { kind: 'session' }
  if (/RIOT_RATE_LIMITED|rate.?limit/i.test(m)) return { kind: 'rateLimited' }
  const counts = /(\d+) of (\d+) games could not be read/i.exec(m)
  if (counts) return { kind: 'unreadable', bad: Number(counts[1]), of: Number(counts[2]) }
  if (/match list|season list|list could not/i.test(m)) return { kind: 'list' }
  if (/TOO_MANY_SCOUTS/.test(m)) return { kind: 'tooManyScouts' }
  if (/too many members|too[_ ]big|at most 20|max(imum)? 20|takes 1 to \d+ members/i.test(m)) return { kind: 'tooMany' }
  if (/fetch failed|network|timeout|ECONN|temporarily unavailable|\b50[234]\b/i.test(m)) return { kind: 'network' }
  return { kind: 'generic' }
}
