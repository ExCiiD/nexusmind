import { create } from 'zustand'
import type { TeamMember } from '@/lib/ipc'
import { scopeToMatchCount, type FetchScope } from '@/components/team/ScopeDialog'

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
}

interface BackgroundJobsState {
  jobs: BackgroundJob[]

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
    onDone?: (summary: { upserted: number; matches: number; cancelled: boolean; failed: string[] }) => void
  }) => Promise<string>

  /** Scout-all loop (opponent team). Same structure as runAutoFill but
   *  hits the scout endpoint instead of auto-fill. */
  runScoutAll: (args: {
    label: string
    members: TeamMember[]
    scope: FetchScope
    onDone?: (summary: { upserted: number; ok: number; cancelled: boolean; failed: string[] }) => void
  }) => Promise<string>

  /** Single-member scout — short by design but still routed through the
   *  store so the pill reflects it (the user can navigate freely). */
  runScoutOne: (args: {
    label: string
    member: TeamMember
    scope: FetchScope
    onDone?: (summary: { upserted: number; cancelled: boolean }) => void
  }) => Promise<string>

  cancelJob: (id: string) => void
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

  return {
    jobs: [],

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
        }
      }

      const cancelled = !!get().jobs.find((j) => j.id === id)?.cancelled
      updateJob(id, { done: eligible.length })
      removeJob(id)
      onDone?.({ upserted: totalUpserted, matches: totalMatches, cancelled, failed })
      return id
    },

    runScoutAll: async ({ label, members, scope, onDone }) => {
      const eligible = members.filter((m) => m.ign && m.tagLine && m.region)
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
        }
      }

      const cancelled = !!get().jobs.find((j) => j.id === id)?.cancelled
      updateJob(id, { done: eligible.length })
      removeJob(id)
      onDone?.({ upserted: totalUpserted, ok, cancelled, failed })
      return id
    },

    runScoutOne: async ({ label, member, scope, onDone }) => {
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
      try {
        const res = await window.api.scoutMember(member.id, scopeToMatchCount(scope))
        upserted = res.upserted
      } catch (err) {
        console.warn('[background:scoutOne] failed for', member.displayName, err)
      }
      const cancelled = !!get().jobs.find((j) => j.id === id)?.cancelled
      updateJob(id, { done: 1 })
      removeJob(id)
      onDone?.({ upserted, cancelled })
      return id
    },

    cancelJob: (id: string) => {
      // Just flip the flag; the loop will pick it up at the next iteration
      // boundary. In-flight Riot requests still complete (we don't have
      // AbortController plumbing through IPC yet) but no new work starts.
      updateJob(id, { cancelled: true })
    },
  }
})
