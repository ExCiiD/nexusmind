#!/usr/bin/env node
/**
 * End-to-end check of supabase/migrations/20261119200000_account_deletion_keeps_groups.sql
 * (S19-16) on a throw-away Postgres, never on the project's database.
 *
 * Runs on PGlite (Postgres compiled to WebAssembly, in memory). The nine
 * tables are stand-ins with the production facts that matter here, read
 * (read-only) by CyberSecurity on 19/11/2026: NOT NULL columns, foreign keys
 * to auth.users in NO ACTION, team_session_feedback keyed on user_id,
 * groups.created_by in CASCADE.
 *
 * Usage: node scripts/test-account-deletion.mjs <folder where @electric-sql/pglite is installed>
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
const migration = readFileSync(join(repo, 'supabase/migrations/20261119200000_account_deletion_keeps_groups.sql'), 'utf-8')
const migrationContent = readFileSync(join(repo, 'supabase/migrations/20261119210000_account_deletion_keeps_group_content.sql'), 'utf-8')

// #33: what a member created for the group (CASCADE in production today).
const CONTENT = [
  ['scrims', 'created_by'], ['calendar_events', 'created_by'], ['team_rosters', 'created_by'],
  ['team_scouting', 'created_by'], ['team_drafts', 'created_by'], ['announcements', 'created_by'],
  ['tasks', 'created_by'], ['team_codex_rules', 'created_by'], ['vod_review_sessions', 'created_by'],
  ['vod_review_comments', 'author_id'], ['vod_review_action_items', 'created_by'], ['review_comments', 'author_id'],
  ['assigned_objectives', 'assigned_by'], ['dev_plans', 'created_by'], ['dev_plan_checkins', 'created_by'],
  ['micro_review_verdicts', 'coach_id'], ['trial_candidates', 'created_by'], ['trial_evaluations', 'created_by'],
  ['staff_notes', 'created_by'], ['discord_guild_links', 'linked_by'],
]
// About the person, or short-lived: must stay CASCADE.
const PERSONAL = [['availability_exceptions', 'user_id'], ['group_invites', 'created_by'], ['discord_guild_link_codes', 'created_by']]

const db = new PGlite()
let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  ${detail}`}`)
  if (!ok) failures++
}
const one = async (sql, params) => (await db.query(sql, params)).rows[0]
const count = async (sql, params) => Number((await one(sql, params)).n)

// ── Stand-in schema (before the migration) ─────────────────────────────────
await db.exec(`
  create schema auth;
  create schema private;
  create role anon;
  create role authenticated;
  create table auth.users (id uuid primary key);

  create table public.groups (
    id uuid primary key, name text not null,
    created_by uuid not null references auth.users (id) on delete cascade
  );
  create table public.group_members (
    group_id uuid not null references public.groups (id) on delete cascade,
    user_id uuid not null references auth.users (id) on delete cascade,
    role text not null, is_captain boolean not null default false, joined_at timestamptz not null default now(),
    primary key (group_id, user_id)
  );

  create table public.team_discussion_comments (id serial primary key, group_id uuid references public.groups (id) on delete cascade, author_id uuid not null references auth.users (id));
  create table public.team_session_feedback (session_id int not null, user_id uuid not null references auth.users (id), body text, primary key (session_id, user_id));
  create table public.team_session_games (id serial primary key, reported_by uuid not null references auth.users (id));
  create table public.team_session_reviews (id serial primary key, recorded_by uuid not null references auth.users (id));
  create table public.team_session_objectives (session_id int primary key, set_by uuid not null references auth.users (id));
  create table public.calendar_event_requests (id serial primary key, requested_by uuid not null references auth.users (id));
  create table public.group_fundamentals (id serial primary key, created_by uuid not null references auth.users (id));
  create table public.report_shares (id serial primary key, created_by uuid not null references auth.users (id));
  create table public.calendar_subscriptions (id serial primary key, created_by uuid not null references auth.users (id));
`)
for (const [t, c] of CONTENT) {
  await db.exec(`create table public.${t} (id serial primary key, group_id uuid references public.groups (id) on delete cascade,
    ${c} uuid not null references auth.users (id) on delete cascade)`)
}
for (const [t, c] of PERSONAL) {
  await db.exec(`create table public.${t} (id serial primary key, ${c} uuid not null references auth.users (id) on delete cascade)`)
}

// RLS on micro_review_verdicts, as in production: auth.uid() from the request,
// the production is_group_staff, and the existing read / delete-own policies.
await db.exec(`
  create function auth.uid() returns uuid language sql stable
    as $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
  create function private.is_group_staff(p_group uuid, p_user uuid default auth.uid())
    returns boolean language sql stable security definer set search_path = ''
    as $f$ select exists (select 1 from public.group_members
                          where group_id = p_group and user_id = p_user and role in ('owner', 'coach', 'analyst')) $f$;
  alter table public.micro_review_verdicts enable row level security;
  create policy "micro_verdicts_read" on public.micro_review_verdicts for select to authenticated
    using (private.is_group_staff(group_id));
  create policy "micro_verdicts_delete_own" on public.micro_review_verdicts for delete to authenticated
    using (coach_id = auth.uid());
  grant usage on schema public, private, auth to authenticated;
  grant select, delete on public.micro_review_verdicts to authenticated;
  grant execute on function auth.uid() to authenticated;
  grant execute on function private.is_group_staff(uuid, uuid) to authenticated;
`)

/** Deletes the orphaned verdicts as `user` (through RLS) and returns how many went. */
async function deleteOrphanedVerdictsAs(user) {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [user])
  await db.exec('set role authenticated')
  try {
    return (await db.query('delete from public.micro_review_verdicts where coach_id is null')).affectedRows ?? 0
  } finally {
    await db.exec('reset role')
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`)
  }
}

const U = (n) => `00000000-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`
const G = (n) => `10000000-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`
const [owner, coach, player, solo, writer, captain, elder, coOwner] = [1, 2, 3, 4, 5, 6, 7, 8].map(U)

async function seed() {
  for (const u of [owner, coach, player, solo, writer, captain, elder, coOwner]) await db.query('insert into auth.users values ($1)', [u])
  // G1: owner + coach + player + writer. G2: owner + player only. G3: solo, alone.
  // G4: two owners. G5: owner + an older player + the captain (joined later).
  await db.query(`insert into public.groups values
    ($1, 'Team', $6), ($2, 'Duo', $6), ($3, 'Solo', $7), ($4, 'Two owners', $6), ($5, 'Captain', $6)`,
    [G(1), G(2), G(3), G(4), G(5), owner, solo])
  await db.query(`insert into public.group_members (group_id, user_id, role, is_captain, joined_at) values
    ($1, $6, 'owner', false, '2026-01-01'), ($1, $7, 'coach', false, '2026-03-01'), ($1, $8, 'player', false, '2026-02-01'),
    ($1, $9, 'player', false, '2026-02-15'),
    ($2, $6, 'owner', false, '2026-01-01'), ($2, $8, 'player', false, '2026-02-01'),
    ($3, $10, 'owner', false, '2026-01-01'),
    ($4, $6, 'owner', false, '2026-01-01'), ($4, $11, 'owner', false, '2026-04-01'), ($4, $7, 'coach', false, '2026-02-01'),
    ($5, $6, 'owner', false, '2026-01-01'), ($5, $12, 'player', false, '2026-01-15'), ($5, $13, 'player', true, '2026-05-01')`,
    [G(1), G(2), G(3), G(4), G(5), owner, coach, player, writer, solo, coOwner, elder, captain])

  // `writer` and `owner` each wrote one row in each table of both migrations.
  for (const u of [writer, owner]) {
    await db.query('insert into public.team_discussion_comments (group_id, author_id) values ($1, $2)', [G(1), u])
    await db.query('insert into public.team_session_feedback (session_id, user_id, body) values (1, $1, $2)', [u, 'gg'])
    await db.query('insert into public.team_session_games (reported_by) values ($1)', [u])
    await db.query('insert into public.team_session_reviews (recorded_by) values ($1)', [u])
    await db.query('insert into public.calendar_event_requests (requested_by) values ($1)', [u])
    await db.query('insert into public.group_fundamentals (created_by) values ($1)', [u])
    await db.query('insert into public.report_shares (created_by) values ($1)', [u])
    await db.query('insert into public.calendar_subscriptions (created_by) values ($1)', [u])
    for (const [t, c] of CONTENT) await db.query(`insert into public.${t} (group_id, ${c}) values ($1, $2)`, [u === owner ? G(2) : G(1), u])
    for (const [t, c] of PERSONAL) await db.query(`insert into public.${t} (${c}) values ($1)`, [u])
  }
  await db.query('insert into public.team_session_objectives (session_id, set_by) values (1, $1), (2, $2)', [writer, owner])
}

await seed()

// ── The bug, before the migrations ──────────────────────────────────────────
let blocked = false
try { await db.query('delete from auth.users where id = $1', [writer]) } catch { blocked = true }
check('before: deleting a user who wrote rows fails (NO ACTION)', blocked)

// ── Apply both migrations, in order ─────────────────────────────────────────
for (const [name, sql] of [['S19-16', migration], ['#33', migrationContent]]) {
  let err = null
  try { await db.exec(sql) } catch (e) { err = e.message }
  check(`migration ${name} applies`, err === null, err)
  if (err) { await db.close(); process.exit(1) }
}

const fkOf = (t, c) => one(`select c.confdeltype as d, a.attnotnull as nn from pg_constraint c
  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
  where c.contype = 'f' and c.conrelid = $1::regclass and a.attname = $2`, [`public.${t}`, c])

const tables = [
  ['team_discussion_comments', 'author_id', 'n'], ['team_session_feedback', 'user_id', 'c'],
  ['team_session_games', 'reported_by', 'n'], ['team_session_reviews', 'recorded_by', 'n'],
  ['team_session_objectives', 'set_by', 'n'], ['calendar_event_requests', 'requested_by', 'n'],
  ['group_fundamentals', 'created_by', 'n'], ['report_shares', 'created_by', 'n'],
  ['calendar_subscriptions', 'created_by', 'n'], ['groups', 'created_by', 'n'],
  ...CONTENT.map(([t, c]) => [t, c, 'n']),
  ...PERSONAL.map(([t, c]) => [t, c, 'c']),
]
for (const [t, c, want] of tables) {
  const r = await fkOf(t, c)
  check(`schema: ${t}.${c} on delete ${want === 'n' ? 'set null, nullable' : 'cascade, not null'}`,
    r && r.d === want && r.nn === (want === 'c'), JSON.stringify(r))
}

// ── A member who wrote in every table deletes their account ────────────────
let error = null
try { await db.query('delete from auth.users where id = $1', [writer]) } catch (e) { error = e.message }
check('writer: account deletion succeeds', error === null, error)
for (const [t, c, want] of tables.filter(([t]) => t !== 'groups')) {
  if (want === 'c') {
    check(`writer: ${t} row deleted, the owner's kept`,
      (await count(`select count(*) n from public.${t} where ${c} = $1`, [writer])) === 0
      && (await count(`select count(*) n from public.${t} where ${c} = $1`, [owner])) === 1)
  } else {
    check(`writer: ${t} row kept, author anonymised`, (await count(`select count(*) n from public.${t} where ${c} is null`)) === 1)
  }
}

