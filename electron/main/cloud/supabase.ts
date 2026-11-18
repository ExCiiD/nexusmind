import { createClient, type SupabaseClient, type Session } from '@supabase/supabase-js'
import { BrowserWindow } from 'electron'
import { getSecret, saveSecret, deleteSecret } from '../keychain'

/**
 * Supabase client living in the MAIN process only. The renderer never sees
 * tokens: it talks to the cloud through typed IPC (cloud.ipc.ts).
 *
 * The session (access + refresh token) is persisted with Electron
 * safeStorage (DPAPI on Windows) through keychain.ts, so it survives restarts
 * and keeps working offline until the refresh token expires.
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

/** Session storage backed by the OS-encrypted keychain, with an in-memory fallback. */
const memory = new Map<string, string>()
const keychainStorage = {
  getItem(key: string): string | null {
    try { return getSecret(storageService(key)) } catch { return memory.get(key) ?? null }
  },
  setItem(key: string, value: string): void {
    try { saveSecret(storageService(key), value) } catch { memory.set(key, value) }
  },
  removeItem(key: string): void {
    memory.delete(key)
    try { deleteSecret(storageService(key)) } catch { /* nothing stored */ }
  },
}

function storageService(key: string): string {
  return `supabase-${key.replace(/[^a-zA-Z0-9_-]/g, '_')}`
}

let client: SupabaseClient | null = null

export function getSupabase(): SupabaseClient {
  if (!isCloudConfigured()) throw new Error('CLOUD_NOT_CONFIGURED')
  if (client) return client
  client = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
      storage: keychainStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  })
  client.auth.onAuthStateChange((_event, session) => broadcastAuth(session))
  return client
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
