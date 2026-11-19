#!/usr/bin/env node
/**
 * End-to-end check of supabase/migrations/20261119211601_member_staff_roles.sql (#39, multiple roles) on a
 * throw-away Postgres (PGlite, in memory), never on the project's database. Stand-in schema with the
 * production grants, RLS on wellbeing_checkins, and the functions as they were before the migration.
 *
 * Usage: node scripts/test-member-staff-roles.mjs <folder where @electric-sql/pglite is installed>
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
const migration = readFileSync(join(repo, 'supabase/migrations/20261119211601_member_staff_roles.sql'), 'utf-8')

const db = new PGlite()
let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  ${detail}`}`)
  if (!ok) failures++
}
const one = async (sql, params) => (await db.query(sql, params)).rows[0]

const u = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const OWNER = u(1), COACH = u(2), PCOACH = u(3), PMANAGER = u(4), PLAYER = u(5), CAPTAIN = u(6), MANAGER_COACH = u(7), ANALYST = u(8)
/** A second owner of the group, who also plays (also_plays). */
const OWNER_P = u(9)
const G = '10000000-0000-0000-0000-000000000001'

/** Runs `fn` as `user` through the authenticated role, as a request would. */
async function as(user, fn) {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [user])
  await db.exec('set role authenticated')
  try { return await fn() } finally { await db.exec('reset role') }
}
async function fails(user, sql, params) {
  try { await as(user, () => db.query(sql, params)); return null } catch (e) { return e.message }
}

// ── Stand-in schema, before the migration ───────────────────────────────────
await db.exec(`
  create schema auth;
  create schema private;
  create role anon;
  create role authenticated;
  create role service_role;
  create function auth.uid() returns uuid language sql stable
    as $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;

  create table public.groups (id uuid primary key, name text, created_by uuid);
  create table public.group_members (
    group_id uuid not null references public.groups (id) on delete cascade, user_id uuid not null,
    role text not null check (role in ('owner', 'coach', 'manager', 'analyst', 'player')),
    is_captain boolean not null default false, joined_at timestamptz not null default now(),
    display_name text, riot_id text, profile_icon int, profile_banner text,
    primary key (group_id, user_id)
  );
  create table public.group_sharing (group_id uuid, user_id uuid, share_reviews boolean, share_stats boolean,
    share_team boolean, share_wellbeing boolean, primary key (group_id, user_id));
  create table public.wellbeing_checkins (id serial primary key, user_id uuid, mood numeric, created_at timestamptz default now());
  create table public.notifications (id serial primary key, user_id uuid, type text, data jsonb, link text, created_at timestamptz default now());
  alter table public.notifications add constraint notifications_type_check check (type in ('player_inactive'));
  create table public.sync_records (user_id uuid, table_name text, updated_at timestamptz, deleted boolean default false, data jsonb);
  alter table public.groups add column weekly_load_threshold_hours numeric not null default 10;
  create table public.dev_plans (id serial primary key, group_id uuid, player_id uuid, title text, period_end date, period_end_notified boolean default false);
  create table public.scrims (id serial primary key, group_id uuid, title text, status text, scheduled_at timestamptz, low_availability_notified boolean default false);
  create table public.team_rosters (group_id uuid, user_id uuid, status text, scouting_id uuid);
  create table public.scrim_availability (scrim_id int, user_id uuid, status text);
  create table public.scrim_availability_reminders (scrim_id int, user_id uuid);
  create table public.calendar_event_requests (id serial primary key, group_id uuid, requested_by uuid, event_name text);
  create table public.calendar_events (id uuid primary key, group_id uuid, title text, starts_at timestamptz, ends_at timestamptz);
  create table public.calendar_event_attendees (event_id uuid, user_id uuid);
  create table public.calendar_event_responses (event_id uuid, user_id uuid, status text, note text, responded_at timestamptz,
    primary key (event_id, user_id));

  create function private.notify(p_user uuid, p_type text, p_data jsonb, p_link text) returns void
    language sql security definer set search_path = ''
    as $f$ insert into public.notifications (user_id, type, data, link) values (p_user, p_type, p_data, p_link) $f$;
  create function private.group_role(p_group uuid, p_user uuid default auth.uid())
    returns text language sql stable security definer set search_path = ''
    as $f$ select role from public.group_members where group_id = p_group and user_id = p_user $f$;
  create function private.can_read_wellbeing(p_owner uuid) returns boolean language sql stable security definer set search_path = ''
    as $f$ select false $f$;

  -- S19-07: functions that exist only in production, with their production signatures.
  create function public.run_review_pending_check() returns void language sql security definer set search_path = '' as $f$ select $f$;
  create function public.set_captain(p_group uuid, p_user uuid, p_value boolean) returns void language sql security definer set search_path = ''
    as $f$ update public.group_members set is_captain = p_value where group_id = p_group and user_id = p_user $f$;
  create function public.set_weekly_load_threshold(p_group uuid, p_hours integer) returns void language sql security definer set search_path = ''
    as $f$ update public.groups set weekly_load_threshold_hours = p_hours where id = p_group $f$;
  create table public.team_sessions_log (id serial primary key, group_id uuid);
  create table public.team_session_triggers (id serial primary key, group_id uuid);
  create function public.auto_create_team_session() returns trigger language plpgsql security definer set search_path = ''
    as $f$ begin insert into public.team_sessions_log (group_id) values (new.group_id); return new; end $f$;
  create trigger auto_team_session after insert on public.team_session_triggers for each row execute function public.auto_create_team_session();

  alter table public.wellbeing_checkins enable row level security;
  create policy "wellbeing_read" on public.wellbeing_checkins for select to authenticated
    using (user_id = (select auth.uid()) or private.can_read_wellbeing(user_id));

  grant usage on schema public, private, auth to authenticated;
  grant select on all tables in schema public to authenticated;
  revoke update on public.group_members from anon, authenticated;
  grant update (display_name, riot_id, profile_icon, profile_banner) on public.group_members to authenticated;
  alter table public.group_members enable row level security;
  create policy "members_read" on public.group_members for select to authenticated using (true);
  create policy "members_update_self_profile" on public.group_members for update to authenticated
    using (user_id = auth.uid()) with check (user_id = auth.uid());
`)
await db.exec(`insert into public.groups values ('${G}', 'G', '${OWNER}')`)
const members = [
  [OWNER, 'owner', false, 1], [COACH, 'coach', false, 5], [PCOACH, 'player', false, 2], [PMANAGER, 'player', false, 3],
  [PLAYER, 'player', false, 4], [CAPTAIN, 'player', true, 6], [MANAGER_COACH, 'manager', false, 7], [ANALYST, 'analyst', false, 8],
  [OWNER_P, 'owner', false, 9],
]
for (const [id, role, cap, day] of members) {
  await db.query(`insert into public.group_members (group_id, user_id, role, is_captain, joined_at, display_name)
    values ($1, $2, $3, $4, now() - make_interval(days => 100 - $5), $6)`, [G, id, role, cap, day, `m${day}`])
}

