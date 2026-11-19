import { createClient, type SupabaseClient, type Session } from '@supabase/supabase-js'
import { BrowserWindow, app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import { getSecret, saveSecret, deleteSecret } from '../keychain'
import * as access from '../../../src/lib/accessCore'
import { authStorageKey, authTimeoutFetch } from '../../../src/lib/accessCore'

/**
 * Supabase client living in the MAIN process only. The renderer never sees
 * tokens: it talks to the cloud through typed IPC (cloud.ipc.ts).
 *
 * The session (access + refresh token) is persisted with Electron
 * safeStorage (DPAPI on Windows) through keychain.ts, so it survives restarts
 * and keeps working offline while the stored session can still be
 * refreshed (refresh tokens do not expire on the server by themselves).
 */

const SUPABASE_URL = (import.meta.env.MAIN_VITE_SUPABASE_URL as string | undefined)?.trim() ?? ''
const SUPABASE_KEY = (import.meta.env.MAIN_VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() ?? ''

export function isCloudConfigured(): boolean {
  // Automated tests run the real build without touching the real backend.
  if (process.env.NEXUSMIND_CLOUD_DISABLED === '1') return false
  return /^https:\/\/[a-z0-9]+\.supabase\.co$/.test(SUPABASE_URL) && SUPABASE_KEY.length > 20
}

export function getSupabaseUrl(): string {
  return SUPABASE_URL
}

/**
 * Session storage backed by the OS-encrypted keychain, with an in-memory
 * fallback. A write or delete that could not reach the file (encryption
 * unavailable, file locked by an antivirus) is kept in `memory` and wins
 * over the file for the rest of the run: otherwise the file's older session
 * came back after a sign-out or a token refresh. `null` = removed.
 */
const memory = new Map<string, string | null>()
const keychainStorage = {
  getItem(key: string): string | null {
    if (memory.has(key)) return memory.get(key) ?? null
    try { return getSecret(storageService(key)) } catch { return null }
  },
  setItem(key: string, value: string): void {
    try {
      saveSecret(storageService(key), value)
      memory.delete(key)
      updatePendingDeletes((keys) => keys.delete(key)) // a new session replaced the old one
    } catch {
      memory.set(key, value)
    }
  },
  removeItem(key: string): void {
    try {
      deleteSecret(storageService(key))
      memory.delete(key)
      updatePendingDeletes((keys) => keys.delete(key))
    } catch {
      memory.set(key, null)
      // R1 (CyberSecurity review of #2): remembered across restarts, or
      // the next launch would read the file and sign the user back in.
      updatePendingDeletes((keys) => keys.add(key))
    }
  },
}

/** @internal Unit tests only (tests/unit/desktopAuthStorage.test.ts). */
export const keychainStorageForTests = keychainStorage

function storageService(key: string): string {
  return `supabase-${key.replace(/[^a-zA-Z0-9_-]/g, '_')}`
}

// ── Sign-outs whose session file could not be deleted (R1) ─────────────────
// A small, non-secret marker in userData lists the storage keys still to
// delete. At startup (before the client reads anything) and at quit, the
// deletion is retried; until it succeeds the stored session is ignored.

function pendingDeletesPath(): string {
  return join(app.getPath('userData'), 'signout-pending.json')
}

function readPendingDeletes(): Set<string> {
  try {
    const raw = JSON.parse(readFileSync(pendingDeletesPath(), 'utf-8'))
    return new Set(Array.isArray(raw) ? raw.filter((k): k is string => typeof k === 'string') : [])
  } catch {
    return new Set()
  }
}

function updatePendingDeletes(change: (keys: Set<string>) => void): void {
  const keys = readPendingDeletes()
  const before = keys.size
  change(keys)
  if (keys.size === before && before === 0) return
  try {
    if (keys.size === 0) { if (existsSync(pendingDeletesPath())) unlinkSync(pendingDeletesPath()) }
    else writeFileSync(pendingDeletesPath(), JSON.stringify([...keys]))
  } catch { /* best effort: the in-memory tombstone still covers this run */ }
}

/** Retries the deletions a failed sign-out left; what still fails stays ignored. */
export function retryPendingSecretDeletes(): void {
  const keys = readPendingDeletes()
  if (keys.size === 0) return
  for (const key of keys) {
    try {
      deleteSecret(storageService(key))
      keys.delete(key)
    } catch {
      memory.set(key, null)
    }
  }
  updatePendingDeletes((current) => { for (const k of [...current]) if (!keys.has(k)) current.delete(k) })
}

let client: SupabaseClient | null = null
let revokeRetry: { stop: () => void } | null = null

export function getSupabase(): SupabaseClient {
  if (!isCloudConfigured()) throw new Error('CLOUD_NOT_CONFIGURED')
  if (client) return client
  retryPendingSecretDeletes()
  client = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
      storage: keychainStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
    // A silent auth server must not leave the app on its spinner (accessCore.ts).
    global: { fetch: authTimeoutFetch() },
  })
  client.auth.onAuthStateChange((event, session) => {
    broadcastAuth(session)
    // R2: signOutThisDevice stops auto-refresh; a new sign-in restarts it.
    // Deferred: auth-js methods must not run inside its own callback.
    if (event === 'SIGNED_IN') setTimeout(() => { client?.auth.startAutoRefresh().catch(() => {}) }, 0)
  })
  return client
}

