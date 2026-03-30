import { createClient, SupabaseClient } from '@supabase/supabase-js'

let client: SupabaseClient | null = null

export function getSupabase(): SupabaseClient {
  if (!client) {
    const url = process.env.MAIN_VITE_SUPABASE_URL
    const key = process.env.MAIN_VITE_SUPABASE_ANON_KEY
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