// ── The migration, twice ───────────────────────────────────────────────────
await db.exec(migration)
await db.exec(migration)
check('the migration applies twice', true)
await db.exec(`
  create trigger notify_request after insert on public.calendar_event_requests
    for each row execute function public.notify_calendar_event_request();
`)

// ── Writing roles ───────────────────────────────────────────────────────────
const setStaff = (actor, target, roles) => as(actor, () => db.query('select public.set_member_staff_roles($1, $2, $3) as r', [G, target, roles]))
check('a member cannot write staff_roles directly',
  /permission denied/.test(await fails(PLAYER, `update public.group_members set staff_roles = '{coach}' where group_id = $1 and user_id = $2`, [G, PLAYER]) ?? ''))
check('not even the owner, outside the RPC',
  /permission denied/.test(await fails(OWNER, `update public.group_members set staff_roles = '{coach}' where group_id = $1 and user_id = $2`, [G, PLAYER]) ?? ''))
check('a coach cannot assign roles', /FORBIDDEN/.test(await fails(COACH, 'select public.set_member_staff_roles($1, $2, $3)', [G, PLAYER, ['coach']]) ?? ''))
check('a player cannot give themself a role', /FORBIDDEN/.test(await fails(PLAYER, 'select public.set_member_staff_roles($1, $2, $3)', [G, PLAYER, ['coach']]) ?? ''))
check('only coach, manager or analyst', /INVALID_ROLE/.test(await fails(OWNER, 'select public.set_member_staff_roles($1, $2, $3)', [G, PLAYER, ['owner']]) ?? ''))
check('null in the list is refused', /INVALID_ROLE/.test(await fails(OWNER, 'select public.set_member_staff_roles($1, $2, $3)', [G, PLAYER, ['coach', null]]) ?? ''))
check('the owner is left out', /OWNER_HAS_ALL_ROLES/.test(await fails(OWNER, 'select public.set_member_staff_roles($1, $2, $3)', [G, OWNER, ['coach']]) ?? ''))
check('an unknown member is refused', /NOT_FOUND/.test(await fails(OWNER, 'select public.set_member_staff_roles($1, $2, $3)', [G, u(99), ['coach']]) ?? ''))