/**
 * Forgets this device's session without the server (the logout request
 * failed) and tells every window, as a SIGNED_OUT event would have.
 */
export function forgetLocalSession(): void {
  const key = authStorageKey(getSupabase(), SUPABASE_URL)
  keychainStorage.removeItem(key)
  keychainStorage.removeItem(`${key}-code-verifier`)
  broadcastAuth(null)
}

/**
 * Signs this device out, even when the server cannot be reached. Then the
 * logout is sent again every minute while the old access token is valid
 * (R3), so the server-side session does not stay open.
 */
export async function signOutThisDevice() {
  const res = await access.signOutThisDevice(getSupabase(), forgetLocalSession)
  if (res.pendingRevoke) {
    const pending = res.pendingRevoke
    revokeRetry?.stop()
    revokeRetry = access.scheduleRevokeRetry(() => access.retryRevoke(SUPABASE_URL, SUPABASE_KEY, pending))
  }
  return res
}

/**
 * Signs out every device and the web (scope global): the recourse for a
 * lost PC. Unlike signOutThisDevice this fails loudly: the user must know
 * the other sessions are still open.
 */
export async function signOutEverywhere(): Promise<void> {
  const { error } = await getSupabase().auth.signOut({ scope: 'global' })
  if (error) throw new Error(access.authErrorCode(error.message))
}

export interface CloudUser {
  id: string
  email: string | null
  hasPassword?: boolean
}

export function toCloudUser(session: Session | null): CloudUser | null {
  const u = session?.user
  if (!u || u.is_anonymous) return null
  return { id: u.id, email: u.email ?? null, hasPassword: u.user_metadata?.has_password === true }
}

function broadcastAuth(session: Session | null): void {
  const user = toCloudUser(session)
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('cloud:auth-changed', user)
  }
}

/**
 * Valid access token for the current user (refreshed if needed), or null
 * when nobody is signed in. Used by the Riot proxy and backups.
 */
/**
 * The signed-in user's id, from the local session: no network call. Every
 * cloud helper used to ask the server instead (auth.getUser), on every
 * call — about a thousand requests an hour per running app, each one a
 * database read on Supabase, which helped exhaust the project's disk I/O
 * budget on 18 November 2026. The server still checks the token on every
 * query (RLS); this id only scopes our own requests.
 */
export async function getSessionUserId(): Promise<string | null> {
  if (!isCloudConfigured()) return null
  const { data } = await getSupabase().auth.getSession()
  const session = data.session
  if (!session || session.user.is_anonymous) return null
  return session.user.id
}

/** getSessionUserId, or LOGIN_REQUIRED when nobody is signed in. */
export async function requireSessionUserId(): Promise<string> {
  const uid = await getSessionUserId()
  if (!uid) throw new Error('LOGIN_REQUIRED')
  return uid
}

export async function getAccessToken(): Promise<string | null> {
  if (!isCloudConfigured()) return null
  const { data } = await getSupabase().auth.getSession()
  const session = data.session
  if (!session || session.user.is_anonymous) return null
  // getSession() refreshes automatically when the token is close to expiry.
  return session.access_token
}
