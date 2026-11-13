// Supabase Edge Function: delete-account (GDPR "right to erasure").
// Deletes every cloud backup file of the caller, then the auth user itself
// (rows in public.cloud_backups cascade). Local data on the PC is untouched.
//
// Auth is verified here (auth.getUser), so the function is deployed with
// verify_jwt = false — that gateway check only supports legacy HS256 keys.
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
  if (userErr || !userData?.user) return json(401, { error: 'invalid_session' })
  const uid = userData.user.id

  // Remove storage objects first: they don't cascade from auth.users.
  let filesRemoved = 0
  for (;;) {
    const { data: files, error } = await admin.storage.from('backups').list(uid, { limit: 100 })
    if (error) return json(500, { error: 'storage_list_failed', detail: error.message })
    if (!files || files.length === 0) break
    const paths = files.map((f) => `${uid}/${f.name}`)
    const { error: rmErr } = await admin.storage.from('backups').remove(paths)
    if (rmErr) return json(500, { error: 'storage_remove_failed', detail: rmErr.message })
    filesRemoved += paths.length
  }

  const { error: delErr } = await admin.auth.admin.deleteUser(uid)
  if (delErr) return json(500, { error: 'delete_user_failed', detail: delErr.message })

  return json(200, { deleted: true, filesRemoved })
})
