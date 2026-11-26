#!/usr/bin/env node
/**
 * Check, on a throw-away Postgres (PGlite, in memory), never on the project's database, of
 * 20261126090000_team_data_scoped_to_linked_group.sql and its rollback (S19-17 residual, 26/11/2026):
 * a coach of teams A and B must not expose team B's roster, pools, scrims and drafts to A's staff.
 * The stand-in of private.can_read_player_table is the production function, read on 26/11/2026.
 *
 * Usage: node scripts/test-team-data-linked-group.mjs <folder where @electric-sql/pglite@0.3.16 is installed>
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const pgliteDir = process.argv[2]
if (!pgliteDir) { console.error('Pass the folder that holds node_modules/@electric-sql/pglite.'); process.exit(2) }
const repo = join(dirname(fileURLToPath(import.meta.url)), '..')
const migration = readFileSync(join(repo, 'supabase/migrations/20261126090000_team_data_scoped_to_linked_group.sql'), 'utf-8')
const rollback = readFileSync(join(repo, 'supabase/rollback/20261126090000_rollback.sql'), 'utf-8')

const require = createRequire(join(pgliteDir, 'package.json'))
const { PGlite } = await import(pathToFileURL(require.resolve('@electric-sql/pglite')).href)
const db = new PGlite()
let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  ${detail}`}`)
  if (!ok) failures++
}
const U = (n) => `00000000-0000-0000-0000-00000000000${n}`
const [coach, analystA, playerA, playerB, managerB, multi] = [1, 2, 3, 4, 5, 6].map(U)
const [GA, GB] = ['10000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000b']
const [TA, TB, TX] = ['t-a', 't-b', 't-x']

await db.exec(`
  create schema if not exists auth;
  create schema if not exists private;
  do $$ begin create role anon; exception when duplicate_object then null; end $$;
  do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable
    as $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
  create table public.groups (id uuid primary key);
  create table public.group_members (group_id uuid references public.groups (id), user_id uuid references auth.users (id) on delete cascade,
    role text not null, staff_roles text[] not null default '{}', primary key (group_id, user_id));
  create table public.group_sharing (group_id uuid, user_id uuid, share_reviews boolean, share_stats boolean, share_team boolean,
    primary key (group_id, user_id));
  create table public.sync_records (user_id uuid, table_name text, record_id text, data jsonb, deleted boolean not null default false,
    primary key (user_id, table_name, record_id));
  alter table public.sync_records enable row level security;
  grant usage on schema public, private, auth to authenticated;
  grant execute on function auth.uid() to authenticated;
  grant select on public.sync_records to authenticated;
  create or replace function private.can_read_player_table(p_owner uuid, p_table text)
   returns boolean language sql stable security definer set search_path to ''
  as $function$
    select exists (
      select 1
      from public.group_members viewer
      join public.group_members owner_m on owner_m.group_id = viewer.group_id and owner_m.user_id = p_owner
      left join public.group_sharing s on s.group_id = viewer.group_id and s.user_id = p_owner
      where viewer.user_id = auth.uid()
        and viewer.user_id <> p_owner
        and (
          (p_table in ('Session', 'Game', 'Review', 'Mistake', 'MistakeTag', 'Recording', 'Bookmark', 'ExternalReview')
            and (viewer.role = any(array['owner', 'coach', 'analyst']) or viewer.staff_roles && array['coach', 'analyst'])
            and coalesce(s.share_reviews, true))
          or (p_table in ('Assessment', 'AssessmentScore', 'StatsSnapshot', 'Badge', 'Account', 'CoachingExperiment')
            and (viewer.role = any(array['owner', 'coach', 'analyst']) or viewer.staff_roles && array['coach', 'analyst'])
            and coalesce(s.share_stats, true))
          or (p_table in ('Team', 'TeamMember', 'ChampionPoolEntry', 'DraftPrep', 'CustomGame')
            and (viewer.role = any(array['owner', 'coach', 'analyst', 'manager']) or viewer.staff_roles && array['coach', 'analyst', 'manager'])
            and s.share_team is true)
        )
    )
  $function$;
  create policy sync_records_select_own on public.sync_records for select to authenticated using (user_id = auth.uid());
  create policy sync_records_read_shared on public.sync_records for select to authenticated
    using (private.can_read_player_table(user_id, table_name));
`)
await db.query('insert into auth.users values ($1), ($2), ($3), ($4), ($5), ($6)', [coach, analystA, playerA, playerB, managerB, multi])
await db.query('insert into public.groups values ($1), ($2)', [GA, GB])
await db.query(`insert into public.group_members (group_id, user_id, role) values
  ($1, $3, 'coach'), ($2, $3, 'coach'), ($1, $4, 'analyst'), ($1, $5, 'player'), ($2, $6, 'player'), ($2, $7, 'manager'), ($1, $8, 'analyst'), ($2, $8, 'manager')`,
  [GA, GB, coach, analystA, playerA, playerB, managerB, multi])
await db.query(`insert into public.group_sharing (group_id, user_id, share_team) values ($1, $3, true), ($2, $3, true)`, [GA, GB, coach])

const rec = (table, id, data) => db.query(`insert into public.sync_records (user_id, table_name, record_id, data) values ($1, $2, $3, $4)`, [coach, table, id, JSON.stringify(data)])
await rec('Team', TA, { id: TA, groupId: GA })
await rec('Team', TB, { id: TB, groupId: GB })
await rec('Team', TX, { id: TX, groupId: null })
await rec('TeamMember', 'm-a', { id: 'm-a', teamId: TA })
await rec('TeamMember', 'm-b', { id: 'm-b', teamId: TB })
await rec('TeamMember', 'm-x', { id: 'm-x', teamId: TX })
await rec('ChampionPoolEntry', 'p-a', { id: 'p-a', memberId: 'm-a' })
await rec('ChampionPoolEntry', 'p-b', { id: 'p-b', memberId: 'm-b' })
await rec('CustomGame', 'g-a', { id: 'g-a', teamId: TA })
await rec('CustomGame', 'g-b', { id: 'g-b', teamId: TB })
await rec('DraftPrep', 'd-a', { id: 'd-a', vsTeamId: TA })
await rec('DraftPrep', 'd-b', { id: 'd-b', vsTeamId: TB })
await rec('DraftPrep', 'd-none', { id: 'd-none', vsTeamId: null })
await rec('Game', 'game-1', { id: 'game-1' })
const TEAM_ROWS = 13

async function as(user, fn) {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [user])
  await db.exec('set role authenticated')
  try { return await fn() } finally {
    await db.exec('reset role')
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`)
  }
}
const ids = (user, table) => as(user, async () =>
  (await db.query('select record_id from public.sync_records where user_id = $1 and table_name = $2 order by 1', [coach, table])).rows.map((r) => r.record_id).join(','))
const count = (user) => as(user, async () => (await db.query(`select count(*)::int n from public.sync_records where user_id = $1 and table_name <> 'Game'`, [coach])).rows[0].n)

check('before: the analyst of A reads every team row of the coach (the leak)', (await count(analystA)) === TEAM_ROWS)

let err = null
try { await db.exec(migration) } catch (e) { err = e.message }
check('migration applies', err === null, err)

check('Team: the analyst of A reads A only', (await ids(analystA, 'Team')) === TA)
check('TeamMember: A only', (await ids(analystA, 'TeamMember')) === 'm-a')
check('ChampionPoolEntry: A only (two hops)', (await ids(analystA, 'ChampionPoolEntry')) === 'p-a')
check('CustomGame: A only', (await ids(analystA, 'CustomGame')) === 'g-a')
check('DraftPrep: against A only, none for an unlinked draft', (await ids(analystA, 'DraftPrep')) === 'd-a')
check('the manager of B reads B only', (await ids(managerB, 'Team')) === TB && (await ids(managerB, 'ChampionPoolEntry')) === 'p-b')
check('a player of A reads no team row', (await count(playerA)) === 0)
check('the analyst of A still reads the coach\'s reviews (Game)', (await as(analystA, async () => (await db.query(`select count(*)::int n from public.sync_records where user_id = $1 and table_name = 'Game'`, [coach])).rows[0].n)) === 1)
check('the owner reads all their own rows', (await as(coach, async () => (await db.query('select count(*)::int n from public.sync_records')).rows[0].n)) === TEAM_ROWS + 1)

await db.query(`update public.group_sharing set share_team = false where group_id = $1 and user_id = $2`, [GA, coach])
check('share_team off for A: the analyst of A reads nothing', (await count(analystA)) === 0)
await db.query(`update public.group_sharing set share_team = true where group_id = $1 and user_id = $2`, [GA, coach])

// A staff member of SEVERAL groups (analyst of A and manager of B): reads each linked team through its own group.
check('multi-group staff: reads A and B teams, never the unlinked one', (await ids(multi, 'Team')) === [TA, TB].sort().join(','))
check('multi-group staff: TeamMember of both, none unlinked', (await ids(multi, 'TeamMember')) === 'm-a,m-b')
check('multi-group staff: pools of both (two hops)', (await ids(multi, 'ChampionPoolEntry')) === 'p-a,p-b')
check('multi-group staff: scrims and drafts of both, none unlinked', (await ids(multi, 'CustomGame')) === 'g-a,g-b' && (await ids(multi, 'DraftPrep')) === 'd-a,d-b')
await db.query(`update public.group_sharing set share_team = false where group_id = $1 and user_id = $2`, [GB, coach])
check('multi-group staff: sharing off for B only, still reads A and no B row', (await ids(multi, 'Team')) === TA && (await ids(multi, 'TeamMember')) === 'm-a')
await db.query(`update public.group_sharing set share_team = true where group_id = $1 and user_id = $2`, [GB, coach])
await db.query(`update public.group_members set role = 'player' where group_id = $1 and user_id = $2`, [GB, multi])
check('multi-group staff: demoted to player in B, reads A only', (await ids(multi, 'Team')) === TA)
await db.query(`update public.group_members set role = 'manager' where group_id = $1 and user_id = $2`, [GB, multi])

err = null
try { await db.exec(migration) } catch (e) { err = e.message }
check('re-runnable: migration', err === null, err)

err = null
try { await db.exec(rollback); await db.exec(rollback) } catch (e) { err = e.message }
check('rollback applies twice', err === null, err)
check('after rollback: the production rule is back', (await count(analystA)) === TEAM_ROWS)
check('after rollback: the new functions are gone',
  (await db.query(`select count(*)::int n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' and p.proname in ('can_read_synced_row', 'synced_team_group')`)).rows[0].n === 0)

await db.close()
console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
