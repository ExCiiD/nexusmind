import { BrowserWindow, app } from 'electron'
import { getPrisma } from '../database'
import { getSupabase, isCloudConfigured, getSessionUserId } from '../cloud/supabase'
import { SyncEngine, SyncError, type PushRecord, type RemoteRecord, type SyncRemote, type SyncStatus } from './syncEngine'
import { listMyLiveSessions, liveSessionsKey, livePollDelay } from '../../../src/lib/teamSessionsCore'
import type { TeamSession } from '../../../src/lib/teamSessions'

/**
 * sync_records / sync_push over the signed-in Supabase session.
 *
 * `sync_records` carries a SELECT policy (`sync_records_read_shared`,
 * `private.can_read_player_table`) that also lets a coach/owner/analyst
 * read a *shared* teammate's own rows — that's intentional and required
 * for the staff dashboard / "shared player stats" feature (there's no
 * separate cloud table for session/assessment data; it only ever exists
 * as opaque JSON inside `sync_records.data`, read directly from the web
 * or desktop UI for that one feature). This class is for a different
 * job: keeping *this device's own* local SQLite mirror in sync with the
 * signed-in user's *own* other devices. Without an explicit `user_id`
 * filter here, that RLS-granted read would leak straight into this
 * mechanism too — a coach's own desktop sync would silently pull a
 * shared player's Session/Assessment rows and merge them into the
 * coach's own local tables, corrupting their personal Analytics with
 * someone else's data. Never rely on RLS alone for this invariant.
 */
class SupabaseSyncRemote implements SyncRemote {
  constructor(private readonly uid: string) {}

  async push(records: PushRecord[]): Promise<void> {
    for (let i = 0; i < records.length; i += 500) {
      const { error } = await getSupabase().rpc('sync_push', { p_records: records.slice(i, i + 500) })
      if (error) throw new Error(`sync_push failed: ${error.message}`)
    }
  }
  async pull(afterSeq: number, limit: number): Promise<RemoteRecord[]> {
    const { data, error } = await getSupabase()
      .from('sync_records')
      .select('table_name, record_id, data, deleted, updated_at, device_id, seq')
      .eq('user_id', this.uid)
      .gt('seq', afterSeq)
      .order('seq', { ascending: true })
      .limit(limit)
    if (error) throw new Error(`sync pull failed: ${error.message}`)
    return (data ?? []) as RemoteRecord[]
  }
  async getRecord(table: string, id: string): Promise<RemoteRecord | null> {
    const { data, error } = await getSupabase()
      .from('sync_records')
      .select('table_name, record_id, data, deleted, updated_at, device_id, seq')
      .eq('user_id', this.uid)
      .eq('table_name', table)
      .eq('record_id', id)
      .maybeSingle()
    if (error) throw new Error(error.message)
    return (data as RemoteRecord) ?? null
  }
}

/**
 * Supabase budget (item I, 19/11/2026): ≤ 3 requests a minute at rest. A cycle is 2 requests (pull + live-session
 * check; the owner check runs once per run, see verifiedOwners). Local edits still sync within DEBOUNCE_MS through
 * the outbox watcher, so the rest interval only bounds how stale other devices' changes can be.
 */
// The cadence itself (60 s, 15 s while a team session is live, 5 min / 60 s hidden) is livePollDelay in
// teamSessionsCore, shared with the web. The 15 s while live is fast enough to feel "live" across devices without
// a Realtime/websocket transport (a deliberate decision: the app has no Realtime infrastructure).
/** After a local change, sync soon but not on every keystroke. */
const DEBOUNCE_MS = 5_000

let status: SyncStatus = { phase: 'idle', pending: 0, lastSyncAt: null, error: null }
let running: Promise<void> | null = null
let timer: NodeJS.Timeout | null = null
let watcher: NodeJS.Timeout | null = null
let lastPending = 0
let hasLiveSession = false
/** Owner checks done this run (SyncEngine.checkOwner): one request per run instead of one per cycle. */
const verifiedOwners = new Set<string>()
/** The wait of the scheduled cycle, so a window coming back can cut a hidden-mode wait short. */
let scheduledDelay = 0

/** True when some window is shown and not minimised. */
function anyWindowVisible(): boolean {
  return BrowserWindow.getAllWindows().some((w) => !w.isDestroyed() && w.isVisible() && !w.isMinimized())
}

// ── The one live-session poller of the app (item I, 19/11/2026) ─────────────
// The sync cycle fetches the user's live team sessions (the same single request that used to only count them) and
// pushes them as 'team-session:live' when they change. The banner and the end-of-game prompt listen to that instead
// of each polling teamSessionListMyLive every 15-30 s.

/** null until the first fetch. */
let liveSessions: TeamSession[] | null = null
let liveKey = ''

