/**
 * Supabase Realtime on the desktop (scalability batch 1, 20/11/2026): one hub in the main process
 * (src/lib/realtimeCore.ts), its events forwarded to every window as `cloud:realtime`.
 *
 * - Started when a user is signed in, with their groups; stopped on sign-out.
 * - The group list is read again every 15 minutes, and after a group change made in this app.
 * - A team session that changes refreshes the live-session list at once (syncService.ts), which no longer has to
 *   poll it quickly while Realtime is live.
 */
import { BrowserWindow, ipcMain } from 'electron'
import { createRealtimeHub, type RealtimeClientLike, type RealtimeEvent, type RealtimeHub, type RealtimeStatus } from '../../../src/lib/realtimeCore'
import { getSupabase, getSessionUserId, isCloudConfigured } from './supabase'

const GROUPS_REFRESH_MS = 15 * 60_000

let hub: RealtimeHub | null = null
let currentUid: string | null = null
let groupsTimer: ReturnType<typeof setInterval> | null = null
const listeners = new Set<(e: RealtimeEvent) => void>()

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

/** Main-process listeners (syncService). */
export function onRealtimeEvent(fn: (e: RealtimeEvent) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function realtimeStatus(): RealtimeStatus {
  return hub?.status() ?? 'stopped'
}

/** True when every channel is subscribed: polling can slow down. */
export function realtimeLive(): boolean {
  return hub?.isLive() ?? false
}

async function myGroupIds(uid: string): Promise<string[]> {
  const { data, error } = await getSupabase().from('group_members').select('group_id').eq('user_id', uid)
  if (error) throw error
  return (data ?? []).map((r: { group_id: string }) => r.group_id)
}

/** The user joined, left or was removed from a group: their channels follow. */
export async function refreshRealtimeGroups(): Promise<void> {
  if (!hub || !currentUid) return
  try { hub.setGroups(await myGroupIds(currentUid)) } catch { /* next refresh */ }
}

async function startFor(uid: string): Promise<void> {
  if (!hub) {
    // supabase-js overloads channel().on() per event type: the hub uses the postgres_changes one only.
    hub = createRealtimeHub(getSupabase() as unknown as RealtimeClientLike, {
      onEvent: (e) => {
        broadcast('cloud:realtime', e)
        for (const fn of listeners) { try { fn(e) } catch { /* ignore */ } }
      },
      onStatus: (s) => broadcast('cloud:realtime-status', s),
    })
  }
  currentUid = uid
  hub.start(uid, await myGroupIds(uid).catch(() => []))
  if (!groupsTimer) groupsTimer = setInterval(() => { void refreshRealtimeGroups() }, GROUPS_REFRESH_MS)
}

function stopAll(): void {
  hub?.stop()
  currentUid = null
  if (groupsTimer) { clearInterval(groupsTimer); groupsTimer = null }
}

/** `cloud:realtime-status`: the renderer's initial status (then `cloud:realtime-status` events). */
export function registerRealtimeHandlers(): void {
  ipcMain.handle('cloud:realtime-status', () => realtimeStatus())
}

/** Starts Realtime for the signed-in user and follows sign-in / sign-out. Safe to call once at start-up. */
export function startRealtimeService(): void {
  if (!isCloudConfigured()) return
  getSupabase().auth.onAuthStateChange((event, session) => {
    // Deferred: supabase-js methods must not run inside its own auth callback.
    setTimeout(() => {
      const uid = session?.user && !session.user.is_anonymous ? session.user.id : null
      if (!uid || event === 'SIGNED_OUT') { stopAll(); return }
      if (uid !== currentUid) void startFor(uid).catch((err) => console.warn('[realtime] start failed:', (err as Error)?.message))
    }, 0)
  })
  void getSessionUserId().then((uid) => { if (uid && uid !== currentUid) return startFor(uid) }).catch(() => {})
}
