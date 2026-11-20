/**
 * Supabase Realtime on the web (scalability batch 1, 20/11/2026): the same hub as the desktop
 * (src/lib/realtimeCore.ts), in the page. The Front adds `...realtimeWebApi` to web/src/api.ts: the screens then use
 * the same `onCloudRealtime` / `onCloudRealtimeStatus` / `cloudRealtimeStatus` as on the desktop.
 * Contract: docs/contracts/realtime.md.
 */
import { sb, supabaseConfigured } from './supabase'
import { createRealtimeHub, type RealtimeClientLike, type RealtimeEvent, type RealtimeHub, type RealtimeStatus } from '@/lib/realtimeCore'

const GROUPS_REFRESH_MS = 15 * 60_000

const eventListeners = new Set<(e: RealtimeEvent) => void>()
const statusListeners = new Set<(s: RealtimeStatus) => void>()
let hub: RealtimeHub | null = null
let uid: string | null = null
let groupsTimer: ReturnType<typeof setInterval> | null = null
let started = false

async function myGroupIds(userId: string): Promise<string[]> {
  const { data, error } = await sb.from('group_members').select('group_id').eq('user_id', userId)
  if (error) throw error
  return (data ?? []).map((r: { group_id: string }) => r.group_id)
}

function ensureHub(): RealtimeHub {
  if (!hub) {
    hub = createRealtimeHub(sb as unknown as RealtimeClientLike, {
      onEvent: (e) => { for (const fn of eventListeners) { try { fn(e) } catch { /* ignore */ } } },
      onStatus: (s) => { for (const fn of statusListeners) { try { fn(s) } catch { /* ignore */ } } },
    })
  }
  return hub
}

async function follow(userId: string | null): Promise<void> {
  if (!userId) {
    hub?.stop()
    uid = null
    if (groupsTimer) { clearInterval(groupsTimer); groupsTimer = null }
    return
  }
  if (userId === uid) return
  uid = userId
  ensureHub().start(userId, await myGroupIds(userId).catch(() => []))
  if (!groupsTimer) groupsTimer = setInterval(() => { void refreshRealtimeGroups() }, GROUPS_REFRESH_MS)
}

/** Starts once, on the first listener: follows sign-in and sign-out. */
function startOnce(): void {
  if (started || !supabaseConfigured) return
  started = true
  sb.auth.onAuthStateChange((_event, session) => {
    const id = session?.user && !session.user.is_anonymous ? session.user.id : null
    setTimeout(() => { void follow(id) }, 0)
  })
  void sb.auth.getSession().then(({ data }) => {
    const u = data.session?.user
    return follow(u && !u.is_anonymous ? u.id : null)
  }).catch(() => {})
}

/** After joining, leaving or creating a group on the web: its channel opens or closes. */
export async function refreshRealtimeGroups(): Promise<void> {
  if (!hub || !uid) return
  try { hub.setGroups(await myGroupIds(uid)) } catch { /* next refresh */ }
}

export const realtimeWebApi = {
  onCloudRealtime(cb: (e: RealtimeEvent) => void): () => void {
    startOnce()
    eventListeners.add(cb)
    return () => { eventListeners.delete(cb) }
  },
  onCloudRealtimeStatus(cb: (s: RealtimeStatus) => void): () => void {
    startOnce()
    statusListeners.add(cb)
    return () => { statusListeners.delete(cb) }
  },
  async cloudRealtimeStatus(): Promise<RealtimeStatus> {
    startOnce()
    return hub?.status() ?? 'stopped'
  },
}