await db.exec('delete from public.notifications')
const r1 = (await setStaff(OWNER, PCOACH, ['coach', 'coach'])).rows[0].r
check('duplicates are merged', JSON.stringify(r1) === '["coach"]', JSON.stringify(r1))
await setStaff(OWNER, PMANAGER, ['manager'])
const r2 = (await setStaff(OWNER, MANAGER_COACH, ['manager', 'coach'])).rows[0].r
check('the main role is not repeated in staff_roles', JSON.stringify(r2) === '["coach"]', JSON.stringify(r2))
await setStaff(OWNER, PLAYER, ['analyst', 'manager'])
const multi = await one('select staff_roles from public.group_members where user_id = $1', [PLAYER])
check('a member can hold several staff roles', JSON.stringify(multi.staff_roles) === '["analyst","manager"]', JSON.stringify(multi.staff_roles))

const notesFor = async (user, type) => (await db.query('select data from public.notifications where user_id = $1 and type = $2', [user, type])).rows
const toMember = await notesFor(PCOACH, 'staff_roles_changed')
check('the member is notified of the assignment', toMember.length === 1 && JSON.stringify(toMember[0].data.added) === '["coach"]', JSON.stringify(toMember))
const toTeam = (await db.query(`select user_id from public.notifications where type = 'member_staff_roles_changed' and data->>'memberId' = $1`, [PCOACH])).rows.map((r) => r.user_id)
check('the rest of the group is notified, not the owner who did it nor the member',
  toTeam.length === members.length - 2 && !toTeam.includes(OWNER) && !toTeam.includes(PCOACH), JSON.stringify(toTeam))

await db.exec('delete from public.notifications')
await setStaff(OWNER, PLAYER, ['analyst'])
check('removing a role notifies the member only',
  (await notesFor(PLAYER, 'staff_roles_changed')).length === 1
  && Number((await one(`select count(*) n from public.notifications where type = 'member_staff_roles_changed'`)).n) === 0)
await db.exec('delete from public.notifications')
await setStaff(OWNER, PLAYER, ['analyst'])
check('the same list again notifies nobody', Number((await one('select count(*) n from public.notifications')).n) === 0)
await setStaff(OWNER, PLAYER, [])
check('an empty list clears the roles', (await one('select staff_roles from public.group_members where user_id = $1', [PLAYER])).staff_roles.length === 0)

for (const [label, sql] of [
  ['an owner with staff roles', `insert into public.group_members (group_id, user_id, role, staff_roles) values ('${G}', '${u(50)}', 'owner', '{coach}')`],
  ['a duplicate staff role', `insert into public.group_members (group_id, user_id, role, staff_roles) values ('${G}', '${u(51)}', 'player', '{coach,coach}')`],
  ['the main role repeated', `insert into public.group_members (group_id, user_id, role, staff_roles) values ('${G}', '${u(52)}', 'coach', '{coach}')`],
  ['an unknown staff role', `insert into public.group_members (group_id, user_id, role, staff_roles) values ('${G}', '${u(53)}', 'player', '{owner}')`],
]) {
  let refused = false
  try { await db.exec(sql) } catch { refused = true }
  check(`the table refuses ${label}`, refused)
}

// ── The owner who also plays ─────────────────────────────────────────────────
const playsOf = async (user) => (await one('select also_plays from public.group_members where group_id = $1 and user_id = $2', [G, user])).also_plays
check('also_plays starts false for everyone', Number((await one('select count(*) n from public.group_members where also_plays')).n) === 0)
check('a member cannot write also_plays directly',
  /permission denied/.test(await fails(OWNER_P, `update public.group_members set also_plays = true where group_id = $1 and user_id = $2`, [G, OWNER_P]) ?? ''))
