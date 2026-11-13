// Supabase Edge Function: web-handoff.
// Called by the signed-in DESKTOP app to open the web app already signed in:
// returns a single-use magic-link token hash for the caller's own account.
// The desktop opens <web>/#handoff=<hash>; the web app exchanges it with
// auth.verifyOtp({ token_hash, type: 'magiclink' }). No e-mail is sent.
import { createClient } from 'npm:@supabase/supabase-js@2.49.4'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return json(401, { error: 'login_required' })

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: userData, error: userErr } = await admin.auth.getUser(token)
  const email = userData?.user?.email
  if (userErr || !email) return json(401, { error: 'invalid_session' })

  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  const hash = data?.properties?.hashed_token
  if (error || !hash) return json(500, { error: 'link_failed' })
  return json(200, { token_hash: hash })
})
