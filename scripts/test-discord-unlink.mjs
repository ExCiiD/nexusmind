#!/usr/bin/env node
/**
 * End-to-end check of supabase/migrations/20261119230000_discord_unlink_guild.sql (#34) on a throw-away Postgres
 * (PGlite, in memory), never on the project's database. Stand-ins: groups, members, discord_guild_links; the
 * migration brings its own private.is_discord_manager, and the function runs as the API role would call it.
 *
 * Usage: node scripts/test-discord-unlink.mjs <folder where @electric-sql/pglite is installed>
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
const migration = readFileSync(join(repo, 'supabase/migrations/20261119230000_discord_unlink_guild.sql'), 'utf-8')

const db = new PGlite()
let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  ${detail}`}`)
  if (!ok) failures++
}
const U = (n) => `00000000-0000-0000-0000-00000000000${n}`
const G = (n) => `10000000-0000-0000-0000-00000000000${n}`
const [coach, player, otherCoach, manager, analyst] = [U(1), U(2), U(3), U(4), U(5)]

await db.exec(`
  create schema auth;
  create schema private;
  create role anon;
  create role authenticated;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable
    as $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
  create table public.groups (id uuid primary key);
  create table public.group_members (group_id uuid, user_id uuid, role text, primary key (group_id, user_id));
  create table public.discord_guild_links (guild_id text primary key, group_id uuid not null, notify_channel_id text, linked_by uuid);
  grant usage on schema public, private, auth to authenticated;
  grant execute on function auth.uid() to authenticated;
`)
await db.query('insert into auth.users values ($1), ($2), ($3), ($4), ($5)', [coach, player, otherCoach, manager, analyst])
await db.query('insert into public.groups values ($1), ($2)', [G(1), G(2)])
await db.query(`insert into public.group_members values ($1, $2, 'coach'), ($1, $3, 'player'), ($4, $5, 'coach'), ($4, $6, 'manager'), ($1, $7, 'analyst')`,
  [G(1), coach, player, G(2), otherCoach, manager, analyst])
await db.query(`insert into public.discord_guild_links values ('guild-1', $1, 'c1', $2), ('guild-2', $3, 'c2', $4)`, [G(1), coach, G(2), otherCoach])

let err = null
try { await db.exec(migration) } catch (e) { err = e.message }
check('migration applies', err === null, err)

async function unlinkAs(user, group) {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [user ?? ''])
  await db.exec('set role authenticated')
  try { return { value: (await db.query('select public.unlink_discord_guild($1) as v', [group])).rows[0].v } } catch (e) { return { error: e.message } } finally {
    await db.exec('reset role')
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`)
  }
}
const links = async () => (await db.query('select guild_id from public.discord_guild_links order by guild_id')).rows.map((r) => r.guild_id)

check('a player of the group is refused', /FORBIDDEN/.test((await unlinkAs(player, G(1))).error ?? ''))
check('the coach of another group is refused', /FORBIDDEN/.test((await unlinkAs(otherCoach, G(1))).error ?? ''))
check('an analyst of the group is refused (Discord roles: owner, coach, manager)', /FORBIDDEN/.test((await unlinkAs(analyst, G(1))).error ?? ''))
check('signed out is refused', /LOGIN_REQUIRED/.test((await unlinkAs(null, G(1))).error ?? ''))
check('nothing was unlinked by the refusals', JSON.stringify(await links()) === JSON.stringify(['guild-1', 'guild-2']))
check('the group\'s coach unlinks its server', (await unlinkAs(coach, G(1))).value === true)
check('only that group\'s link is gone', JSON.stringify(await links()) === JSON.stringify(['guild-2']))
check('again: nothing left to unlink (false)', (await unlinkAs(coach, G(1))).value === false)
check('a manager unlinks their own group\'s server', (await unlinkAs(manager, G(2))).value === true && (await links()).length === 0)
check('anon cannot call it', !(await db.query(`select has_function_privilege('anon', 'public.unlink_discord_guild(uuid)', 'execute') as x`)).rows[0].x)
err = null
try { await db.exec(migration) } catch (e) { err = e.message }
check('migration is re-runnable', err === null, err)

await db.close()
console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