check('a coach cannot say they also play (only an owner)', /FORBIDDEN/.test(await fails(COACH, 'select public.set_my_also_plays($1, true)', [G]) ?? ''))
check('a player cannot either', /FORBIDDEN/.test(await fails(PLAYER, 'select public.set_my_also_plays($1, true)', [G]) ?? ''))
check('null is refused', /FORBIDDEN/.test(await fails(OWNER_P, 'select public.set_my_also_plays($1, null)', [G]) ?? ''))
check('a member of another group is refused', /FORBIDDEN/.test(await fails(u(98), 'select public.set_my_also_plays($1, true)', [G]) ?? ''))
await db.exec('delete from public.notifications')
const setPlays = (actor, v) => as(actor, () => db.query('select public.set_my_also_plays($1, $2) as r', [G, v]))
check('an owner says they also play', (await setPlays(OWNER_P, true)).rows[0].r === true && (await playsOf(OWNER_P)) === true)
check('only their own row: the other owner is unchanged', (await playsOf(OWNER)) === false)
check('nobody is notified', Number((await one('select count(*) n from public.notifications')).n) === 0)
await setPlays(OWNER, true)
await setPlays(OWNER, false)
check('an owner can stop playing', (await playsOf(OWNER)) === false)
{
  let refused = false
  try { await db.exec(`insert into public.group_members (group_id, user_id, role, also_plays) values ('${G}', '${u(54)}', 'coach', true)`) } catch { refused = true }
  check('the table refuses also_plays on a non-owner', refused)
  refused = false
  try { await db.query(`update public.group_members set role = 'coach' where group_id = $1 and user_id = $2`, [G, OWNER_P]) } catch { refused = true }
  check('an owner who plays cannot be turned into another role while flagged', refused)
}
check('the owner who plays keeps the owner\'s rights',
  (await as(OWNER_P, () => db.query('select private.is_group_staff($1) as v', [G]))).rows[0].v === true)

// ── Rights ──────────────────────────────────────────────────────────────────
const asBool = async (user, sql, params = []) => (await as(user, () => db.query(sql, params))).rows[0].v
check('has_group_role: a player-coach is a coach', await asBool(PCOACH, `select private.has_group_role($1, array['coach']) as v`, [G]))
check('has_group_role: a plain player is not', !(await asBool(PLAYER, `select private.has_group_role($1, array['coach', 'manager', 'analyst']) as v`, [G])))
check('is_group_staff: player-coach yes, player-manager no, plain player no',
  (await asBool(PCOACH, 'select private.is_group_staff($1) as v', [G]))
  && !(await asBool(PMANAGER, 'select private.is_group_staff($1) as v', [G]))
  && !(await asBool(PLAYER, 'select private.is_group_staff($1) as v', [G])))
check('can_edit_calendar: player-manager yes, captain yes, plain player no',
  (await asBool(PMANAGER, 'select private.can_edit_calendar($1) as v', [G]))
  && (await asBool(CAPTAIN, 'select private.can_edit_calendar($1) as v', [G]))
  && !(await asBool(PLAYER, 'select private.can_edit_calendar($1) as v', [G])))
check('can_manage_session: player-coach yes, plain player no',
  (await asBool(PCOACH, 'select private.can_manage_session($1) as v', [G])) && !(await asBool(PLAYER, 'select private.can_manage_session($1) as v', [G])))
check('is_discord_manager: player-manager yes, analyst no, plain player no',
  (await asBool(PMANAGER, 'select private.is_discord_manager($1) as v', [G]))
  && !(await asBool(ANALYST, 'select private.is_discord_manager($1) as v', [G]))
  && !(await asBool(PLAYER, 'select private.is_discord_manager($1) as v', [G])))

await db.query(`insert into public.group_sharing values ($1, $2, true, true, true, true)`, [G, CAPTAIN])
const reads = async (user, table) => asBool(user, 'select private.can_read_player_table($1, $2) as v', [CAPTAIN, table])
check('player data: a player-coach reads a teammate\'s reviews and stats', (await reads(PCOACH, 'Review')) && (await reads(PCOACH, 'StatsSnapshot')))
check('player data: a player-manager reads team data, not reviews', (await reads(PMANAGER, 'Team')) && !(await reads(PMANAGER, 'Review')))
check('player data: a plain player reads nothing', !(await reads(PLAYER, 'Review')) && !(await reads(PLAYER, 'Team')))

await db.query('insert into public.wellbeing_checkins (user_id, mood) values ($1, 3)', [CAPTAIN])
const seesWellbeing = async (user) => Number((await as(user, () => db.query('select count(*) n from public.wellbeing_checkins where user_id = $1', [CAPTAIN]))).rows[0].n) === 1
check('wellbeing: the owner, a coach and a manager-coach read it',
  (await seesWellbeing(OWNER)) && (await seesWellbeing(COACH)) && (await seesWellbeing(MANAGER_COACH)))
check('wellbeing: a player-coach does NOT read it', !(await seesWellbeing(PCOACH)))
check('wellbeing: a plain player does not either', !(await seesWellbeing(PLAYER)))
check('wellbeing: an owner who plays does NOT read it, an owner who does not play does',
  !(await seesWellbeing(OWNER_P)) && (await seesWellbeing(OWNER)))
await setPlays(OWNER_P, false)
check('wellbeing: the same owner reads it again once they stop playing', await seesWellbeing(OWNER_P))
await setPlays(OWNER_P, true)

