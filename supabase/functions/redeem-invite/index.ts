// Supabase Edge Function: redeem-invite (invite-only access).
// POST { email, code } — creates the account when the code is a valid access
// invite (public.access_invites) or a valid group invite (W3), so the caller
// can then receive an e-mail sign-in code. Public sign-ups are disabled.
//
// Responses never reveal whether an e-mail already has an account.
// Brute force (CyberSecurity review, 19/11/2026):
//   - 10 failed attempts per IP per hour, then 429. The IP is cf-connecting-ip only (set by the platform's edge);
//     x-forwarded-for is never trusted (a client can write it). Without cf-connecting-ip, every such request shares
//     one bucket, and a warning is logged: check on deploy that Supabase provides it.
//   - a global cap of failed attempts per hour, whatever the IP, against a brute force spread over many browsers;
//   - CORS limited to the showcase site and the web app (INVITE_ALLOWED_ORIGINS), so other sites cannot make their
//     visitors' browsers try codes; requests without an Origin (the desktop's main process) are unaffected;
//   - a JSON body is required.
import { createClient } from 'npm:@supabase/supabase-js@2.49.4'

const ALLOWED_ORIGINS = (Deno.env.get('INVITE_ALLOWED_ORIGINS')
  // asc3nd.app (19/11/2026): the site and web app moved; the old addresses stay allowed during the transition.
  ?? 'https://app.asc3nd.app,https://asc3nd.app,https://nexusmind-web.nexusmind-riot-proxy.workers.dev,https://ascend-site.nexusmind-riot-proxy.workers.dev')
  .split(',').map((o) => o.trim().replace(/\/+$/, '')).filter(Boolean)

/** CORS headers for this request: {} without an Origin, null for a site that is not allowed. */
function corsFor(req: Request): Record<string, string> | null {
  const origin = req.headers.get('origin')
  if (!origin) return {}
  if (!ALLOWED_ORIGINS.includes(origin)) return null
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
    'access-control-allow-methods': 'POST, OPTIONS',
    vary: 'Origin',
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
// Real codes are 10 (group) or 12 (access) characters: anything shorter is
// rejected before it counts as a failure.
const CODE = /^[A-Z0-9]{10,16}$/
const MAX_FAILS_PER_HOUR = 10
// Attack detector, not a brute-force guard (codes have >= 8e14 combinations):
// a low cap would let a few IPs block every invite sign-up for an hour.
const MAX_GLOBAL_FAILS_PER_HOUR = Number(Deno.env.get('INVITE_MAX_GLOBAL_FAILS_PER_HOUR') ?? 5000)

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req) => {
  const cors = corsFor(req)
  if (cors === null) return new Response(JSON.stringify({ error: 'origin_not_allowed' }), { status: 403 })
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...cors } })
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })
  if (!(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
    return json(415, { error: 'json_required' })
  }

  let body: { email?: unknown; code?: unknown }
  try { body = await req.json() } catch { return json(400, { error: 'invalid_request' }) }
  const email = String(body.email ?? '').trim().toLowerCase()
  const code = String(body.code ?? '').trim().toUpperCase()
  if (!EMAIL.test(email) || email.length > 254 || !CODE.test(code)) return json(400, { error: 'invalid_request' })

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Never x-forwarded-for: a client can set it to anything and get a fresh bucket on every request.
  const ip = req.headers.get('cf-connecting-ip')?.trim()
  if (!ip) console.warn('[redeem-invite] no cf-connecting-ip header: falling back to one shared bucket')
  const ipHash = await sha256(`nexusmind-invite:${ip || 'unknown'}`)
  const since = new Date(Date.now() - 3600_000).toISOString()
  const [perIp, global] = await Promise.all([
    admin.from('access_invite_attempts')
      .select('id', { count: 'exact', head: true }).eq('ip_hash', ipHash).eq('ok', false).gte('created_at', since),
    admin.from('access_invite_attempts')
      .select('id', { count: 'exact', head: true }).eq('ok', false).gte('created_at', since),
  ])
  if ((perIp.count ?? 0) >= MAX_FAILS_PER_HOUR) return json(429, { error: 'too_many_attempts' })
  if ((global.count ?? 0) >= MAX_GLOBAL_FAILS_PER_HOUR) {
    console.warn('[redeem-invite] global failure cap reached: refusing every attempt for now')
    return json(429, { error: 'too_many_attempts' })
  }

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
