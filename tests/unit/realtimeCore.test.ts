import { describe, it, expect, vi } from 'vitest'
import { createRealtimeHub, planChannels, toRealtimeEvent, FALLBACK_POLL_MS, RETRY_DELAYS_MS, type RealtimeEvent, type RealtimeTimers } from '../../src/lib/realtimeCore'

const UID = '00000000-0000-0000-0000-000000000001'
const G1 = '10000000-0000-0000-0000-000000000001'
const G2 = '10000000-0000-0000-0000-000000000002'

/** A fake supabase-js client: records channels and lets the test drive their status and changes. */
function fakeClient() {
  const channels: Array<{ name: string; ons: Array<{ filter: any; cb: (p: any) => void }>; system: Array<(p: any) => void>; status?: (s: string) => void; removed: boolean }> = []
  const client = {
    channel(name: string) {
      const ch = { name, ons: [] as any[], system: [] as Array<(p: any) => void>, status: undefined as any, removed: false }
      channels.push(ch)
      const api = {
        on(t: string, filter: any, cb: (p: any) => void) { if (t === 'system') ch.system.push(cb); else ch.ons.push({ filter, cb }); return api },
        subscribe(cb?: (s: string) => void) { ch.status = cb; return api },
      }
      ;(api as any).__ch = ch
      return api
    },
    removeChannel(api: any) { api.__ch.removed = true },
  }
  const live = () => channels.filter((c) => !c.removed)
  const byName = (n: string) => live().filter((c) => c.name === n).at(-1)!
  /** What the server does when the bindings are accepted: SUBSCRIBED, then a postgres_changes system ok. */
  const confirm = (n: string) => { const c = byName(n); c.status!('SUBSCRIBED'); for (const cb of c.system) cb({ extension: 'postgres_changes', status: 'ok', message: 'Subscribed to PostgreSQL' }) }
  /** The publication is empty: SUBSCRIBED, then a system error, never CHANNEL_ERROR. */
  const refuse = (n: string) => { const c = byName(n); c.status!('SUBSCRIBED'); for (const cb of c.system) cb({ extension: 'postgres_changes', status: 'error', message: 'Unable to subscribe to changes with given parameters.' }) }
  return { client, channels, live, byName, confirm, refuse }
}

/** Manual timers. */
function fakeTimers() {
  let t = 0
  const jobs: Array<{ at: number; fn: () => void; every?: number; id: number }> = []
  let seq = 0
  const timers: RealtimeTimers = {
    setTimeout: (fn, ms) => { const id = ++seq; jobs.push({ at: t + ms, fn, id }); return id },
    clearTimeout: (h) => { const i = jobs.findIndex((j) => j.id === h); if (i >= 0) jobs.splice(i, 1) },
    setInterval: (fn, ms) => { const id = ++seq; jobs.push({ at: t + ms, fn, every: ms, id }); return id },
    clearInterval: (h) => { const i = jobs.findIndex((j) => j.id === h); if (i >= 0) jobs.splice(i, 1) },
  }
  const advance = (ms: number) => {
    const end = t + ms
    for (;;) {
      jobs.sort((a, b) => a.at - b.at)
      const next = jobs[0]
      if (!next || next.at > end) break
      t = next.at
      if (next.every) next.at += next.every
      else jobs.shift()
      next.fn()
    }
    t = end
  }
  return { timers, advance, pending: () => jobs.length }
}

