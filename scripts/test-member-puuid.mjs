#!/usr/bin/env node
/**
 * End-to-end check of supabase/migrations/20261119240000_member_puuid.sql (#38 + CyberSecurity review) on a
 * throw-away Postgres (PGlite, in memory), never on the project's database: the puuid is written by the server only,
 * a Riot ID change clears it, and two members of a group cannot hold the same puuid.
 *
 * Usage: node scripts/test-member-puuid.mjs <folder where @electric-sql/pglite is installed>
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const pgliteDir = process.argv[2]
if (!pgliteDir) { console.error('Pass the folder that holds node_modules/@electric-sql/pglite.'); process.exit(2) }
const require = createRequire(join(pgliteDir, 'package.json'))
const { PGlite } = await import(pathToFileURL(require.resolve('@electric-sql/pglite')).href)
const repo = join(dirname(fileURLToPath(import.meta.url)), '..')
const migration = readFileSync(join(repo, 'supabase/migrations/20261119240000_member_puuid.sql'), 'utf-8')

const db = new PGlite()
let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  ${detail}`}`)
  if (!ok) failures++
}
const [me, mate] = ['00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002']
const G = '10000000-0000-0000-0000-000000000001'
const P1 = 'puuid-AAAAAAAAAAAAAAAAAAAAAAAA'
const P2 = 'puuid-BBBBBBBBBBBBBBBBBBBBBBBB'

await db.exec(`
  create schema auth;
  create schema private;
  create role anon;
  create role authenticated;
  create function auth.uid() returns uuid language sql stable
    as $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
  create table public.group_members (group_id uuid, user_id uuid, role text, display_name text, riot_id text,
    primary key (group_id, user_id));
  alter table public.group_members enable row level security;
  create policy "members_update_own" on public.group_members for update to authenticated
    using (user_id = auth.uid()) with check (user_id = auth.uid());
  create policy "members_read" on public.group_members for select to authenticated using (true);
  grant usage on schema public, auth to authenticated;
  grant execute on function auth.uid() to authenticated;
  grant select on public.group_members to authenticated;
  -- As in production (20261118200000): members update their identity columns only.
  grant update (display_name, riot_id) on public.group_members to authenticated;
`)
await db.query(`insert into public.group_members values ($1, $2, 'player', 'Me', 'Me#EUW'), ($1, $3, 'player', 'Mate', 'Mate#EUW')`, [G, me, mate])

let err = null
try { await db.exec(migration) } catch (e) { err = e.message }
check('migration applies', err === null, err)

async function asMember(user, sql, params) {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [user])
  await db.exec('set role authenticated')
  try { await db.query(sql, params); return null } catch (e) { return e.message } finally {
    await db.exec('reset role')
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`)
  }
}
const puuidOf = async (user) => (await db.query('select puuid from public.group_members where user_id = $1', [user])).rows[0].puuid

check('a member cannot write their own puuid (claiming another player)', (await asMember(me, 'update public.group_members set puuid = $1 where user_id = $2', [P2, me])) !== null)
check('a member cannot mark themselves verified (puuid_status)', (await asMember(me, "update public.group_members set puuid_status = 'verified' where user_id = $1", [me])) !== null)
check('a member can still update their Riot ID', (await asMember(me, `update public.group_members set riot_id = 'Me2#EUW' where user_id = $1`, [me])) === null)

// The service role (the Edge Function) writes the verified puuids.
await db.query("update public.group_members set puuid = $1, puuid_status = 'verified' where user_id = $2", [P1, me])
check('the server writes a verified puuid', (await puuidOf(me)) === P1)
let dup = null
try { await db.query('update public.group_members set puuid = $1 where user_id = $2', [P1, mate]) } catch (e) { dup = e.message }
check('two members of a group cannot hold the same puuid', /unique|duplicate/i.test(dup ?? ''), dup ?? 'no error')
await db.query("update public.group_members set puuid_status = 'conflict' where user_id = $1", [mate])
check('the server records the conflict for the staff to see', (await db.query('select puuid_status from public.group_members where user_id = $1', [mate])).rows[0].puuid_status === 'conflict')

check('changing the Riot ID is allowed…', (await asMember(me, `update public.group_members set riot_id = 'Victim#EUW' where user_id = $1`, [me])) === null)
check('…and clears the puuid until the server verifies the new Riot ID', (await puuidOf(me)) === null)
check('…and its verification status', (await db.query('select puuid_status from public.group_members where user_id = $1', [me])).rows[0].puuid_status === null)
check('a display-name change keeps the puuid', await (async () => {
  await db.query('update public.group_members set puuid = $1 where user_id = $2', [P1, me])
  await asMember(me, `update public.group_members set display_name = 'New' where user_id = $1`, [me])
  return (await puuidOf(me)) === P1
})())
err = null
try { await db.exec(migration) } catch (e) { err = e.message }
check('migration is re-runnable', err === null, err)

await db.close()
console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