// ── Fan-outs ────────────────────────────────────────────────────────────────
await db.exec('delete from public.notifications')
for (const day of [3, 2, 1]) {
  await db.query(`insert into public.wellbeing_checkins (user_id, mood, created_at) values ($1, $2, now() - make_interval(days => $3))`, [CAPTAIN, day, day])
}
await db.exec('delete from public.wellbeing_checkins where mood = 3 and created_at > now() - interval \'1 hour\'')
await db.exec('select public.run_wellbeing_alert_check()')
const alerted = (await db.query(`select user_id from public.notifications where type = 'wellbeing_alert'`)).rows.map((r) => r.user_id)
check('wellbeing alert: coach and owner told, player-coach not',
  alerted.includes(COACH) && alerted.includes(OWNER) && !alerted.includes(PCOACH) && !alerted.includes(CAPTAIN), JSON.stringify(alerted))
check('wellbeing alert: the owner who plays is not told', !alerted.includes(OWNER_P), JSON.stringify(alerted))

await db.exec('delete from public.notifications')
await db.query(`insert into public.sync_records values ($1, 'Game', now() - interval '10 days', false)`, [PCOACH])
await db.query(`insert into public.sync_records values ($1, 'Game', now() - interval '10 days', false)`, [PLAYER])
await db.exec('select public.run_inactive_player_check()')
const aboutPcoach = (await db.query(`select user_id from public.notifications where type = 'player_inactive' and data->>'playerId' = $1`, [PCOACH])).rows.map((r) => r.user_id)
const aboutPlayer = (await db.query(`select user_id from public.notifications where type = 'player_inactive' and data->>'playerId' = $1`, [PLAYER])).rows.map((r) => r.user_id)
check('inactivity: a player-coach is not told about themself, and is told about a teammate',
  !aboutPcoach.includes(PCOACH) && aboutPlayer.includes(PCOACH) && aboutPlayer.filter((x) => x === PCOACH).length === 1, JSON.stringify({ aboutPcoach, aboutPlayer }))
await db.exec('delete from public.notifications')
await db.query(`insert into public.sync_records values ($1, 'Game', now() - interval '10 days', false)`, [OWNER_P])
await db.query(`insert into public.sync_records values ($1, 'Game', now() - interval '10 days', false)`, [OWNER])
await db.exec('select public.run_inactive_player_check()')
const aboutOwnerP = (await db.query(`select user_id from public.notifications where type = 'player_inactive' and data->>'playerId' = $1`, [OWNER_P])).rows.map((r) => r.user_id)
const aboutOwner = (await db.query(`select user_id from public.notifications where type = 'player_inactive' and data->>'playerId' = $1`, [OWNER])).rows.map((r) => r.user_id)
check('inactivity: an owner who plays is checked like a player (staff told, not themself), an owner who does not is not',
  aboutOwnerP.includes(COACH) && aboutOwnerP.includes(OWNER) && !aboutOwnerP.includes(OWNER_P) && aboutOwner.length === 0,
  JSON.stringify({ aboutOwnerP, aboutOwner }))

await db.exec('delete from public.notifications')
await db.query(`insert into public.calendar_event_requests (group_id, requested_by, event_name) values ($1, $2, 'Scrim')`, [G, PLAYER])
const requested = (await db.query(`select user_id from public.notifications where type = 'calendar_event_request'`)).rows.map((r) => r.user_id)
check('event request: player-manager notified once, captain too, plain requester not',
  requested.filter((x) => x === PMANAGER).length === 1 && requested.includes(CAPTAIN) && !requested.includes(PLAYER) && !requested.includes(ANALYST),
  JSON.stringify(requested))

const EV = '20000000-0000-0000-0000-000000000001'
await db.query(`insert into public.calendar_events values ($1, $2, 'Scrim', now() + interval '1 day', now() + interval '2 days')`, [EV, G])
await db.exec('delete from public.notifications')
await as(PLAYER, () => db.query(`select public.respond_to_calendar_event($1, 'declined')`, [EV]))
const declined = (await db.query(`select user_id from public.notifications where type = 'event_declined'`)).rows.map((r) => r.user_id)
check('decline: player-manager and player-coach notified', declined.includes(PMANAGER) && declined.includes(PCOACH), JSON.stringify(declined))

// ── The three checks that existed only in production ────────────────────────
const recipients = async (type) => (await db.query('select user_id from public.notifications where type = $1', [type])).rows.map((r) => r.user_id)