describe('realtime channels plan', () => {
  it('one channel for the user, one per group, filtered', () => {
    const plan = planChannels(UID, [G2, G1, G1])
    expect(plan.map((p) => p.name)).toEqual([`user:${UID}`, `group:${G1}`, `group:${G2}`])
    expect(plan[0].tables).toEqual([
      { table: 'notifications', topic: 'notifications', filter: `user_id=eq.${UID}` },
      { table: 'calendar_event_responses', topic: 'calendar' },
      { table: 'team_session_reviews', topic: 'team_session_reviews' },
    ])
    expect(plan[1].tables.map((t) => [t.table, t.filter])).toEqual([
      ['team_sessions', `group_id=eq.${G1}`], ['calendar_events', `group_id=eq.${G1}`], ['announcements', `group_id=eq.${G1}`],
    ])
  })

  it('never puts an unsafe id in a filter', () => {
    expect(planChannels('x,or(1=1)', [])).toEqual([])
    expect(planChannels(UID, ['g1),or(true']).map((p) => p.name)).toEqual([`user:${UID}`])
  })

  it('maps a change to a light event', () => {
    expect(toRealtimeEvent('announcements', 'announcements', { eventType: 'UPDATE', new: { id: 'a1', group_id: G1, body: 'secret text' } }))
      .toEqual({ topic: 'announcements', table: 'announcements', event: 'UPDATE', groupId: G1, id: 'a1' })
    expect(toRealtimeEvent('calendar_event_responses', 'calendar', { eventType: 'INSERT', new: { event_id: 'e1', user_id: UID } }))
      .toMatchObject({ id: 'e1', groupId: null, event: 'INSERT' })
  })
})