// ── The creator/owner of four groups deletes their account ─────────────────
const roleOf = async (g, u) => (await one('select role from public.group_members where group_id = $1 and user_id = $2', [g, u]))?.role
error = null
try { await db.query('delete from auth.users where id = $1', [owner]) } catch (e) { error = e.message }
check('owner: account deletion succeeds', error === null, error)
check('owner: G1 kept', (await count('select count(*) n from public.groups where id = $1', [G(1)])) === 1)
check('owner: G1 owner role goes to the coach (staff first)', (await roleOf(G(1), coach)) === 'owner')
check('owner: G1 created_by moves to the new owner', (await one('select created_by from public.groups where id = $1', [G(1)]))?.created_by === coach)
check('owner: G2 (no staff) goes to its player', (await roleOf(G(2), player)) === 'owner')
check('owner: what they created for G2 is kept, anonymised (#33)',
  (await count('select count(*) n from public.scrims where group_id = $1 and created_by is null', [G(2)])) === 1
  && (await count('select count(*) n from public.discord_guild_links where group_id = $1 and linked_by is null', [G(2)])) === 1)
check('owner: G4 already had another owner, nobody promoted', (await roleOf(G(4), coach)) === 'coach' && (await roleOf(G(4), coOwner)) === 'owner')
check('owner: G4 created_by moves to the remaining owner', (await one('select created_by from public.groups where id = $1', [G(4)]))?.created_by === coOwner)
check('owner: G5 goes to the captain before the older player', (await roleOf(G(5), captain)) === 'owner' && (await roleOf(G(5), elder)) === 'player')
check('owner: no group without an owner', (await count(`select count(*) n from public.groups g where not exists
  (select 1 from public.group_members m where m.group_id = g.id and m.role = 'owner')`)) === 0)