function setLiveSessions(list: TeamSession[]): void {
  liveSessions = list
  hasLiveSession = list.length > 0
  const key = liveSessionsKey(list)
  if (key === liveKey) return
  liveKey = key
  broadcast('team-session:live', list)
}

/** Fetches the user's live sessions now (one request) and pushes them if they changed. Never throws. */
export async function refreshLiveSessions(): Promise<TeamSession[]> {
  try {
    // Signed out: nothing live (and no request to send).
    const uid = await currentUserId().catch(() => null)
    setLiveSessions(uid ? await listMyLiveSessions(getSupabase()) : [])
  } catch { /* keep the previous list; next cycle retries */ }
  return liveSessions ?? []
}

/** The last known live sessions, fetched once if the sync has not run yet (team-session:live-cached). */
export async function getLiveSessionsCached(): Promise<TeamSession[]> {
  return liveSessions ?? refreshLiveSessions()
}

/** Pure, tested: the wait before the next cycle. */
export function nextSyncDelay(visible: boolean, liveSession: boolean): number {
  return livePollDelay(visible, liveSession)
}

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

function setStatus(patch: Partial<SyncStatus>): void {
  status = { ...status, ...patch }
  broadcast('sync:status', status)
}

export function getSyncStatus(): SyncStatus {
  return status
}

/** The signed-in user, from the local session (no server round trip:
 *  this ran on every sync cycle, every 7.5 to 30 seconds). */
export async function currentUserId(): Promise<string | null> {
  return getSessionUserId()
}

/** One sync cycle; concurrent calls share the same run. */
export function syncNow(): Promise<void> {
  if (running) return running
  running = (async () => {
    const uid = await currentUserId().catch(() => null)
    if (!uid) {
      setStatus({ phase: 'idle', error: 'SIGNED_OUT' })
      return
    }
    const engine = new SyncEngine(getPrisma() as any, new SupabaseSyncRemote(uid), uid, verifiedOwners)
    setStatus({ phase: 'syncing', error: null })
    try {
      const res = await engine.syncOnce()
      const pending = await engine.pendingCount()
      lastPending = pending
      setStatus({ phase: 'idle', pending, lastSyncAt: new Date().toISOString(), error: null })
      if (res.appliedTables.length > 0) broadcast('sync:applied', { tables: res.appliedTables, count: res.pulled })
    } catch (err) {
      const code = err instanceof SyncError ? err.code : 'NETWORK'
      setStatus({ phase: err instanceof SyncError ? 'blocked' : 'error', error: code, pending: await engine.pendingCount().catch(() => status.pending) })
      console.warn('[sync] failed:', (err as Error)?.message)
    }
  })().finally(() => { running = null })
  return running
}

/** Re-schedules itself after every cycle (rather than a fixed
 *  `setInterval`) so the interval can shorten/lengthen between runs —
 *  shortened while any of the user's groups has a live team session. */
function scheduleNextSync(): void {
  const delay = nextSyncDelay(anyWindowVisible(), hasLiveSession)
  scheduledDelay = delay
  timer = setTimeout(async () => {
    await syncNow().catch(() => {})
    await refreshLiveSessions()
    scheduleNextSync()
  }, delay)
}

/** Periodic sync + a cheap outbox watcher that triggers a sync shortly after local edits. */
export function startSyncService(): void {
  if (!isCloudConfigured() || timer) return
  setTimeout(() => { syncNow().catch(() => {}) }, 3_000)
  scheduleNextSync()

  // A window coming back while a hidden-mode wait (up to 5 min) is pending: back to the visible cadence now.
  app.on('browser-window-focus', () => {
    if (!timer || scheduledDelay <= nextSyncDelay(true, hasLiveSession)) return
    clearTimeout(timer)
    timer = null
    syncNow().catch(() => {}).finally(() => { if (!timer) scheduleNextSync() })
  })

  let dueAt = 0
  watcher = setInterval(async () => {
    try {
      const rows = await getPrisma().$queryRawUnsafe<{ n: number | bigint }[]>(`SELECT COUNT(*) AS n FROM "_sync_outbox"`)
      const pending = Number(rows[0]?.n ?? 0)
      if (pending !== lastPending) {
        lastPending = pending
        setStatus({ pending })
        if (pending > 0) dueAt = Date.now() + DEBOUNCE_MS
      }
      if (dueAt && Date.now() >= dueAt) {
        dueAt = 0
        syncNow().catch(() => {})
      }
    } catch { /* DB busy: next tick */ }
  }, 1_000)
}

export function stopSyncService(): void {
  if (timer) clearTimeout(timer)
  if (watcher) clearInterval(watcher)
  timer = watcher = null
}
