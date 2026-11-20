/**
 * Supabase Realtime instead of polling (scalability batch 1, 20/11/2026). Shared by the desktop (main process) and
 * the web. Contract: docs/contracts/realtime.md.
 *
 * - **Channels**: one per user (`user:<uid>`: their notifications, plus the tables with no group column, filtered by
 *   RLS) and one per group (`group:<gid>`: team sessions, calendar events, announcements of that group).
 * - **What arrives**: a light event (topic, table, group, row id). The screen reloads what it shows with the
 *   existing Core calls: one request per actual change instead of one per poll.
 * - **INSERT and UPDATE only**: Postgres DELETE events are not filtered (by column or by RLS) and would reach every
 *   subscriber. Deletions are picked up by the catch-up after a reconnection and by the screens' own reload on
 *   focus.
 * - **RLS**: Realtime checks each subscriber's SELECT policies for every change. A filter (`group_id=eq.…`) only
 *   narrows what the server evaluates. It never widens what a user may read.
 * - **Live only once confirmed**: SUBSCRIBED only means the channel joined. The server then sends a `system`
 *   message for postgres_changes: `ok` (the hub counts the channel as live) or `error` (e.g. "Unable to subscribe"
 *   when a table is not in the publication: before the migration or after its rollback), treated like
 *   CHANNEL_ERROR. Without a confirmation the channel stays "connecting": the screens keep their normal polling.
 * - **Failure**: a channel that errors, times out or closes is subscribed again with a growing delay (1 s → 60 s).
 *   Meanwhile a slow fallback poll (3 min) emits `POLL` events, so the screens still refresh. Back online, one
 *   `POLL` per topic catches up what was missed.
 */

export type RealtimeTopic = 'notifications' | 'team_sessions' | 'calendar' | 'announcements' | 'team_session_reviews'
export type RealtimeEventKind = 'INSERT' | 'UPDATE' | 'POLL'

export interface RealtimeEvent {
  topic: RealtimeTopic
  /** The table that changed ('' for a POLL). */
  table: string
  event: RealtimeEventKind
  /** The group of the row when the table has one, else null. */
  groupId: string | null
  /** The row's id when it has one, else null. */
  id: string | null
}

/** live: every channel subscribed. fallback: at least one is down and polled slowly. */
export type RealtimeStatus = 'stopped' | 'connecting' | 'live' | 'fallback'

export interface RealtimeTableSpec {
  table: string
  topic: RealtimeTopic
  /** user: filtered on `column = uid`. group: on `column = groupId`. rls: no column to filter on, RLS alone. */
  scope: 'user' | 'group' | 'rls'
  column?: string
}

/** The tables in the `supabase_realtime` publication (migration 20261120140000_realtime_publication). */
export const REALTIME_TABLES: RealtimeTableSpec[] = [
  { table: 'notifications', topic: 'notifications', scope: 'user', column: 'user_id' },
  { table: 'team_sessions', topic: 'team_sessions', scope: 'group', column: 'group_id' },
  { table: 'calendar_events', topic: 'calendar', scope: 'group', column: 'group_id' },
  { table: 'announcements', topic: 'announcements', scope: 'group', column: 'group_id' },
  { table: 'calendar_event_responses', topic: 'calendar', scope: 'rls' },
  { table: 'team_session_reviews', topic: 'team_session_reviews', scope: 'rls' },
]

export const FALLBACK_POLL_MS = 3 * 60_000
export const RETRY_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000, 60_000]

/** The part of a Supabase client this module uses (supabase-js v2). */
export interface RealtimeChannelLike {
  on(type: 'postgres_changes', filter: { event: string; schema: string; table: string; filter?: string }, cb: (payload: { new?: Record<string, unknown> | null; eventType?: string }) => void): RealtimeChannelLike
  on(type: 'system', filter: Record<string, never>, cb: (payload: { extension?: string; status?: string; message?: string }) => void): RealtimeChannelLike
  subscribe(cb?: (status: string, err?: unknown) => void): unknown
}
export interface RealtimeClientLike {
  channel(name: string): RealtimeChannelLike
  removeChannel(channel: RealtimeChannelLike): unknown
}

