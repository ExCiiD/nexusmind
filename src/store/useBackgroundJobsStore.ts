import { create } from 'zustand'
import type { TeamMember } from '@/lib/ipc'
import { scopeToMatchCount, type FetchScope } from '@/lib/riotLimits'
import { isRiotRateLimited } from '@/lib/riotErrors'
import type { ScoutEvent } from '@/lib/scoutEngine'
import { createScoutLive, incompleteMemberIds, reduceScoutEvent, totalGames, totalProcessed, type ScoutLive } from './scoutLive'

/**
 * Type of long-running work that the global background-jobs store can host.
 *   - "autoFill" : ChampPoolTab's "Auto-fill all members" loop.
 *   - "scoutAll" : ScoutingTab's "Scout all opponents" loop.
 *   - "scoutOne" : single-member scout triggered from a row's ⟳ button.
 *
 * All three share the same per-member sequential structure so they live in
 * one store. The discriminator lets the global indicator label the pill
 * appropriately ("Auto-filling…" vs "Scouting…").
 */
export type BackgroundJobKind = 'autoFill' | 'scoutAll' | 'scoutOne'

export interface BackgroundJob {
  /** Stable id so multiple jobs can be tracked even if they start within
   *  the same millisecond (rare, but the store is built to be future-proof). */
  id: string
  kind: BackgroundJobKind
  /** Player-facing label shown in the global pill, e.g. "Auto-fill — Team Alpha". */
  label: string
  /** Member currently being processed, for finer-grained "X / Y" progress. */
  currentName: string | null
  done: number
  total: number
  startedAt: number
  /** Set to true to ask the loop to bail at the next iteration boundary.
   *  In-flight Riot requests are NOT cancelled (the IPC handler doesn't
   *  expose abort signals yet) — the loop simply skips the next member. */
  cancelled: boolean
  /** Progressive team scout (scoutTeam): the pill counts games instead of members, and cancelling stops downloads right away. */
  scoutId?: string
  unit?: 'members' | 'games'
}

interface BackgroundJobsState {
  jobs: BackgroundJob[]
  /** Live view of the progressive scout per opponent team id (kept after the end until dismissed, so coming back shows the result). */
  scoutLive: Record<string, ScoutLive>
  dismissScoutLive: (teamId: string) => void
  /** Restarts the members of a stopped scout that did not finish (limit, cancel, failure) with the same scope; the finished ones keep their result. */
  resumeScout: (teamId: string, onDone?: () => void) => Promise<void>

  /** Starts a per-member auto-fill loop. Returns the job id so callers can
   *  optionally cancel it later. The promise resolves once the loop ends. */
  runAutoFill: (args: {
    label: string
    members: TeamMember[]
    scope: FetchScope
    /** Called once the loop finishes (success OR cancellation). Use it to
     *  refresh the page that originated the job. The currently-active page
     *  may be different from the originator — that's fine, the callback
     *  is fire-and-forget. */
    /** rateLimited: the Riot rate-limit error that stopped the job, if any (riotErrorText shows it). */
    onDone?: (summary: { upserted: number; matches: number; cancelled: boolean; failed: string[]; rateLimited?: unknown }) => void
  }) => Promise<string>

  /** Scout-all loop (opponent team). Same structure as runAutoFill but
   *  hits the scout endpoint instead of auto-fill. */
  runScoutAll: (args: {
    label: string
    /** The opponent team: with it (and a build that has scoutTeam) the scout is progressive and fills `scoutLive`. */
    teamId?: string
    members: TeamMember[]
    scope: FetchScope
    onDone?: (summary: { upserted: number; ok: number; cancelled: boolean; failed: string[]; rateLimited?: unknown }) => void
  }) => Promise<string>

  /** Single-member scout — short by design but still routed through the
   *  store so the pill reflects it (the user can navigate freely). */
  runScoutOne: (args: {
    label: string
    teamId?: string
    member: TeamMember
    scope: FetchScope
    onDone?: (summary: { upserted: number; cancelled: boolean; rateLimited?: unknown; /** The scout did not succeed (member error, call rejected): no success toast. */ failed?: boolean; errorMessage?: string }) => void
  }) => Promise<string>

