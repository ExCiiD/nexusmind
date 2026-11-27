import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScoutEvent } from '@/lib/scoutEngine'
import type { TeamMember } from '@/lib/ipc'

// M3: the scope and the members live in the store, so « Reprendre » works after a tab change and restarts only who failed.
const member = (id: string): TeamMember => ({ id, teamId: 't', displayName: id.toUpperCase(), ign: id, tagLine: 'EUW', region: 'EUW1', role: 'MID' }) as TeamMember
const stats = { members: 2, rawIds: 0, uniqueIds: 0, sharedIds: 0, fromCache: 0, downloaded: 0, failed: 0, firstPoolMs: null, totalMs: 1 }

describe('scout resume (store)', () => {
  let listeners: Array<(ev: ScoutEvent) => void>
  let calls: Array<{ ids: string[]; opts: { count?: number; scoutId?: string } }>
  beforeEach(() => {
    listeners = []
    calls = []
    let n = 0
    vi.stubGlobal('window', {
      api: {
        onScoutProgress: (cb: (ev: ScoutEvent) => void) => { listeners.push(cb); return () => { listeners = listeners.filter((l) => l !== cb) } },
        scoutCancel: async () => ({ ok: true, found: true }),
        scoutTeam: async (ids: string[], opts: { count?: number; scoutId?: string }) => {
          calls.push({ ids, opts })
          const scoutId = opts.scoutId!
          const emit = (e: Omit<ScoutEvent, 'scoutId'>) => listeners.forEach((l) => l({ scoutId, ...e } as ScoutEvent))
          n++
          if (n === 1) {
            emit({ type: 'member-done', memberId: 'a', upserted: 1, totalMatches: 5, sameRoleCount: 5 } as never)
            emit({ type: 'member-error', memberId: 'b', code: 'FAILED', message: 'list failed' } as never)
          } else {
            emit({ type: 'member-done', memberId: 'b', upserted: 1, totalMatches: 7, sameRoleCount: 7 } as never)
          }
          emit({ type: 'done', cancelled: false, rateLimited: false, stats } as never)
          return { scoutId, cancelled: false, rateLimited: false, stats, members: [] }
        },
      },
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('restarts only the failed member with the same scope, keeping the finished one', async () => {
    const { useBackgroundJobsStore } = await import('@/store/useBackgroundJobsStore')
    const st = () => useBackgroundJobsStore.getState()
    await st().runScoutAll({ label: 'Scout — X', teamId: 't', members: [member('a'), member('b')], scope: 'complete' })
    expect(calls[0].ids).toEqual(['a', 'b'])
    expect(calls[0].opts.count).toBe(-1)
    expect(st().scoutLive.t.scope).toBe('complete')
    expect(st().scoutLive.t.members.b.status).toBe('error')

    await st().resumeScout('t')
    expect(calls[1].ids).toEqual(['b'])
    expect(calls[1].opts.count).toBe(-1)
    const live = st().scoutLive.t
    expect(live.members.a.status).toBe('done')
    expect(live.members.b.status).toBe('done')
    expect(st().jobs).toHaveLength(0)
  })
})

describe('scout failure reporting (store, I5)', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('a call rejected before any event is reported as failed (members stay waiting), with its message', async () => {
    vi.stubGlobal('window', { api: { onScoutProgress: () => () => {}, scoutCancel: async () => ({ ok: true, found: false }), scoutTeam: async () => { throw new Error('Your Ascend session expired — please sign in again.') } } })
    const { useBackgroundJobsStore } = await import('@/store/useBackgroundJobsStore')
    const got: Array<{ failed: string[]; ok: number }> = []
    await useBackgroundJobsStore.getState().runScoutAll({ label: 'x', teamId: 't2', members: [member('a'), member('b')], scope: 'quick', onDone: (r) => { got.push({ failed: r.failed, ok: r.ok }) } })
    expect(got[0]).toEqual({ failed: ['A', 'B'], ok: 0 })
  })
  it('scout one: a member error reaches onDone as failed, so no success toast', async () => {
    vi.stubGlobal('window', { api: { onScoutProgress: () => () => {}, scoutCancel: async () => ({ ok: true, found: false }), scoutTeam: async () => { throw new Error('Too many members') } } })
    const { useBackgroundJobsStore } = await import('@/store/useBackgroundJobsStore')
    const got: Array<{ failed?: boolean; errorMessage?: string }> = []
    await useBackgroundJobsStore.getState().runScoutOne({ label: 'x', teamId: 't3', member: member('a'), scope: 'quick', onDone: (r) => { got.push({ failed: r.failed, errorMessage: r.errorMessage }) } })
    expect(got[0]).toEqual({ failed: true, errorMessage: 'Too many members' })
  })
})