describe('realtime hub', () => {
  it('subscribes INSERT and UPDATE only (DELETE events bypass RLS) and forwards changes', () => {
    const f = fakeClient()
    const events: RealtimeEvent[] = []
    const hub = createRealtimeHub(f.client, { onEvent: (e) => events.push(e), timers: fakeTimers().timers })
    hub.start(UID, [G1])
    const user = f.byName(`user:${UID}`)
    expect(new Set(user.ons.map((o) => o.filter.event))).toEqual(new Set(['INSERT', 'UPDATE']))
    user.ons.find((o) => o.filter.table === 'notifications')!.cb({ eventType: 'INSERT', new: { id: 'n1', user_id: UID } })
    expect(events).toEqual([{ topic: 'notifications', table: 'notifications', event: 'INSERT', groupId: null, id: 'n1' }])
  })

  it('is live once every channel is subscribed', () => {
    const f = fakeClient()
    const statuses: string[] = []
    const hub = createRealtimeHub(f.client, { onEvent: () => {}, onStatus: (s) => statuses.push(s), timers: fakeTimers().timers })
    hub.start(UID, [G1])
    expect(hub.status()).toBe('connecting')
    f.byName(`user:${UID}`).status!('SUBSCRIBED')
    expect(hub.status()).toBe('connecting') // joined, not confirmed yet
    for (const cb of f.byName(`user:${UID}`).system) cb({ extension: 'postgres_changes', status: 'ok' })
    expect(hub.isLive()).toBe(false)
    f.confirm(`group:${G1}`)
    expect(hub.isLive()).toBe(true)
    expect(statuses).toEqual(['connecting', 'live'])
  })

  it('a channel down: slow fallback poll, growing retries, then a catch-up when back', () => {
    const f = fakeClient()
    const t = fakeTimers()
    const events: RealtimeEvent[] = []
    const hub = createRealtimeHub(f.client, { onEvent: (e) => events.push(e), timers: t.timers })
    hub.start(UID, [G1])
    f.confirm(`user:${UID}`)
    f.confirm(`group:${G1}`)

    f.byName(`group:${G1}`).status!('CHANNEL_ERROR')
    expect(hub.status()).toBe('fallback')
    t.advance(RETRY_DELAYS_MS[0])
    expect(f.channels.filter((c) => c.name === `group:${G1}`)).toHaveLength(2) // re-opened
    f.byName(`group:${G1}`).status!('TIMED_OUT')
    t.advance(RETRY_DELAYS_MS[1] - 1)
    expect(f.channels.filter((c) => c.name === `group:${G1}`)).toHaveLength(2) // waits longer the second time
    t.advance(1)
    expect(f.channels.filter((c) => c.name === `group:${G1}`)).toHaveLength(3)

    t.advance(FALLBACK_POLL_MS)
    const polls = events.filter((e) => e.event === 'POLL')
    expect(polls.map((e) => e.topic).sort()).toEqual(['announcements', 'calendar', 'team_sessions'])
    expect(polls.every((e) => e.groupId === G1)).toBe(true)

    events.length = 0
    f.confirm(`group:${G1}`)
    expect(hub.isLive()).toBe(true)
    expect(events.filter((e) => e.event === 'POLL')).toHaveLength(3) // catch-up of the outage
    events.length = 0
    t.advance(FALLBACK_POLL_MS * 3)
    expect(events).toHaveLength(0) // no more polling once live
  })

  it('empty publication (before the migration, after its rollback): never live, slow polling and retries', () => {
    const f = fakeClient()
    const t = fakeTimers()
    const events: RealtimeEvent[] = []
    const statuses: string[] = []
    const hub = createRealtimeHub(f.client, { onEvent: (e) => events.push(e), onStatus: (s) => statuses.push(s), timers: t.timers })
    hub.start(UID, [G1])
    f.refuse(`user:${UID}`)
    f.confirm(`group:${G1}`)
    expect(hub.isLive()).toBe(false)
    expect(hub.status()).toBe('fallback')
    expect(statuses).not.toContain('live')
    t.advance(RETRY_DELAYS_MS[0])
    expect(f.channels.filter((c) => c.name === `user:${UID}`)).toHaveLength(2) // tried again
    f.refuse(`user:${UID}`)
    t.advance(RETRY_DELAYS_MS[1])
    expect(f.channels.filter((c) => c.name === `user:${UID}`)).toHaveLength(3) // with a growing delay
    t.advance(FALLBACK_POLL_MS)
    expect(events.some((e) => e.event === 'POLL' && e.topic === 'notifications')).toBe(true)
    // The migration applied: the next try is accepted, the hub becomes live.
    f.refuse(`user:${UID}`)
    t.advance(RETRY_DELAYS_MS[2])
    f.confirm(`user:${UID}`)
    expect(hub.isLive()).toBe(true)
  })

  it('joined but never confirmed: stays connecting, so the screens keep their normal polling', () => {
    const f = fakeClient()
    const hub = createRealtimeHub(f.client, { onEvent: () => {}, timers: fakeTimers().timers })
    hub.start(UID, [])
    f.byName(`user:${UID}`).status!('SUBSCRIBED')
    expect(hub.status()).toBe('connecting')
  })

  it('a replaced channel closing late does not trigger a new retry', () => {
    const f = fakeClient()
    const t = fakeTimers()
    const hub = createRealtimeHub(f.client, { onEvent: () => {}, timers: t.timers })
    hub.start(UID, [])
    const first = f.byName(`user:${UID}`)
    first.status!('CHANNEL_ERROR')
    t.advance(RETRY_DELAYS_MS[0])
    f.confirm(`user:${UID}`)
    first.status!('CLOSED') // removeChannel of the old one answers after the new one is up
    expect(hub.isLive()).toBe(true)
    expect(t.pending()).toBe(0)
  })

  it('joining and leaving groups opens and closes their channels only', () => {
    const f = fakeClient()
    const hub = createRealtimeHub(f.client, { onEvent: () => {}, timers: fakeTimers().timers })
    hub.start(UID, [G1])
    hub.setGroups([G1, G2])
    expect(hub.channels().sort()).toEqual([`group:${G1}`, `group:${G2}`, `user:${UID}`].sort())
    expect(f.channels).toHaveLength(3)
    hub.setGroups([G2])
    expect(f.channels.find((c) => c.name === `group:${G1}`)!.removed).toBe(true)
    expect(hub.channels()).not.toContain(`group:${G1}`)
  })

  it('stop and a new user close everything, timers included', () => {
    const f = fakeClient()
    const t = fakeTimers()
    const hub = createRealtimeHub(f.client, { onEvent: () => {}, timers: t.timers })
    hub.start(UID, [G1])
    f.byName(`group:${G1}`).status!('CHANNEL_ERROR')
    hub.start('00000000-0000-0000-0000-000000000009', [])
    expect(f.live().map((c) => c.name)).toEqual(['user:00000000-0000-0000-0000-000000000009'])
    hub.stop()
    expect(f.live()).toHaveLength(0)
    expect(t.pending()).toBe(0)
    expect(hub.status()).toBe('stopped')
  })

  it('a listener that throws does not break the hub', () => {
    const f = fakeClient()
    const hub = createRealtimeHub(f.client, { onEvent: () => { throw new Error('boom') }, timers: fakeTimers().timers })
    hub.start(UID, [])
    expect(() => f.byName(`user:${UID}`).ons[0].cb({ eventType: 'INSERT', new: { id: 'n' } })).not.toThrow()
  })
})

void vi
