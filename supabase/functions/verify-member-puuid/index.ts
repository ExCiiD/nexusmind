// Supabase Edge Function: verify-member-puuid (#38, CyberSecurity review, 19/11/2026).
// POST (no body) with the member's own Authorization: Bearer <access token>.
//
// group_members.puuid is never written by clients. For each of the caller's memberships, this resolves the Riot
// ID they declared (riot_id, "Name#TAG") through the Ascend Riot proxy, with the caller's own token (the proxy
// already authenticates Supabase users and holds the Riot key; this function holds no Riot key), and writes the
// puuid with the service role. A Riot ID that does not exist clears the puuid. A puuid another member of the group
// already holds is refused (unique index): reported, not written.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (provided by Supabase), RIOT_PROXY_URL (the proxy's base URL).
// Auth is verified here (auth.getUser), so the function is deployed with verify_jwt = false, like delete-account.
import { createClient } from 'npm:@supabase/supabase-js@2.49.4'

// CORS: only the web app (the desktop calls from its main process, without an Origin header). WEB_APP_ORIGINS is a
// comma-separated list; the default is the web app's current address.
// asc3nd.app (19/11/2026): the web app moved to app.asc3nd.app; the old address stays allowed during the transition.
const ALLOWED_ORIGINS = (Deno.env.get('WEB_APP_ORIGINS') ?? 'https://app.asc3nd.app,https://nexusmind-web.nexusmind-riot-proxy.workers.dev')
  .split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean)
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

/** "Name#TAG" → [name, tag], the tag cut at the last '#'; null when not a full Riot ID. */
function splitRiotId(riotId: string | null): [string, string] | null {
  if (!riotId) return null
  const i = riotId.lastIndexOf('#')
  if (i <= 0 || i === riotId.length - 1) return null
  return [riotId.slice(0, i).trim(), riotId.slice(i + 1).trim()]
}

const PUUID = /^[A-Za-z0-9_-]{20,100}$/

Deno.serve(async (req) => {
  // Per request: concurrent requests must never share each other's CORS headers.
  const cors = corsFor(req)
  if (cors === null) return new Response(JSON.stringify({ error: 'origin_not_allowed' }), { status: 403 })
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...cors } })
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return json(401, { error: 'login_required' })
  const proxy = (Deno.env.get('RIOT_PROXY_URL') ?? '').replace(/\/+$/, '')
  if (!proxy) return json(500, { error: 'proxy_not_configured' })

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: userData, error: userErr } = await admin.auth.getUser(token)
  if (userErr || !userData?.user) return json(401, { error: 'invalid_session' })
  const uid = userData.user.id

  const { data: rows, error } = await admin.from('group_members').select('group_id, riot_id, puuid').eq('user_id', uid)
  if (error) return json(500, { error: 'read_failed' })

  // One Riot lookup per distinct declared Riot ID (account-v1 answers on any regional route).
  const resolved = new Map<string, string | null>()
  for (const r of rows ?? []) {
    const id = splitRiotId(r.riot_id)
    if (!id || resolved.has(r.riot_id)) continue
    const res = await fetch(`${proxy}/europe/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(id[0])}/${encodeURIComponent(id[1])}`, {
      headers: { authorization: `Bearer ${token}` },
    })
    if (res.status === 404) { resolved.set(r.riot_id, null); continue }
    if (!res.ok) return json(502, { error: 'riot_unavailable', status: res.status })
    const acct = await res.json().catch(() => null) as { puuid?: string } | null
    resolved.set(r.riot_id, acct?.puuid && PUUID.test(acct.puuid) ? acct.puuid : null)
  }

  // puuid_status (read by every member, shown to the staff): 'verified', 'not_found' (no such Riot ID), or
  // 'conflict' (another member of the group already holds that puuid: two members claim the same player).
  const write = (r: { group_id: string; riot_id: string }, patch: Record<string, unknown>) =>
    admin.from('group_members').update(patch).eq('group_id', r.group_id).eq('user_id', uid).eq('riot_id', r.riot_id)

  let verified = 0
  const conflicts: string[] = []
  for (const r of rows ?? []) {
    if (!resolved.has(r.riot_id)) continue
    const puuid = resolved.get(r.riot_id) ?? null
    if (!puuid) {
      const { error: e } = await write(r, { puuid: null, puuid_status: 'not_found' })
      if (e) return json(500, { error: 'write_failed' })
      continue
    }
    const { error: upErr } = await write(r, { puuid, puuid_status: 'verified' })
    if (upErr?.code === '23505') {
      conflicts.push(r.group_id)
      const { error: e } = await write(r, { puuid: null, puuid_status: 'conflict' })
      if (e) return json(500, { error: 'write_failed' })
      continue
    }
    if (upErr) return json(500, { error: 'write_failed' })
    verified++
  }
  return json(200, { verified, conflicts })
})
