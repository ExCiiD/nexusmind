#!/usr/bin/env node
/**
 * End-to-end check, on a throw-away Postgres (PGlite, in memory), never on the project's database, of:
 *   - 20261119165435_team_data_staff_only.sql (#43 / S19-17): a member's team data in sync_records is readable by the
 *     staff of a shared group only, and only when the member shared explicitly;
 *   - 20261119165454_team_custom_games.sql (#41a): the group's custom games, read by members, written by staff,
 *     kept (author anonymised) when their importer deletes their account.
 * Stand-ins: auth.uid(), groups, members, sharing, sync_records, the production group_role / is_group_staff.
 *
 * Usage: node scripts/test-team-data-scope.mjs <folder where @electric-sql/pglite is installed>
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
const U = (n) => `00000000-0000-0000-0000-00000000000${n}`
const [coach, player, analyst, manager, outsider] = [1, 2, 3, 4, 5].map(U)
const [GA, GB] = ['10000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000b']

await db.exec(`
  create schema auth;
  create schema private;
  create role anon;
  create role authenticated;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable
    as $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
  create table public.groups (id uuid primary key);
  create table public.group_members (group_id uuid references public.groups (id), user_id uuid references auth.users (id) on delete cascade,
    role text not null, primary key (group_id, user_id));
  create table public.group_sharing (group_id uuid, user_id uuid, share_reviews boolean, share_stats boolean, share_team boolean,
    primary key (group_id, user_id));
  create function private.group_role(p_group uuid, p_user uuid default auth.uid()) returns text
    language sql stable security definer set search_path = ''
    as $f$ select role from public.group_members where group_id = p_group and user_id = p_user $f$;
  create function private.is_group_staff(p_group uuid, p_user uuid default auth.uid()) returns boolean
    language sql stable security definer set search_path = ''
    as $f$ select exists (select 1 from public.group_members where group_id = p_group and user_id = p_user and role in ('owner', 'coach', 'analyst')) $f$;
  create table public.sync_records (user_id uuid, table_name text, record_id text, data jsonb, primary key (user_id, table_name, record_id));
  alter table public.sync_records enable row level security;
  grant usage on schema public, private, auth to authenticated;
  grant execute on function auth.uid() to authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  grant select on public.sync_records to authenticated;
`)
await db.query('insert into auth.users values ($1), ($2), ($3), ($4), ($5)', [coach, player, analyst, manager, outsider])
await db.query('insert into public.groups values ($1), ($2)', [GA, GB])
// The coach works with teams A and B. A player and a manager are in A only, an analyst in A only, an outsider in B.
await db.query(`insert into public.group_members values
  ($1, $3, 'coach'), ($2, $3, 'coach'), ($1, $4, 'player'), ($1, $5, 'analyst'), ($1, $6, 'manager'), ($2, $7, 'player')`,
  [GA, GB, coach, player, analyst, manager, outsider])
await db.query(`insert into public.sync_records values ($1, 'DraftPrep', 'd1', '{"name":"vs B prep"}'), ($2, 'DraftPrep', 'd2', '{"name":"player draft"}')`, [coach, player])

// ── #43 ──────────────────────────────────────────────────────────────────────
let err = null
try { await db.exec(read('20261119165435_team_data_staff_only.sql')) } catch (e) { err = e.message }
check('#43 migration applies', err === null, err)
await db.exec(`create policy "sync_records_read_shared" on public.sync_records for select to authenticated
  using (user_id = auth.uid() or private.can_read_player_table(user_id, table_name))`)

async function as(user, fn) {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [user])
  await db.exec('set role authenticated')
  try { return await fn() } finally {
    await db.exec('reset role')
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`)
  }
}
const visible = (user, owner) => as(user, async () => (await db.query(`select count(*)::int n from public.sync_records where user_id = $1`, [owner])).rows[0].n)

check('#43 sharing not set: a player cannot read the coach\'s team data any more', (await visible(player, coach)) === 0)
check('#43 sharing not set: staff cannot either (explicit sharing only)', (await visible(analyst, player)) === 0)
await db.query(`insert into public.group_sharing (group_id, user_id, share_team) values ($1, $2, true), ($1, $3, true)`, [GA, coach, player])
check('#43 shared explicitly: a player still cannot read it (staff only)', (await visible(player, coach)) === 0)
check('#43 shared explicitly: an analyst of the group can', (await visible(analyst, player)) === 1)
check('#43 shared explicitly: a manager of the group can', (await visible(manager, player)) === 1)
check('#43 a player of another group cannot', (await visible(outsider, coach)) === 0)
check('#43 everyone still reads their own rows', (await visible(player, player)) === 1)

// ── #41a ─────────────────────────────────────────────────────────────────────
err = null
try { await db.exec(read('20261119165454_team_custom_games.sql')) } catch (e) { err = e.message }
check('#41a migration applies', err === null, err)

const insertGame = (user, group, localId) => as(user, async () => {
  try {
    await db.query(`insert into public.team_custom_games (group_id, game_type, duration_sec, participants, local_id)
      values ($1, 'scrim', 1800, '[{"playerName":"A"}]', $2)`, [group, localId])
    return null
  } catch (e) { return e.message }
})
const gamesSeenBy = (user, group) => as(user, async () => (await db.query('select count(*)::int n from public.team_custom_games where group_id = $1', [group])).rows[0].n)

check('#41a the coach (staff) publishes a scrim of A', (await insertGame(coach, GA, 'loc1')) === null)
check('#41a a player cannot write', (await insertGame(player, GA, 'loc2')) !== null)
check('#41a publishing the same local game again is refused as a duplicate (the app upserts)', (await insertGame(coach, GA, 'loc1')) !== null)
check('#41a a player of A reads A\'s games', (await gamesSeenBy(player, GA)) === 1)
check('#41a a player of B does not see A\'s games', (await gamesSeenBy(outsider, GA)) === 0)
check('#41a a player cannot delete', (await as(player, async () => (await db.query('delete from public.team_custom_games')).affectedRows ?? 0)) === 0)
check('#41a anon has no access', !(await db.query(`select has_table_privilege('anon', 'public.team_custom_games', 'select') as x`)).rows[0].x)
await db.query('delete from auth.users where id = $1', [coach])
check('#41a the importer deletes their account: the game stays, anonymised',
  (await db.query('select count(*)::int n from public.team_custom_games where created_by is null')).rows[0].n === 1)

for (const f of ['20261119165435_team_data_staff_only.sql', '20261119165454_team_custom_games.sql']) {
  err = null
  try { await db.exec(read(f)) } catch (e) { err = e.message }
  check(`re-runnable: ${f}`, err === null, err)
}

await db.close()
console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