await db.exec('delete from public.notifications')
await db.query(`insert into public.dev_plans (group_id, player_id, title, period_end) values ($1, $2, 'Plan', current_date + 1)`, [G, PCOACH])
await db.query(`insert into public.dev_plans (group_id, player_id, title, period_end) values ($1, $2, 'Plan', current_date + 1)`, [G, PLAYER])
await db.exec('select public.run_dev_plan_period_check()')
const plan = (await db.query(`select user_id, data->>'playerId' as about from public.notifications where type = 'dev_plan_period_ending'`)).rows
const aboutTeammate = plan.filter((n) => n.about === PLAYER).map((n) => n.user_id)
check('dev plan: a player-coach is told about a teammate\'s plan, a player-manager is not',
  aboutTeammate.includes(PCOACH) && !aboutTeammate.includes(PMANAGER) && aboutTeammate.includes(COACH), JSON.stringify(aboutTeammate))
check('dev plan: the player-coach gets their own plan once, not again as staff',
  plan.filter((n) => n.user_id === PCOACH && (n.about === PCOACH || n.about === null)).length === 1, JSON.stringify(plan))

await db.exec('delete from public.notifications')
await db.query(`insert into public.team_rosters values ($1, $2, 'starter', null)`, [G, CAPTAIN])
await db.query(`insert into public.scrims (group_id, title, status, scheduled_at) values ($1, 'Scrim', 'planned', now() + interval '1 day')`, [G])
await db.exec('select public.run_scrim_availability_check()')
const lowAvail = await recipients('scrim_low_availability')
check('scrim availability: a player-coach is told, a plain player is not',
  lowAvail.includes(PCOACH) && lowAvail.includes(OWNER) && !lowAvail.includes(PLAYER) && !lowAvail.includes(PMANAGER), JSON.stringify(lowAvail))
check('scrim availability: the starter is still asked for an answer', (await recipients('scrim_availability_missing')).includes(CAPTAIN))

await db.exec('delete from public.notifications')
await db.query(`update public.group_sharing set share_stats = true, share_wellbeing = true where user_id = $1`, [CAPTAIN])
await db.query(`insert into public.sync_records (user_id, table_name, updated_at, data) values ($1, 'Game', now(), jsonb_build_object('duration', 40000, 'gameEndAt', now() - interval '1 day'))`, [CAPTAIN])
await db.exec('select public.run_weekly_load_check()')
const load = await recipients('weekly_load_alert')
check('weekly load (reads moods): owner, coach and manager-coach told, player-coach NOT, the player not',
  load.includes(OWNER) && load.includes(COACH) && load.includes(MANAGER_COACH) && !load.includes(PCOACH) && !load.includes(CAPTAIN), JSON.stringify(load))
check('weekly load: the owner who plays is not told', !load.includes(OWNER_P), JSON.stringify(load))

for (const fn of ['run_dev_plan_period_check', 'run_scrim_availability_check', 'run_weekly_load_check', 'run_inactive_player_check', 'run_wellbeing_alert_check']) {
  check(`${fn} cannot be called through the API roles`, /permission denied/.test(await fails(PLAYER, `select public.${fn}()`) ?? ''))
}

// ── S19-07: who may call the remaining functions ────────────────────────────
const anonFails = async (sql, params) => {
  await db.exec('set role anon')
  try { await db.query(sql, params); return null } catch (e) { return e.message } finally { await db.exec('reset role') }
}
for (const fn of ['run_review_pending_check()']) {
  check(`${fn}: refused to authenticated`, /permission denied for function/.test(await fails(PLAYER, `select public.${fn}`) ?? ''))
}
for (const fn of ['auto_create_team_session', 'notify_calendar_event_request']) {
  const r = await one(`select has_function_privilege('authenticated', p.oid, 'execute') as a, has_function_privilege('anon', p.oid, 'execute') as b
    from pg_proc p where p.proname = $1`, [fn])
  check(`${fn}: no API role may execute it`, r.a === false && r.b === false, JSON.stringify(r))
}
await db.exec('grant insert on public.calendar_event_requests, public.team_session_triggers to authenticated; grant usage on all sequences in schema public to authenticated')
await db.exec('delete from public.notifications')
await as(PLAYER, () => db.query(`insert into public.calendar_event_requests (group_id, requested_by, event_name) values ($1, $2, 'Scrim')`, [G, PLAYER]))
await as(PLAYER, () => db.query('insert into public.team_session_triggers (group_id) values ($1)', [G]))
check('the triggers still fire for a signed-in member after the revoke',
  (await recipients('calendar_event_request')).length > 0 && Number((await one('select count(*) n from public.team_sessions_log')).n) === 1)