export interface RealtimeTimers {
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(h: unknown): void
  setInterval(fn: () => void, ms: number): unknown
  clearInterval(h: unknown): void
}
const defaultTimers: RealtimeTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
}

/** Accepts ids safe to put in a filter (uuid-like): anything else is never subscribed. */
const SAFE_ID = /^[A-Za-z0-9-]{1,64}$/

export interface ChannelPlan { name: string; tables: Array<{ table: string; topic: RealtimeTopic; filter?: string }> }

/** Pure: the channels a user needs. */
export function planChannels(uid: string, groupIds: string[]): ChannelPlan[] {
  if (!SAFE_ID.test(uid)) return []
  const user: ChannelPlan = {
    name: `user:${uid}`,
    tables: REALTIME_TABLES.filter((t) => t.scope !== 'group').map((t) => ({
      table: t.table, topic: t.topic, ...(t.scope === 'user' ? { filter: `${t.column}=eq.${uid}` } : {}),
    })),
  }
  const groups = [...new Set(groupIds)].filter((g) => SAFE_ID.test(g)).sort().map((gid) => ({
    name: `group:${gid}`,
    tables: REALTIME_TABLES.filter((t) => t.scope === 'group').map((t) => ({ table: t.table, topic: t.topic, filter: `${t.column}=eq.${gid}` })),
  }))
  return [user, ...groups]
}

/** Pure: a change payload as the event the screens get. */
export function toRealtimeEvent(table: string, topic: RealtimeTopic, payload: { new?: Record<string, unknown> | null; eventType?: string }): RealtimeEvent {
  const row = payload.new ?? {}
  const str = (v: unknown) => (typeof v === 'string' ? v : null)
  return {
    topic,
    table,
    event: payload.eventType === 'UPDATE' ? 'UPDATE' : 'INSERT',
    groupId: str(row.group_id),
    id: str(row.id) ?? str(row.event_id) ?? null,
  }
}

interface ChannelState {
  plan: ChannelPlan
  channel: RealtimeChannelLike | null
  /** Bumped at each (re)open: callbacks of a replaced channel are ignored. */
  gen: number
  /** Joined (SUBSCRIBED), waiting for the server's postgres_changes confirmation. */
  joined: boolean
  /** Confirmed: events will arrive. */
  subscribed: boolean
  everSubscribed: boolean
  attempt: number
  retry: unknown
  poll: unknown
}

export interface RealtimeHubOptions {
  onEvent: (e: RealtimeEvent) => void
  onStatus?: (s: RealtimeStatus) => void
  fallbackPollMs?: number
  timers?: RealtimeTimers
}

