import { createClient, SupabaseClient } from '@supabase/supabase-js'

let client: SupabaseClient | null = null

export function getSupabase(): SupabaseClient {
  if (!client) {
    const url = (import.meta.env.MAIN_VITE_SUPABASE_URL as string | undefined)?.trim()
    const key = (import.meta.env.MAIN_VITE_SUPABASE_ANON_KEY as string | undefined)?.trim()
    if (!url || !key) {
      throw new Error('Supabase URL and anon key must be set in environment variables (MAIN_VITE_SUPABASE_URL, MAIN_VITE_SUPABASE_ANON_KEY)')
    }
    client = createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true },
    })
  }
  return client
}

export function resetSupabaseClient() {
  client = null
}
