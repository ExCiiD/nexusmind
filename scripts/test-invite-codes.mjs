#!/usr/bin/env node
/**
 * End-to-end check of supabase/migrations/20261119270000_invite_codes_crypto_random.sql (#44, CyberSecurity
 * review) on a throw-away Postgres (PGlite, in memory), never on the project's database.
 *
 * PGlite ships without pgcrypto, so extensions.gen_random_bytes is a stand-in here (test only): it returns
 * random bytes, or, when asked, a first batch of bytes that must all be rejected (>= 248). The checks cover
 * the helper's logic (length, alphabet, rejection, no bias), its callers and who may call it.
 *
 * Usage: node scripts/test-invite-codes.mjs <folder where @electric-sql/pglite is installed>
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
const raw = readFileSync(join(repo, 'supabase/migrations/20261119270000_invite_codes_crypto_random.sql'), 'utf-8')
const EXT = 'create extension if not exists pgcrypto with schema extensions;'
if (!raw.includes(EXT)) { console.error('The migration no longer creates pgcrypto as expected.'); process.exit(2) }
const migration = raw.replace(EXT, '-- pgcrypto: stand-in defined by the test')

const db = new PGlite()
let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  ${detail}`}`)
  if (!ok) failures++
}
const ADMIN = '00000000-0000-0000-0000-000000000001'
const G = '10000000-0000-0000-0000-000000000001'
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

await db.exec(`
  create schema auth;
  create schema private;
  create schema extensions;
  create role anon;
  create role authenticated;
  create function auth.uid() returns uuid language sql stable
    as $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;

  -- Stand-in for pgcrypto: when test.reject_first is on, the first call returns 32 bytes of 255 (all rejected).
  create table extensions.calls (hits int);
  insert into extensions.calls values (0);
  create function extensions.gen_random_bytes(n integer) returns bytea language plpgsql volatile as $f$
  declare b bytea := ''::bytea; k int;
  begin
    update extensions.calls set hits = hits + 1 returning hits into k;
    for i in 1 .. n loop
      if k = 1 and current_setting('test.reject_first', true) = 'on' then
        b := b || '\\xff'::bytea;
      else
        b := b || set_byte('\\x00'::bytea, 0, floor(random() * 256)::int);
      end if;
    end loop;
    return b;
  end $f$;
  grant usage on schema extensions to public;

  create table public.group_invites (code text primary key, group_id uuid, role text, expires_at timestamptz, max_uses int);
  create table public.access_invites (code text primary key, email text, note text, expires_at timestamptz, max_uses int);
  create function private.is_group_staff(g uuid) returns boolean language sql stable as $f$ select auth.uid() is not null $f$;
  create function private.group_role(g uuid) returns text language sql stable as $f$ select 'owner'::text $f$;
  create function private.is_app_admin() returns boolean language sql stable as $f$ select auth.uid() = '${ADMIN}'::uuid $f$;
  grant usage on schema private to authenticated;
`)
await db.exec(migration)
await db.exec(migration) // re-runnable
check('the migration applies twice', true)

const codeOf = async (len) => (await db.query(`select private.random_code(${len}) as c`)).rows[0].c
const valid = (c, len) => c.length === len && [...c].every((ch) => ALPHABET.includes(ch))

// Length and alphabet.
let ok = true
for (const len of [1, 10, 12, 64]) for (let i = 0; i < 20; i++) { const c = await codeOf(len); if (!valid(c, len)) { ok = false; console.log('  bad', len, c) } }
check('codes have the asked length and only the 31 allowed characters', ok)
for (const bad of [0, 65, 'null']) {
  let refused = false
  try { await db.query(`select private.random_code(${bad})`) } catch { refused = true }
  check(`length ${bad} is refused`, refused)
}

// Rejection: a batch made only of bytes >= 248 yields nothing, the loop draws again.
await db.exec(`update extensions.calls set hits = 0; set test.reject_first = 'on';`)
const afterReject = await codeOf(12)
const calls = (await db.query('select hits from extensions.calls')).rows[0].hits
await db.exec(`set test.reject_first = 'off';`)
check('bytes >= 248 are thrown away and more are drawn', valid(afterReject, 12) && calls >= 2, `calls=${calls}`)

// No bias: 62 000 characters, each of the 31 expected 2 000 times.
const big = (await db.query(`select string_agg(private.random_code(62), '') as s from generate_series(1, 1000)`)).rows[0].s
const counts = Object.fromEntries([...ALPHABET].map((ch) => [ch, 0]))
for (const ch of big) counts[ch]++
const values = Object.values(counts)
const chi2 = values.reduce((s, n) => s + (n - 2000) ** 2 / 2000, 0)
// 30 degrees of freedom: 59.7 is the 0.1 % threshold.
check(`characters are uniform (chi-square ${chi2.toFixed(1)} < 59.7, min ${Math.min(...values)}, max ${Math.max(...values)})`, chi2 < 59.7)

// Callers.
await db.exec(`set request.jwt.claim.sub = '${ADMIN}'`)
const gi = (await db.query(`select public.create_group_invite('${G}', 'player') as c`)).rows[0].c
check('create_group_invite returns a 10-character code and stores it', valid(gi, 10) && (await db.query('select count(*)::int as n from public.group_invites where code = $1', [gi])).rows[0].n === 1, gi)
const ai = (await db.query(`select public.create_access_invite('a@b.co') as c`)).rows[0].c
check('create_access_invite returns a 12-character code and stores it', valid(ai, 12) && (await db.query('select count(*)::int as n from public.access_invites where code = $1', [ai])).rows[0].n === 1, ai)
const defs = (await db.query(`select string_agg(prosrc, ' ') as s from pg_proc where proname in ('create_group_invite', 'create_access_invite')`)).rows[0].s
check('neither caller uses random() any more', !/random\(\)/.test(defs))

// Who may call the helper.
for (const role of ['anon', 'authenticated']) {
  let refused = false
  try { await db.exec(`set role ${role}; select private.random_code(10);`) } catch { refused = true }
  await db.exec('reset role')
  check(`${role} cannot call private.random_code directly`, refused)
}
await db.exec(`set role authenticated`)
let viaCaller = null
try { viaCaller = (await db.query(`select public.create_access_invite(null) as c`)).rows[0].c } catch (e) { viaCaller = String(e.message) }
await db.exec('reset role')
check('an admin still creates a code through the security definer function', typeof viaCaller === 'string' && valid(viaCaller, 12), viaCaller)

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed')
process.exit(failures ? 1 : 0)
