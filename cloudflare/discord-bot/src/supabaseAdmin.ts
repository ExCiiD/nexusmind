import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Env } from './index'

/** Service-role client — bypasses RLS. See discordBotCore.ts's file
 *  comment for why that's safe here and what the Worker must check itself. */
export function adminClient(env: Env): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
}
