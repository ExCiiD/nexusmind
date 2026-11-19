#!/usr/bin/env node
/**
 * End-to-end check of supabase/migrations/20261119220000_wellbeing_consent.sql on a throw-away Postgres (PGlite,
 * in memory), never on the project's database. The wellbeing tables are created from the repo's own migration
 * (20261114050000_e6_wellbeing.sql) on a minimal stand-in of groups and sharing; RLS is real.
 *
 * Usage: node scripts/test-wellbeing-consent.mjs <folder where @electric-sql/pglite is installed>
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
const read = (f) => readFileSync(join(repo, 'supabase/migrations', f), 'utf-8')

const db = new PGlite()
let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  ${detail}`}`)
  if (!ok) failures++
}
const count = async (sql, params) => Number((await db.query(sql, params)).rows[0].n)

const U = (n) => `00000000-0000-0000-0000-00000000000${n}`
const [me, other] = [U(1), U(2)]
const G1 = '10000000-0000-0000-0000-000000000001'

await db.exec(`
  create schema auth;
  create schema private;
  create role anon;
  create role authenticated;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable
    as $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
  create table public.groups (id uuid primary key);
  create table public.group_members (group_id uuid references public.groups (id), user_id uuid references auth.users (id), role text, primary key (group_id, user_id));
  create table public.group_sharing (group_id uuid references public.groups (id), user_id uuid references auth.users (id),
    share_reviews boolean not null default true, primary key (group_id, user_id));
  grant usage on schema public, private, auth to authenticated;
  grant execute on function auth.uid() to authenticated;
  -- Like Supabase: tables created later get full rights for the API roles, so only the migration's own
  -- revoke and RLS can stop a direct write.
  alter default privileges in schema public grant all on tables to anon, authenticated;
`)
await db.exec(read('20261114050000_e6_wellbeing.sql'))
await db.exec('grant select, insert, update, delete on public.wellbeing_checkins to authenticated')
await db.exec('grant select, update on public.group_sharing to authenticated')

await db.query('insert into auth.users values ($1), ($2)', [me, other])
await db.query('insert into public.groups values ($1)', [G1])
await db.query(`insert into public.group_members values ($1, $2, 'player'), ($1, $3, 'coach')`, [G1, me, other])
await db.query('insert into public.group_sharing (group_id, user_id, share_wellbeing) values ($1, $2, true)', [G1, me])
// A check-in from before consent existed (kept by the migration, deleted by a withdrawal).
await db.query('insert into public.wellbeing_checkins (user_id, energy, mood, sleep) values ($1, 3, 3, 3)', [me])

let err = null
try { await db.exec(read('20261119220000_wellbeing_consent.sql')) } catch (e) { err = e.message }
check('migration applies', err === null, err)
if (err) process.exit(1)

/** Runs `fn` as `user` through RLS. */
async function as(user, fn) {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [user])
  await db.exec('set role authenticated')
  try { return await fn() } finally {
    await db.exec('reset role')
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`)
  }
}
const attempt = async (user, sql, params) => as(user, async () => {
  try { await db.query(sql, params); return null } catch (e) { return e.message }
})
const checkin = () => attempt(me, 'insert into public.wellbeing_checkins (user_id, energy, mood, sleep) values ($1, 4, 4, 4)', [me])

check('no consent yet: a new check-in is refused', (await checkin()) !== null)
const sharing = (on) => attempt(me, 'update public.group_sharing set share_wellbeing = $1 where user_id = $2', [on, me])
check('turning share_wellbeing off is always allowed', (await sharing(false)) === null)
check('no consent: share_wellbeing cannot be turned on', /WELLBEING_CONSENT_REQUIRED/.test((await sharing(true)) ?? ''))
check('has_wellbeing_consent takes no user (cannot probe someone else)', (await attempt(other, 'select private.has_wellbeing_consent($1)', [me])) !== null)
check('the log cannot be written directly', (await attempt(me, `insert into public.wellbeing_consent_events (user_id, granted, version) values ($1, true, 'v0.3')`, [me])) !== null)
check('a bad version is refused', (await attempt(me, `select public.set_wellbeing_consent(true, 'latest')`)) !== null)

check('grant via the RPC', (await attempt(me, `select public.set_wellbeing_consent(true, 'v0.3')`)) === null)
check('granted: a new check-in is accepted', (await checkin()) === null)
check('granted: share_wellbeing can be turned on', (await sharing(true)) === null)
check('has_wellbeing_consent() answers for the caller only', (await as(me, async () => (await db.query('select private.has_wellbeing_consent() as c')).rows[0].c)) === true
  && (await as(other, async () => (await db.query('select private.has_wellbeing_consent() as c')).rows[0].c)) === false)
check('the proof is server-timestamped and versioned', (await count(`select count(*) n from public.wellbeing_consent_events
  where user_id = $1 and granted and version = 'v0.3' and created_at is not null`, [me])) === 1)
check('another user cannot read my consent log', (await as(other, async () => (await db.query('select * from public.wellbeing_consent_events')).rows.length)) === 0)
check('the log cannot be edited or erased by its owner', (await as(me, async () => {
  const u = await db.query('update public.wellbeing_consent_events set granted = false').catch(() => ({ affectedRows: 0 }))
  const d = await db.query('delete from public.wellbeing_consent_events').catch(() => ({ affectedRows: 0 }))
  return (u.affectedRows ?? 0) + (d.affectedRows ?? 0)
})) === 0)

check('withdraw via the RPC', (await attempt(me, `select public.set_wellbeing_consent(false, 'v0.3')`)) === null)
check('withdrawn: all my check-ins are deleted', (await count('select count(*) n from public.wellbeing_checkins where user_id = $1', [me])) === 0)
check('withdrawn: share_wellbeing is off in my groups', (await count('select count(*) n from public.group_sharing where user_id = $1 and share_wellbeing', [me])) === 0)
check('withdrawn: a new check-in is refused again', (await checkin()) !== null)
check('withdrawn: share_wellbeing cannot be turned back on', /WELLBEING_CONSENT_REQUIRED/.test((await sharing(true)) ?? ''))
check('the log keeps both events (proof)', (await count('select count(*) n from public.wellbeing_consent_events where user_id = $1', [me])) === 2)
check('anon cannot call the RPC', !(await db.query(`select has_function_privilege('anon', 'public.set_wellbeing_consent(boolean, text)', 'execute') as x`)).rows[0].x)

err = null
try { await db.exec(read('20261119220000_wellbeing_consent.sql')) } catch (e) { err = e.message }
check('migration is re-runnable', err === null, err)

await db.close()
console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
