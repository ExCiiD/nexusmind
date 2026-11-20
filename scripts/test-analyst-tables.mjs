#!/usr/bin/env node
/**
 * End-to-end check of supabase/migrations/20261119223819_analyst_draft_log_dossiers.sql (#40) on a throw-away
 * Postgres (PGlite, in memory), never on the project's database: real RLS, the production grants, a stand-in for the
 * tables created outside this folder (team_sessions, team_session_games, as read in production).
 *
 * Usage: node scripts/test-analyst-tables.mjs <folder where @electric-sql/pglite is installed>
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
const migration = readFileSync(join(repo, 'supabase/migrations/20261119223819_analyst_draft_log_dossiers.sql'), 'utf-8')

const db = new PGlite()
let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  ${detail}`}`)
  if (!ok) failures++
}
const one = async (sql, params) => (await db.query(sql, params)).rows[0]
const u = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const OWNER = u(1), COACH = u(2), PLAYER = u(3), OUTSIDER = u(4), OTHER_COACH = u(5)
const G = '10000000-0000-0000-0000-000000000001'
const G2 = '10000000-0000-0000-0000-000000000002'

async function as(user, fn) {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [user])
  await db.exec('set role authenticated')
  try { return await fn() } finally { await db.exec('reset role') }
}
async function fails(user, sql, params) {
  try { await as(user, () => db.query(sql, params)); return null } catch (e) { return e.message }
}
const rowsAs = async (user, sql, params) => (await as(user, () => db.query(sql, params))).rows

await db.exec(`
  create schema auth; create schema private;
  create role anon; create role authenticated;
  create function auth.uid() returns uuid language sql stable
    as $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
  create table auth.users (id uuid primary key);
  insert into auth.users select ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid from generate_series(1, 9) n;
  create table public.groups (id uuid primary key, name text);
  insert into public.groups values ('${G}', 'G'), ('${G2}', 'G2');
  create table public.group_members (group_id uuid, user_id uuid, role text, primary key (group_id, user_id));
  insert into public.group_members values ('${G}', '${OWNER}', 'owner'), ('${G}', '${COACH}', 'coach'), ('${G}', '${PLAYER}', 'player'),
    ('${G2}', '${OTHER_COACH}', 'coach');
  create function private.group_role(p_group uuid, p_user uuid default auth.uid()) returns text language sql stable security definer set search_path = ''
    as $f$ select role from public.group_members where group_id = p_group and user_id = p_user $f$;
  create function private.is_group_staff(p_group uuid, p_user uuid default auth.uid()) returns boolean language sql stable security definer set search_path = ''
    as $f$ select exists (select 1 from public.group_members where group_id = p_group and user_id = p_user and role in ('owner', 'coach', 'analyst')) $f$;
  create table public.notifications (id serial primary key, user_id uuid, type text, data jsonb, link text);
  alter table public.notifications add constraint notifications_type_check check (type in ('mention'));
  create function private.notify(p_user uuid, p_type text, p_data jsonb, p_link text) returns void language sql security definer set search_path = ''
    as $f$ insert into public.notifications (user_id, type, data, link) values (p_user, p_type, p_data, p_link) $f$;

  -- As read in production (columns and policies), 19/11/2026.
  create table public.team_sessions (id uuid primary key, group_id uuid not null);
  create function private.team_session_group(p uuid) returns uuid language sql stable security definer set search_path = ''
    as $f$ select group_id from public.team_sessions where id = p $f$;
  create function private.can_manage_session(p_group uuid, p_user uuid default auth.uid()) returns boolean language sql stable security definer set search_path = ''
    as $f$ select exists (select 1 from public.group_members where group_id = p_group and user_id = p_user and role in ('owner', 'coach', 'manager')) $f$;
  create table public.team_session_games (id uuid primary key default gen_random_uuid(), session_id uuid not null, match_id text not null,
    reported_by uuid, status text not null default 'pending_fetch', created_at timestamptz not null default now(), match_json jsonb,
    our_team_id integer, enemy_team_name text);
  alter table public.team_session_games enable row level security;
  create policy "team_session_games_read" on public.team_session_games for select to authenticated
    using (private.group_role(private.team_session_group(session_id)) is not null);
  create policy "team_session_games_write" on public.team_session_games for all to authenticated
    using (private.group_role(private.team_session_group(session_id)) is not null)
    with check (private.group_role(private.team_session_group(session_id)) is not null);

  grant usage on schema public, private, auth to authenticated, anon;
  grant all on all tables in schema public to authenticated, anon;
  grant usage on all sequences in schema public to authenticated;
  -- As on Supabase: new tables of public are granted to the API roles (RLS and the migration's revokes do the rest).
  alter default privileges in schema public grant all on tables to authenticated, anon;
`)
await db.exec(migration)
await db.exec(migration)
check('the migration applies twice', true)

// ── Draft log ─────────────────────────────────────────────────────────────
const draft = (over = {}) => ({
  group_id: G, match_id: 'EUW1_123', source: 'scrim', played_at: '2026-11-18T19:00:00Z', patch: '16.22', opponent_name: 'Aegis Gaming',
  opponent_key: 'aegis gaming', side: 'blue', win: true, duration_sec: 1800,
  our_picks: JSON.stringify([{ champion: 'Ahri', role: 'MID' }]), their_picks: JSON.stringify([{ champion: 'Zed', role: 'MID' }]),
  our_bans: JSON.stringify(['Yone']), their_bans: null, created_by: COACH, ...over,
})
const insertDraft = (user, d) => {
  const cols = Object.keys(d)
  return fails(user, `insert into public.draft_log (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')})`, cols.map((c) => d[c]))
}
check('a coach adds a draft', (await insertDraft(COACH, draft())) === null)
check('a player cannot', /row-level security/.test(await insertDraft(PLAYER, draft({ match_id: 'EUW1_124', created_by: PLAYER })) ?? ''))
check('a staff member of another group cannot', /row-level security/.test(await insertDraft(OTHER_COACH, draft({ match_id: 'EUW1_125', created_by: OTHER_COACH })) ?? ''))
check('the author cannot be forged', /row-level security/.test(await insertDraft(COACH, draft({ match_id: 'EUW1_126', created_by: OWNER })) ?? ''))
check('one entry per game and group', /duplicate key/.test(await insertDraft(OWNER, draft({ created_by: OWNER })) ?? ''))
check('a manual draft has no game', (await insertDraft(OWNER, draft({ match_id: null, source: 'manual', created_by: OWNER }))) === null)
for (const [label, over] of [
  ['six picks', { match_id: 'EUW1_200', our_picks: JSON.stringify(Array(6).fill({ champion: 'Ahri', role: 'MID' })) }],
  ['an unknown role', { match_id: 'EUW1_201', our_picks: JSON.stringify([{ champion: 'Ahri', role: 'MIDDLE' }]) }],
  ['a ban that is not a name', { match_id: 'EUW1_202', our_bans: JSON.stringify([42]) }],
  ['a bad patch', { match_id: 'EUW1_203', patch: '16' }],
  ['a bad match id', { match_id: 'nope' }],
  ['an unknown source', { match_id: 'EUW1_204', source: 'ranked' }],
]) {
  check(`the table refuses ${label}`, /check constraint/.test(await insertDraft(COACH, draft(over)) ?? ''))
}
check('members read the log, outsiders and other groups do not',
  (await rowsAs(PLAYER, 'select id from public.draft_log')).length === 2
  && (await rowsAs(OUTSIDER, 'select id from public.draft_log')).length === 0
  && (await rowsAs(OTHER_COACH, 'select id from public.draft_log')).length === 0)
await db.exec('set role anon')
let anonRead = 'none'
try { anonRead = String((await db.query('select count(*) n from public.draft_log')).rows[0].n) } catch (e) { anonRead = e.message }
await db.exec('reset role')
check('anon reads nothing', /permission denied/.test(anonRead), anonRead)

const id = (await one(`select id, updated_at from public.draft_log where match_id = 'EUW1_123'`))
await new Promise((r) => setTimeout(r, 5))
check('the staff edits notes and pick order', (await fails(OWNER, `update public.draft_log set notes = 'B1 Ahri flex', pick_order = $2 where id = $1`,
  [id.id, JSON.stringify(['Ahri', 'Zed', 'Yone', 'Lee Sin', 'Thresh', 'Jinx', 'Gnar', 'Orianna', 'Vi', 'Nautilus'])])) === null)
const after = await one('select notes, updated_at, created_by from public.draft_log where id = $1', [id.id])
check('updated_at moves, the author stays', after.notes === 'B1 Ahri flex' && after.updated_at > id.updated_at && after.created_by === COACH)
check('a player cannot edit', (await rowsAs(PLAYER, `update public.draft_log set notes = 'x' where id = $1 returning id`, [id.id])).length === 0)
for (const col of ['group_id', 'match_id', 'created_by']) {
  check(`nobody changes ${col}`, /permission denied/.test(await fails(OWNER, `update public.draft_log set ${col} = null where id = $1`, [id.id]) ?? ''))
}

// ── Opponent dossiers ────────────────────────────────────────────────────
const insertDossier = (user, over = {}) => {
  const d = { group_id: G, opponent_key: 'aegis gaming', opponent_name: 'Aegis Gaming', how_they_play: 'Scaling comps', suggested_bans: JSON.stringify(['Zed']), game_plan: 'Early tempo', ...over }
  const cols = Object.keys(d)
  return fails(user, `insert into public.opponent_dossiers (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')})`, cols.map((c) => d[c]))
}
check('a player cannot write a dossier', /row-level security/.test(await insertDossier(PLAYER) ?? ''))
check('nobody inserts a dossier already published', /row-level security|check constraint/.test(await insertDossier(COACH, { status: 'published', published_at: '2026-11-19T00:00:00Z' }) ?? ''))
check('the coach writes a draft dossier', (await insertDossier(COACH, { updated_by: OWNER })) === null)
const dossier = await one(`select id, status, updated_by from public.opponent_dossiers where opponent_key = 'aegis gaming'`)
check('updated_by is the caller, whatever the client sent', dossier.updated_by === COACH, dossier.updated_by)
check('one dossier per opponent and group', /duplicate key/.test(await insertDossier(OWNER) ?? ''))
check('6 suggested bans are refused', /check constraint/.test(await insertDossier(COACH, { opponent_key: 'x1', suggested_bans: JSON.stringify(['a', 'b', 'c', 'd', 'e', 'f']) }) ?? ''))
check('a plan over 600 characters is refused', /check constraint/.test(await insertDossier(COACH, { opponent_key: 'x2', game_plan: 'x'.repeat(601) }) ?? ''))
check('players do not see a draft', (await rowsAs(PLAYER, 'select id from public.opponent_dossiers')).length === 0)
check('the status never changes by a direct update', /permission denied/.test(await fails(OWNER, `update public.opponent_dossiers set status = 'published' where id = $1`, [dossier.id]) ?? ''))
check('a player cannot publish', /FORBIDDEN/.test(await fails(PLAYER, `select public.set_opponent_dossier_status($1, 'published')`, [dossier.id]) ?? ''))
check('a staff member of another group cannot publish', /FORBIDDEN/.test(await fails(OTHER_COACH, `select public.set_opponent_dossier_status($1, 'published')`, [dossier.id]) ?? ''))

await db.exec('delete from public.notifications')
await as(COACH, () => db.query(`select public.set_opponent_dossier_status($1, 'published')`, [dossier.id]))
const published = await one('select status, published_at from public.opponent_dossiers where id = $1', [dossier.id])
check('the coach publishes', published.status === 'published' && published.published_at !== null)
const notified = (await db.query(`select user_id, data from public.notifications where type = 'dossier_published'`)).rows
check('every other member is notified, not the coach who published',
  notified.length === 2 && notified.every((n) => n.user_id !== COACH && n.data.opponentName === 'Aegis Gaming'), JSON.stringify(notified))
check('players now read it', (await rowsAs(PLAYER, 'select id from public.opponent_dossiers')).length === 1)
check('publishing twice notifies nobody more', await (async () => {
  await as(OWNER, () => db.query(`select public.set_opponent_dossier_status($1, 'published')`, [dossier.id]))
  return Number((await one(`select count(*) n from public.notifications where type = 'dossier_published'`)).n) === 2
})())
await as(OWNER, () => db.query(`select public.set_opponent_dossier_status($1, 'draft')`, [dossier.id]))
check('back to draft: players no longer see it', (await rowsAs(PLAYER, 'select id from public.opponent_dossiers')).length === 0
  && (await one('select published_at from public.opponent_dossiers where id = $1', [dossier.id])).published_at === null)
check('the staff edits the summary and the snapshot', (await fails(COACH, `update public.opponent_dossiers set how_they_play = 'Dive comps', snapshot = $2, snapshot_at = now() where id = $1`,
  [dossier.id, JSON.stringify({ version: 1, players: [], duos: [], gamesPerPlayer: 20 })])) === null)
check('nobody changes group_id or updated_by', /permission denied/.test(await fails(OWNER, `update public.opponent_dossiers set updated_by = $2 where id = $1`, [dossier.id, PLAYER]) ?? ''))
check('anon cannot call the publish function', await (async () => {
  await db.exec('set role anon')
  try { await db.query(`select public.set_opponent_dossier_status($1, 'published')`, [dossier.id]); return false } catch (e) { return /permission denied/.test(e.message) } finally { await db.exec('reset role') }
})())

// ── team_session_games.timeline_summary ─────────────────────────────────
const S1 = '20000000-0000-0000-0000-000000000001'
await db.exec(`insert into public.team_sessions values ('${S1}', '${G}')`)
// CyberSecurity S19-13: games are inserted by their author, changed or deleted by their author or the session's
// managers, and the summary only goes through set_team_game_timeline_summary.
const summaryJson = JSON.stringify({ version: 1, events: [], goldDiffByMinute: [0, 120] })
const setSummary = (user, gameId, s = summaryJson) => as(user, () => db.query('select public.set_team_game_timeline_summary($1, $2) as ok', [gameId, s]))
const game = (await rowsAs(PLAYER, `insert into public.team_session_games (session_id, match_id) values ($1, 'EUW1_123') returning id, reported_by`, [S1]))[0]
check('a member reports a game, as its author (reported_by filled in by default, as old apps never send it)', game?.reported_by === PLAYER, JSON.stringify(game))
check('a member cannot report a game in someone else\'s name',
  /row-level security/.test(await fails(PLAYER, `insert into public.team_session_games (session_id, match_id, reported_by) values ($1, 'EUW1_124', $2)`, [S1, COACH]) ?? ''))
const coachGame = (await rowsAs(COACH, `insert into public.team_session_games (session_id, match_id) values ($1, 'EUW1_125') returning id`, [S1]))[0]
check('nobody writes timeline_summary directly, not even the staff',
  /permission denied/.test(await fails(COACH, `update public.team_session_games set timeline_summary = '{}' where id = $1`, [coachGame.id]) ?? '')
  && /permission denied/.test(await fails(PLAYER, `update public.team_session_games set timeline_summary = '{}' where id = $1`, [game.id]) ?? ''))
check('the game\'s author caches its summary through the RPC', (await setSummary(PLAYER, game.id)).rows[0].ok === true
  && (await one('select timeline_summary from public.team_session_games where id = $1', [game.id])).timeline_summary?.version === 1)
check('the staff caches the summary of a game they did not report', (await setSummary(COACH, game.id)).rows[0].ok === true)
check('a player who is not the author does not (false, nothing written)', (await setSummary(PLAYER, coachGame.id)).rows[0].ok === false
  && (await one('select timeline_summary from public.team_session_games where id = $1', [coachGame.id])).timeline_summary === null)
check('an outsider does not either', (await setSummary(OUTSIDER, game.id)).rows[0].ok === false)
check('a summary over 64 kB is refused', /check constraint/.test(await fails(COACH, 'select public.set_team_game_timeline_summary($1, $2)', [game.id, JSON.stringify({ blob: 'x'.repeat(70_000) })]) ?? ''))
check('a summary that is not an object is refused', /check constraint/.test(await fails(COACH, 'select public.set_team_game_timeline_summary($1, $2)', [game.id, '[1]']) ?? ''))
check('a player cannot change or delete a game they did not report',
  (await rowsAs(PLAYER, `update public.team_session_games set match_json = '{}' where id = $1 returning id`, [coachGame.id])).length === 0
  && (await rowsAs(PLAYER, `delete from public.team_session_games where id = $1 returning id`, [coachGame.id])).length === 0)
check('the author caches the match on their own game', (await rowsAs(PLAYER, `update public.team_session_games set match_json = '{}', status = 'fetched' where id = $1 returning id`, [game.id])).length === 1)
check('outsiders cannot write it', (await rowsAs(OUTSIDER, `update public.team_session_games set match_json = '{}' where id = $1 returning id`, [game.id])).length === 0)
check('anon may not call the RPC', await (async () => {
  await db.exec('set role anon')
  try { await db.query('select public.set_team_game_timeline_summary(null, null)'); return false } catch (e) { return /permission denied/.test(e.message) } finally { await db.exec('reset role') }
})())

// ── Notification types ───────────────────────────────────────────────────
const def = (await one(`select pg_get_constraintdef(oid) d from pg_constraint where conname = 'notifications_type_check'`)).d
check('the notification list has dossier_published and keeps the #39 types',
  ['dossier_published', 'staff_roles_changed', 'member_staff_roles_changed', 'calendar_event_request'].every((t) => def.includes(`'${t}'`)))
const list280 = readFileSync(join(repo, 'supabase/migrations/20261119211601_member_staff_roles.sql'), 'utf-8')
const typesOf = (sql) => { const m = sql.match(/notifications_type_check check \(type = any \(array\[([\s\S]*?)\]\)\)/); return m ? [...m[1].matchAll(/'([a-z_0-9]+)'/g)].map((x) => x[1]).sort().join(',') : null }
check('#39 (280000) and this migration carry the same full list, so either can go first', typesOf(list280) !== null && typesOf(list280) === typesOf(migration))

// ── Rollback (supabase/rollback/20261119223819_rollback.sql) ─────────────
{
  const rollback = readFileSync(join(repo, 'supabase/rollback/20261119223819_rollback.sql'), 'utf-8')
  await db.exec(rollback)
  await db.exec(rollback)
  check('the rollback applies twice', true)
  const left = (await db.query(`select 'table ' || relname n from pg_class where relname in ('draft_log', 'opponent_dossiers')
    union all select 'function ' || proname from pg_proc where proname in ('set_opponent_dossier_status', 'opponent_dossiers_touch', 'is_pick_list', 'is_champion_list')
      or (proname = 'touch_updated_at' and pronamespace = 'private'::regnamespace)
    union all select 'column ' || column_name from information_schema.columns where table_name = 'team_session_games' and column_name = 'timeline_summary'`)).rows.map((r) => r.n)
  check('rollback: every object the migration added is gone', left.length === 0, JSON.stringify(left))
  check('rollback: the team games themselves stay', Number((await one('select count(*) n from public.team_session_games')).n) === 2)
  check('rollback: any member writes the games again, as in production before (one policy for all)',
    (await rowsAs(PLAYER, `update public.team_session_games set match_json = '{}' where id = $1 returning id`, [coachGame.id])).length === 1)
  check('rollback: the notification list is untouched (280000 holds the same one)', (await one(`select pg_get_constraintdef(oid) d from pg_constraint where conname = 'notifications_type_check'`)).d === def)
  await db.exec(migration)
  check('the migration applies again after the rollback', Number((await one(`select count(*) n from pg_class where relname in ('draft_log', 'opponent_dossiers')`)).n) === 2)
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed')
process.exit(failures ? 1 : 0)
