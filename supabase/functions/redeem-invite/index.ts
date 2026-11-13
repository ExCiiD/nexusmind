// Supabase Edge Function: redeem-invite (invite-only access).
// POST { email, code } — creates the account when the code is a valid access
// invite (public.access_invites) or a valid group invite (W3), so the caller
// can then receive an e-mail sign-in code. Public sign-ups are disabled.
//
// Responses never reveal whether an e-mail already has an account.
// Brute force: 10 failed attempts per IP per hour, then 429.
import { createClient } from 'npm:@supabase/supabase-js@2.49.4'

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
  'access-control-allow-methods': 'POST, OPTIONS',
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...CORS } })

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const CODE = /^[A-Z0-9]{6,16}$/
const MAX_FAILS_PER_HOUR = 10

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })

  let body: { email?: unknown; code?: unknown }
  try { body = await req.json() } catch { return json(400, { error: 'invalid_request' }) }
  const email = String(body.email ?? '').trim().toLowerCase()
  const code = String(body.code ?? '').trim().toUpperCase()
  if (!EMAIL.test(email) || email.length > 254 || !CODE.test(code)) return json(400, { error: 'invalid_request' })

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const ip = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const ipHash = await sha256(`nexusmind-invite:${ip}`)
  const since = new Date(Date.now() - 3600_000).toISOString()
  const { count } = await admin.from('access_invite_attempts')
    .select('id', { count: 'exact', head: true }).eq('ip_hash', ipHash).eq('ok', false).gte('created_at', since)
  if ((count ?? 0) >= MAX_FAILS_PER_HOUR) return json(429, { error: 'too_many_attempts' })

  const fail = async () => {
    await admin.from('access_invite_attempts').insert({ ip_hash: ipHash, ok: false })
    return json(400, { error: 'invalid_invite' })
  }

  const now = new Date().toISOString()
  // 1. App access invite (optionally bound to one e-mail)
  const { data: access } = await admin.from('access_invites')
    .select('code, email, uses, max_uses').eq('code', code).eq('revoked', false).gt('expires_at', now).maybeSingle()
  let kind: 'access' | 'group' | null = null
  if (access && access.uses < access.max_uses && (!access.email || access.email === email)) kind = 'access'

  // 2. Otherwise a group invite (coach / team) also grants access to the app
  if (!kind) {
    const { data: group } = await admin.from('group_invites')
      .select('code, uses, max_uses').eq('code', code).gt('expires_at', now).maybeSingle()
    if (group && group.uses < group.max_uses) kind = 'group'
  }
  if (!kind) return fail()

  const { error: createErr } = await admin.auth.admin.createUser({ email, email_confirm: true })
  const alreadyExists = !!createErr && /already|registered|exists/i.test(createErr.message)
  if (createErr && !alreadyExists) return json(500, { error: 'create_failed' })

  // Access invites are consumed here; group invites when the user joins the group.
  if (kind === 'access' && !alreadyExists) {
    await admin.from('access_invites').update({ uses: access!.uses + 1 }).eq('code', code).lt('uses', access!.max_uses)
  }
  await admin.from('access_invite_attempts').insert({ ip_hash: ipHash, ok: true })
  return json(200, { ok: true })
})
