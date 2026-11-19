import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { authTimeoutFetch } from '@/lib/accessCore'

const url = (import.meta.env.WEB_SUPABASE_URL ?? import.meta.env.MAIN_VITE_SUPABASE_URL ?? '').trim()
const key = (import.meta.env.WEB_SUPABASE_ANON_KEY ?? import.meta.env.MAIN_VITE_SUPABASE_ANON_KEY ?? '').trim()

export const supabaseConfigured = /^https:\/\/[a-z0-9]+\.supabase\.co$/.test(url) && key.length > 20
export const supabaseUrl = url
/** Public anon key (shipped in the bundle by design), for the logout retry. */
export const supabaseAnonKey = key

/**
 * Browser client: the session lives in localStorage (standard for a web app;
 * the desktop keeps it in the OS keychain). Access is enforced by RLS.
 */
export const WEB_AUTH_STORAGE_KEY = 'nexusmind-web-auth'

export const sb: SupabaseClient = createClient(url || 'https://invalid.supabase.co', key || 'missing', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: WEB_AUTH_STORAGE_KEY },
  // A silent auth server must not leave the page on its spinner (accessCore.ts).
  global: { fetch: authTimeoutFetch() },
})

// R2: signing out stops auto-refresh (accessCore.signOutThisDevice); a new
// sign-in restarts it. Deferred: auth-js methods must not run inside its callback.
sb.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_IN') setTimeout(() => { sb.auth.startAutoRefresh().catch(() => {}) }, 0)
})

export async function currentUserId(): Promise<string> {
  const { data } = await sb.auth.getSession()
  const id = data.session?.user?.id
  if (!id) throw new Error('LOGIN_REQUIRED')
  return id
}
