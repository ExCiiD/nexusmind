import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = (import.meta.env.WEB_SUPABASE_URL ?? import.meta.env.MAIN_VITE_SUPABASE_URL ?? '').trim()
const key = (import.meta.env.WEB_SUPABASE_ANON_KEY ?? import.meta.env.MAIN_VITE_SUPABASE_ANON_KEY ?? '').trim()

export const supabaseConfigured = /^https:\/\/[a-z0-9]+\.supabase\.co$/.test(url) && key.length > 20
export const supabaseUrl = url

/**
 * Browser client: the session lives in localStorage (standard for a web app;
 * the desktop keeps it in the OS keychain). Access is enforced by RLS.
 */
export const sb: SupabaseClient = createClient(url || 'https://invalid.supabase.co', key || 'missing', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'nexusmind-web-auth' },
})

export async function currentUserId(): Promise<string> {
  const { data } = await sb.auth.getSession()
  const id = data.session?.user?.id
  if (!id) throw new Error('LOGIN_REQUIRED')
  return id
}
