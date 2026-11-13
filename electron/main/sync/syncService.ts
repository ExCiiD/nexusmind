import { BrowserWindow } from 'electron'
import { getPrisma } from '../database'
import { getSupabase, getAccessToken, isCloudConfigured } from '../cloud/supabase'
import { SyncEngine, SyncError, type PushRecord, type RemoteRecord, type SyncRemote, type SyncStatus } from './syncEngine'

/** sync_records / sync_push over the signed-in Supabase session (RLS-scoped). */
class SupabaseSyncRemote implements SyncRemote {
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
      .eq('table_name', table)
      .eq('record_id', id)
      .maybeSingle()
    if (error) throw new Error(error.message)
    return (data as RemoteRecord) ?? null
  }
}

const INTERVAL_MS = 30_000
/** After a local change, sync soon but not on every keystroke. */
const DEBOUNCE_MS = 5_000

let status: SyncStatus = { phase: 'idle', pending: 0, lastSyncAt: null, error: null }
let running: Promise<void> | null = null
let timer: NodeJS.Timeout | null = null
let watcher: NodeJS.Timeout | null = null
let lastPending = 0

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

async function currentUserId(): Promise<string | null> {
  const token = await getAccessToken()
  if (!token) return null
  const { data } = await getSupabase().auth.getUser(token)
  return data.user?.id ?? null
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
    const engine = new SyncEngine(getPrisma() as any, new SupabaseSyncRemote(), uid)
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

/** Periodic sync + a cheap outbox watcher that triggers a sync shortly after local edits. */
export function startSyncService(): void {
  if (!isCloudConfigured() || timer) return
  setTimeout(() => { syncNow().catch(() => {}) }, 3_000)
  timer = setInterval(() => { syncNow().catch(() => {}) }, INTERVAL_MS)

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
  if (timer) clearInterval(timer)
  if (watcher) clearInterval(watcher)
  timer = watcher = null
}