check('set_captain: refused to anon', /permission denied for function/.test(await anonFails('select public.set_captain($1, $2, true)', [G, PLAYER]) ?? ''))
check('set_weekly_load_threshold: refused to anon', /permission denied for function/.test(await anonFails('select public.set_weekly_load_threshold($1, 12)', [G]) ?? ''))
check('set_captain and set_weekly_load_threshold: still callable signed in',
  (await fails(OWNER, 'select public.set_captain($1, $2, true)', [G, PLAYER])) === null
  && (await fails(OWNER, 'select public.set_weekly_load_threshold($1, 12)', [G])) === null)

// The app (desktop, web, bot, Edge Functions) never calls the functions now closed to it.
{
  const { readdirSync, statSync } = await import('node:fs')
  const walk = (dir) => readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    if (f === 'node_modules' || f.startsWith('.')) return []
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) ? [p] : []
  })
  const files = ['src', 'web/src', 'electron', 'cloudflare/discord-bot/src', 'supabase/functions'].flatMap((d) => walk(join(repo, d)))
  const closed = ['run_review_pending_check', 'auto_create_team_session', 'notify_calendar_event_request', 'run_dev_plan_period_check',
    'run_scrim_availability_check', 'run_weekly_load_check', 'run_inactive_player_check', 'run_wellbeing_alert_check']
  const callers = files.filter((f) => closed.some((fn) => readFileSync(f, 'utf-8').includes(`rpc('${fn}'`)))
  check('no app code calls a function closed to the API roles', callers.length === 0, callers.join(', '))
  const open = ['set_captain', 'set_weekly_load_threshold'].filter((fn) => files.some((f) => readFileSync(f, 'utf-8').includes(`rpc('${fn}'`)))
  check('the app does call set_captain and set_weekly_load_threshold (kept for authenticated)', open.length === 2, JSON.stringify(open))
}

// ── set_member_role keeps the invariant ─────────────────────────────────────
await as(OWNER, () => db.query(`select public.set_member_role($1, $2, 'coach')`, [G, PCOACH]))
const promoted = await one('select role, staff_roles from public.group_members where user_id = $1', [PCOACH])
check('promoting a player-coach to coach drops coach from staff_roles', promoted.role === 'coach' && promoted.staff_roles.length === 0, JSON.stringify(promoted))
await as(OWNER, () => db.query(`select public.set_member_role($1, $2, 'player')`, [G, PCOACH]))
await setStaff(OWNER, PCOACH, ['coach'])

// ── Owner hand-over ─────────────────────────────────────────────────────────
async function handOverCase(label, rows, expected, expectPlays = undefined) {
  const g = `30000000-0000-0000-0000-${String(Math.floor(Math.random() * 1e12)).padStart(12, '0')}`
  await db.query(`insert into public.groups values ($1, 'H', $2)`, [g, OWNER])
  await db.query(`insert into public.group_members (group_id, user_id, role, joined_at) values ($1, $2, 'owner', now() - interval '1000 days')`, [g, OWNER])
  for (const [id, role, staff, captain, daysAgo] of rows) {
    await db.query(`insert into public.group_members (group_id, user_id, role, staff_roles, is_captain, joined_at)
      values ($1, $2, $3, $4, $5, now() - make_interval(days => $6))`, [g, id, role, staff, captain, daysAgo])
  }
  await db.query('select private.hand_over_groups_of($1)', [OWNER])
  const owner = await one(`select user_id, staff_roles, also_plays from public.group_members where group_id = $1 and role = 'owner' and user_id <> $2`, [g, OWNER])
  check(`hand-over: ${label}`, owner?.user_id === expected && owner.staff_roles.length === 0
    && (expectPlays === undefined || owner.also_plays === expectPlays), JSON.stringify(owner))
  await db.query('delete from public.groups where id = $1', [g])
}
await handOverCase('a coach who does not play beats an older player-coach',
  [[u(20), 'player', ['coach'], false, 500], [u(21), 'coach', [], false, 10]], u(21))
await handOverCase('a player-coach beats a manager, and keeps playing as owner',
  [[u(22), 'manager', [], false, 500], [u(23), 'player', ['coach'], false, 10]], u(23), true)
await handOverCase('a coach who does not play becomes an owner who does not play',
  [[u(30), 'coach', [], false, 10]], u(30), false)
await handOverCase('a player-manager beats an analyst',
  [[u(24), 'analyst', [], false, 500], [u(25), 'player', ['manager'], false, 10]], u(25))