export function createRealtimeHub(client: RealtimeClientLike, opts: RealtimeHubOptions) {
  const timers = opts.timers ?? defaultTimers
  const fallbackMs = opts.fallbackPollMs ?? FALLBACK_POLL_MS
  const states = new Map<string, ChannelState>()
  let uid: string | null = null
  let groups: string[] = []
  let lastStatus: RealtimeStatus = 'stopped'

  const emit = (e: RealtimeEvent) => { try { opts.onEvent(e) } catch { /* a listener must not break the hub */ } }
  const topicsOf = (plan: ChannelPlan) => [...new Set(plan.tables.map((t) => t.topic))]
  const groupOf = (plan: ChannelPlan) => (plan.name.startsWith('group:') ? plan.name.slice(6) : null)
  const pollEvents = (plan: ChannelPlan) => { for (const topic of topicsOf(plan)) emit({ topic, table: '', event: 'POLL', groupId: groupOf(plan), id: null }) }

  function status(): RealtimeStatus {
    if (!uid) return 'stopped'
    const all = [...states.values()]
    if (all.length === 0) return 'connecting'
    if (all.every((s) => s.subscribed)) return 'live'
    if (all.some((s) => s.poll)) return 'fallback'
    return 'connecting'
  }
  function report() {
    const s = status()
    if (s !== lastStatus) { lastStatus = s; try { opts.onStatus?.(s) } catch { /* ignore */ } }
  }

  function startFallback(st: ChannelState) {
    if (st.poll) return
    st.poll = timers.setInterval(() => pollEvents(st.plan), fallbackMs)
  }
  function stopFallback(st: ChannelState) {
    if (st.poll) { timers.clearInterval(st.poll); st.poll = null }
  }

  function fail(st: ChannelState) {
    st.joined = false
    st.subscribed = false
    startFallback(st)
    scheduleRetry(st)
    report()
  }

  function confirm(st: ChannelState) {
    if (st.subscribed) return
    const recovered = st.everSubscribed || !!st.poll
    st.subscribed = true
    st.everSubscribed = true
    st.attempt = 0
    stopFallback(st)
    if (recovered) pollEvents(st.plan) // catch up what was missed while down
    report()
  }

  function open(st: ChannelState) {
    const gen = ++st.gen
    const current = () => states.get(st.plan.name) === st && st.gen === gen // not closed, not replaced
    let ch = client.channel(st.plan.name)
    for (const t of st.plan.tables) {
      for (const event of ['INSERT', 'UPDATE']) {
        ch = ch.on('postgres_changes', { event, schema: 'public', table: t.table, ...(t.filter ? { filter: t.filter } : {}) }, (payload) => { if (current()) emit(toRealtimeEvent(t.table, t.topic, payload)) })
      }
    }
    // The server's answer to the postgres_changes bindings: only an `ok` makes the channel live.
    ch = ch.on('system', {}, (payload) => {
      if (!current() || (payload?.extension && payload.extension !== 'postgres_changes')) return
      if (payload?.status === 'ok') { if (st.joined) confirm(st) }
      else if (payload?.status === 'error') fail(st)
    })
    st.channel = ch
    st.joined = false
    st.subscribed = false
    ch.subscribe((s) => {
      if (!current()) return
      if (s === 'SUBSCRIBED') {
        st.joined = true
        report()
      } else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' || s === 'CLOSED') {
        fail(st)
      }
    })
  }

  function scheduleRetry(st: ChannelState) {
    if (st.retry) return
    const delay = RETRY_DELAYS_MS[Math.min(st.attempt, RETRY_DELAYS_MS.length - 1)]
    st.attempt++
    st.retry = timers.setTimeout(() => {
      st.retry = null
      if (states.get(st.plan.name) !== st) return
      if (st.channel) { try { client.removeChannel(st.channel) } catch { /* ignore */ } }
      st.channel = null
      open(st)
    }, delay)
  }

  function close(st: ChannelState) {
    states.delete(st.plan.name)
    stopFallback(st)
    if (st.retry) { timers.clearTimeout(st.retry); st.retry = null }
    if (st.channel) { try { client.removeChannel(st.channel) } catch { /* ignore */ } }
  }

  function apply() {
    const wanted = uid ? planChannels(uid, groups) : []
    const names = new Set(wanted.map((p) => p.name))
    for (const st of [...states.values()]) if (!names.has(st.plan.name)) close(st)
    for (const plan of wanted) {
      if (states.has(plan.name)) continue
      const st: ChannelState = { plan, channel: null, gen: 0, joined: false, subscribed: false, everSubscribed: false, attempt: 0, retry: null, poll: null }
      states.set(plan.name, st)
      open(st)
    }
    report()
  }

  return {
    /** Subscribes for this user and these groups (call again on sign-in, or use setGroups). */
    start(userId: string, groupIds: string[] = []) {
      if (uid !== userId) { for (const st of [...states.values()]) close(st) }
      uid = userId
      groups = groupIds
      apply()
    },
    /** The user joined or left groups: their channels open or close. */
    setGroups(groupIds: string[]) {
      groups = groupIds
      apply()
    },
    stop() {
      for (const st of [...states.values()]) close(st)
      uid = null
      report()
    },
    status,
    /** True when every channel is subscribed: the callers can slow their own polling down. */
    isLive: () => status() === 'live',
    /** For the tests and the diagnostics screen. */
    channels: () => [...states.keys()],
  }
}

export type RealtimeHub = ReturnType<typeof createRealtimeHub>