  cancelJob: (id: string) => void
}

/** Ids for `scoutTeam`: at least 4 characters (contract). */
function newScoutId(): string {
  return `ui-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

/** True on a build that has the progressive scout (an old desktop build falls back to scoutMember). */
function canScoutProgressively(): boolean {
  return typeof window.api.scoutTeam === 'function' && typeof window.api.onScoutProgress === 'function'
}

/** Generates a short, locally-unique id without pulling in uuid. The store
 *  is purely in-memory, never persisted, never sent to the backend — so a
 *  prefix + timestamp + counter is more than enough. */
let jobCounter = 0
function nextId(kind: BackgroundJobKind): string {
  jobCounter += 1
  return `${kind}-${Date.now()}-${jobCounter}`
}

export const useBackgroundJobsStore = create<BackgroundJobsState>((set, get) => {
  /** Mutates the job with the given id. No-ops if the job was already
   *  removed (e.g. cancelled then cleaned up). Centralized so the loops
   *  below don't litter `set` calls with the same find-and-replace logic. */
  const updateJob = (id: string, patch: Partial<BackgroundJob>) => {
    set((s) => ({
      jobs: s.jobs.map((j) => (j.id === id ? { ...j, ...patch } : j)),
    }))
  }
  const removeJob = (id: string) => {
    set((s) => ({ jobs: s.jobs.filter((j) => j.id !== id) }))
  }

  /**
   * One progressive scout (1 to N members of an opponent team): a SINGLE scoutTeam call, events reduced into `scoutLive`,
   * the job pill counts games. Lives in the store, not in the tab: leaving the tab does not stop it and coming back shows it.
   */
  const runProgressive = async (args: {
    kind: 'scoutAll' | 'scoutOne'
    label: string
    teamId: string
    members: TeamMember[]
    scope: FetchScope
    previous?: ScoutLive
  }): Promise<{ id: string; live: ScoutLive; upserted: number; ok: number; failed: string[]; rateLimited?: unknown; cancelled: boolean; errorMessage?: string }> => {
    const id = nextId(args.kind)
    const scoutId = newScoutId()
    const startedAt = Date.now()
    set((s) => ({
      jobs: [...s.jobs, {
        id, kind: args.kind, label: args.label, currentName: args.label, done: 0, total: 0, startedAt, cancelled: false, scoutId, unit: 'games' as const,
      }],
      scoutLive: { ...s.scoutLive, [args.teamId]: createScoutLive({
        scoutId, teamId: args.teamId, members: args.members, scope: args.scope, label: args.label, roster: args.previous ? undefined : args.members, previous: args.previous, now: startedAt,
      }) },
    }))
    const patchLive = (fn: (l: ScoutLive) => ScoutLive) => {
      set((s) => {
        const cur = s.scoutLive[args.teamId]
        if (!cur || cur.scoutId !== scoutId) return s
        const next = fn(cur)
        const processed = totalProcessed(next)
        const total = totalGames(next)
        return {
          scoutLive: { ...s.scoutLive, [args.teamId]: next },
          jobs: s.jobs.map((j) => (j.id === id ? { ...j, done: processed, total } : j)),
        }
      })
    }
    const unsubscribe = window.api.onScoutProgress!((ev: ScoutEvent) => {
      if (ev.scoutId !== scoutId) return
      patchLive((l) => reduceScoutEvent(l, ev))
    })
    try {
      const result = await window.api.scoutTeam!(args.members.map((m) => m.id), { count: scopeToMatchCount(args.scope), scoutId })
      // The 'done' event normally arrived first; if it was lost, the result closes the scout the same way.
      patchLive((l) => l.phase === 'finished' ? l : { ...l, phase: 'finished', cancelled: result.cancelled, rateLimited: result.rateLimited, stats: result.stats, finishedAt: Date.now() })
    } catch (err) {
      console.warn('[background:scoutTeam] failed', err)
      const msg = err instanceof Error ? err.message : String(err)
      patchLive((l) => ({ ...l, phase: 'finished', failure: msg, rateLimited: l.rateLimited || isRiotRateLimited(err), finishedAt: Date.now() }))
    } finally {
      unsubscribe()
    }
    const live = get().scoutLive[args.teamId]
    const cancelled = !!get().jobs.find((j) => j.id === id)?.cancelled || !!live?.cancelled
    removeJob(id)
    const list = live ? live.order.map((m) => live.members[m]) : []
    // Everyone who did not finish counts: a call rejected before any event leaves the members in 'waiting', not in error.
    const failedMembers = list.filter((m) => m.status !== 'done')
    const rl = failedMembers.find((m) => m.errorCode === 'RIOT_RATE_LIMITED')
    return {
      id, live: live!, cancelled,
      upserted: list.reduce((n, m) => n + (m.upserted ?? 0), 0),
      ok: list.filter((m) => m.status === 'done').length,
      errorMessage: live?.failure ?? failedMembers.find((m) => m.errorMessage)?.errorMessage ?? undefined,
      failed: failedMembers.map((m) => m.displayName),
      rateLimited: rl ? new Error(rl.errorMessage ?? 'RIOT_RATE_LIMITED') : (live?.rateLimited ? new Error(live.failure ?? 'RIOT_RATE_LIMITED') : undefined),
    }
  }

  return {
    jobs: [],
    scoutLive: {},
    resumeScout: async (teamId, onDone) => {
      const live = get().scoutLive[teamId]
      if (!live || live.phase !== 'finished' || !canScoutProgressively()) return
      const ids = new Set(incompleteMemberIds(live))
      const members = live.roster.filter((m) => ids.has(m.id))
      if (members.length === 0) return
      await runProgressive({ kind: members.length === 1 ? 'scoutOne' : 'scoutAll', label: live.label, teamId, members, scope: live.scope, previous: live })
      onDone?.()
    },
    dismissScoutLive: (teamId) => set((s) => {
      const { [teamId]: _gone, ...rest } = s.scoutLive
      return { scoutLive: rest }
    }),

    runAutoFill: async ({ label, members, scope, onDone }) => {
      const eligible = members.filter((m) => m.ign && m.tagLine && m.region)
      const id = nextId('autoFill')
      const job: BackgroundJob = {
        id,
        kind: 'autoFill',
        label,
        currentName: eligible[0]?.displayName ?? null,
        done: 0,
        total: eligible.length,
        startedAt: Date.now(),
        cancelled: false,
      }
      set((s) => ({ jobs: [...s.jobs, job] }))

      const matchCount = scopeToMatchCount(scope)
      let totalUpserted = 0
      let totalMatches = 0
      const failed: string[] = []
      let rateLimited: unknown

      // Sequential — the global app-tier rate limit (100 req / 120s on a
      // Personal key) is shared across the whole process, so parallelism
      // here doesn't increase throughput.
      for (let i = 0; i < eligible.length; i++) {
        // Read the latest cancel flag straight from the store before each
        // iteration. The job object captured at start would be stale, but
        // the store's latest state is always fresh.
        if (get().jobs.find((j) => j.id === id)?.cancelled) break
        const m = eligible[i]
        updateJob(id, { currentName: m.displayName, done: i })
        try {
          const res = await window.api.autoFillPool(m.id, {
            matchCount,
            masteryCount: 30,
            roleOnly: true,
          })
          totalUpserted += res.upserted
          totalMatches += res.matchesUsed
        } catch (err) {
          console.warn('[background:autoFill] failed for', m.displayName, err)
          failed.push(m.displayName)
          if (isRiotRateLimited(err)) { rateLimited = err; failed.push(...eligible.slice(i + 1).map((x) => x.displayName)); break }
        }
      }

      const cancelled = !!get().jobs.find((j) => j.id === id)?.cancelled
      updateJob(id, { done: eligible.length })
      removeJob(id)
      onDone?.({ upserted: totalUpserted, matches: totalMatches, cancelled, failed, rateLimited })
      return id
    },

    runScoutAll: async ({ label, teamId, members, scope, onDone }) => {
      const eligible = members.filter((m) => m.ign && m.tagLine && m.region)
      if (teamId && canScoutProgressively() && eligible.length > 0) {
        const r = await runProgressive({ kind: 'scoutAll', label, teamId, members: eligible, scope })
        onDone?.({ upserted: r.upserted, ok: r.ok, cancelled: r.cancelled, failed: r.failed, rateLimited: r.rateLimited })
        return r.id
      }
      const id = nextId('scoutAll')
      set((s) => ({
        jobs: [...s.jobs, {
          id,
          kind: 'scoutAll',
          label,
          currentName: eligible[0]?.displayName ?? null,
          done: 0,
          total: eligible.length,
          startedAt: Date.now(),
          cancelled: false,
        }],
      }))

      const matchCount = scopeToMatchCount(scope)
      let totalUpserted = 0
      let ok = 0
      const failed: string[] = []
      let rateLimited: unknown

      for (let i = 0; i < eligible.length; i++) {
        if (get().jobs.find((j) => j.id === id)?.cancelled) break
        const m = eligible[i]
        updateJob(id, { currentName: m.displayName, done: i })
        try {
          const res = await window.api.scoutMember(m.id, matchCount)
          totalUpserted += res.upserted
          ok++
        } catch (err) {
          console.warn('[background:scoutAll] failed for', m.displayName, err)
          failed.push(m.displayName)
          if (isRiotRateLimited(err)) { rateLimited = err; failed.push(...eligible.slice(i + 1).map((x) => x.displayName)); break }
        }
      }

      const cancelled = !!get().jobs.find((j) => j.id === id)?.cancelled
      updateJob(id, { done: eligible.length })
      removeJob(id)
      onDone?.({ upserted: totalUpserted, ok, cancelled, failed, rateLimited })
      return id
    },

    runScoutOne: async ({ label, teamId, member, scope, onDone }) => {
      if (teamId && canScoutProgressively()) {
        const r = await runProgressive({ kind: 'scoutOne', label, teamId, members: [member], scope })
        onDone?.({ upserted: r.upserted, cancelled: r.cancelled, rateLimited: r.rateLimited, failed: r.failed.length > 0, errorMessage: r.errorMessage })
        return r.id
      }
      const id = nextId('scoutOne')
      set((s) => ({
        jobs: [...s.jobs, {
          id,
          kind: 'scoutOne',
          label,
          currentName: member.displayName,
          done: 0,
          total: 1,
          startedAt: Date.now(),
          cancelled: false,
        }],
      }))
      let upserted = 0
      let rateLimited: unknown
      let failed = false
      let errorMessage: string | undefined
      try {
        const res = await window.api.scoutMember(member.id, scopeToMatchCount(scope))
        upserted = res.upserted
      } catch (err) {
        console.warn('[background:scoutOne] failed for', member.displayName, err)
        failed = true
        errorMessage = err instanceof Error ? err.message : String(err)
        if (isRiotRateLimited(err)) rateLimited = err
      }
      const cancelled = !!get().jobs.find((j) => j.id === id)?.cancelled
      updateJob(id, { done: 1 })
      removeJob(id)
      onDone?.({ upserted, cancelled, rateLimited, failed, errorMessage })
      return id
    },

    cancelJob: (id: string) => {
      // Just flip the flag; the loop will pick it up at the next iteration
      // boundary. In-flight Riot requests still complete (we don't have
      // AbortController plumbing through IPC yet) but no new work starts.
      updateJob(id, { cancelled: true })
      // Progressive scout: stop the downloads now (the ones in flight finish in a few seconds), the scout then closes by itself.
      const scoutId = get().jobs.find((j) => j.id === id)?.scoutId
      if (scoutId) {
        set((st) => ({
          scoutLive: Object.fromEntries(Object.entries(st.scoutLive).map(([tid, l]) => [tid, l.scoutId === scoutId ? { ...l, cancelRequested: true } : l])),
        }))
        void window.api.scoutCancel?.(scoutId)?.catch?.(() => {})
      }
    },
  }
})