await handOverCase('a player-analyst beats the captain, and loses the extra role on becoming owner',
  [[u(26), 'player', [], true, 500], [u(27), 'player', ['analyst'], false, 10]], u(27))
await handOverCase('without staff: the captain, then the oldest player, who keeps playing',
  [[u(28), 'player', [], false, 500], [u(29), 'player', [], true, 10]], u(29), true)

// ── The rollback script (supabase/rollback/20261119211601_rollback.sql) ─────
{
  const rollback = readFileSync(join(repo, 'supabase/rollback/20261119211601_rollback.sql'), 'utf-8')
  await db.query(`insert into public.notifications (user_id, type, data) values ($1, 'staff_roles_changed', '{}')`, [PLAYER])
  await db.exec(rollback)
  await db.exec(rollback)
  check('the rollback applies twice', true)
  // md5(prosrc) of each replaced function, read on production before the migration (20 November 2026).
  const production = {
    'private.can_edit_calendar': 'b701c30706cbb2876fa3d31f6689b4b7', 'private.can_manage_session': 'b701c30706cbb2876fa3d31f6689b4b7',
    'private.can_read_player_table': 'bc046eac77c7e883c09705498a0a72a3', 'private.can_read_wellbeing': 'af3906ac660de0eb4605d8e796e6d233',
    'private.hand_over_groups_of': '01e0e29e81ec19007b35bc1f9c8f3529', 'private.is_discord_manager': '2f94801f4e777cbc723614972fb408b1',
    'private.is_group_staff': '1729049b9b91aa402f83d40d117d2b4f', 'public.notify_calendar_event_request': '5981ca54298897b2f5d90767998b5ad5',
    'public.respond_to_calendar_event': 'db43c54be243bd284db8c45a0e7d2ceb', 'public.run_dev_plan_period_check': 'c7e6e6128adf9c23f53095ded207258d',
    'public.run_inactive_player_check': '20961200bb86045306de5cbc335a0713', 'public.run_scrim_availability_check': '0c33e2a4e8604e78309e957c0bbf4406',
    'public.run_weekly_load_check': 'e7f18cbde6f7571bd56a84e8e47f3102', 'public.run_wellbeing_alert_check': '10172f68795bb284bff73d5f48133833',
    'public.set_member_role': '1c7f3b2cee3ccfc8d65d0bd0a3dd0407',
  }
  const local = Object.fromEntries((await db.query(`select n.nspname || '.' || p.proname as f, md5(p.prosrc) as h
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname || '.' || p.proname = any($1)`, [Object.keys(production)])).rows.map((r) => [r.f, r.h]))
  const differ = Object.keys(production).filter((f) => local[f] !== production[f])
  check('rollback: the 15 function bodies are byte for byte the production ones', differ.length === 0, differ.join(', '))
  const gone = (await db.query(`select p.proname from pg_proc p where p.proname in ('has_group_role', 'set_member_staff_roles', 'set_my_also_plays', 'text_array_is_distinct')`)).rows
  check('rollback: the 4 new functions are dropped', gone.length === 0, JSON.stringify(gone))
  const cols = (await db.query(`select column_name from information_schema.columns where table_name = 'group_members' and column_name in ('staff_roles', 'also_plays')`)).rows
  check('rollback: staff_roles and also_plays are dropped', cols.length === 0, JSON.stringify(cols))
  const typeCheck = (await one(`select pg_get_constraintdef(oid) d from pg_constraint where conname = 'notifications_type_check'`)).d
  check('rollback: the notification types are the production list', !typeCheck.includes('staff_roles_changed') && typeCheck.includes('event_confirmed'), typeCheck)
  const acl = await one(`select has_function_privilege('anon', 'public.set_captain(uuid,uuid,boolean)', 'execute') a,
    has_function_privilege('anon', 'public.run_weekly_load_check()', 'execute') b,
    has_function_privilege('authenticated', 'public.run_inactive_player_check()', 'execute') c,
    has_function_privilege('service_role', 'public.run_inactive_player_check()', 'execute') d`)
  check('rollback: the production grants are back (anon may execute again, the two run_* stay closed)',
    acl.a === true && acl.b === true && acl.c === false && acl.d === true, JSON.stringify(acl))
  check('rollback: a staff role is gone with its rights (a player is no coach any more)',
    !(await as(PCOACH, () => db.query('select private.is_group_staff($1) as v', [G]))).rows[0].v)
  await db.exec(migration)
  check('the migration applies again after the rollback', Number((await one(`select count(*) n from information_schema.columns where table_name = 'group_members' and column_name in ('staff_roles', 'also_plays')`)).n) === 2)
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed')
process.exit(failures ? 1 : 0)