// ── An orphaned verdict can be cleared by the group's staff only (#33) ─────
// Now: writer's verdict in G1 and owner's verdict in G2 have no coach any more.
check('verdicts: both orphaned (coach_id null)', (await count('select count(*) n from public.micro_review_verdicts where coach_id is null')) === 2)
check('verdicts: a plain player cannot delete them', (await deleteOrphanedVerdictsAs(elder)) === 0)
check('verdicts: G1\'s new owner deletes G1\'s only', (await deleteOrphanedVerdictsAs(coach)) === 1
  && (await count('select count(*) n from public.micro_review_verdicts where coach_id is null and group_id = $1', [G(2)])) === 1)
check('verdicts: the policy exists after the migration', (await count(`select count(*) n from pg_policies
  where tablename = 'micro_review_verdicts' and policyname = 'micro_verdicts_delete_orphaned'`)) === 1)

// ── Someone alone in their group ────────────────────────────────────────────
error = null
try { await db.query('delete from auth.users where id = $1', [solo]) } catch (e) { error = e.message }
check('solo: account deletion succeeds', error === null, error)
check('solo: their empty group is deleted', (await count('select count(*) n from public.groups where id = $1', [G(3)])) === 0)

// ── The trigger function is not callable by API roles ───────────────────────
const exec = await one(`select has_function_privilege('authenticated', 'private.hand_over_groups_of(uuid)', 'execute') as a,
  has_function_privilege('anon', 'private.hand_over_groups_of(uuid)', 'execute') as b`)
check('hand_over_groups_of not executable by anon/authenticated', !exec.a && !exec.b, JSON.stringify(exec))

// ── Both migrations can be run again ────────────────────────────────────────
for (const [name, sql] of [['S19-16', migration], ['#33', migrationContent]]) {
  await db.exec(sql).then(() => check(`migration ${name} is re-runnable`, true), (e) => check(`migration ${name} is re-runnable`, false, e.message))
}

await db.close()
console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
