#!/usr/bin/env node
/**
 * Check of supabase/migrations/20261120140000_realtime_publication.sql (Realtime instead of polling) and its
 * rollback, on a throw-away Postgres (PGlite 0.3, PostgreSQL 17) rebuilt from the migrations production has applied
 * (supabase/baseline/prod_migrations_20261120_beta14.txt).
 *
 * Realtime itself does not run here. What Realtime relies on is checked instead: the published tables, and that
 * each one has RLS with SELECT policies that show a user their own rows and their groups' rows only (Realtime runs
 * those policies as the subscriber for every INSERT and UPDATE it pushes).
 *
 * Usage: node scripts/test-realtime-publication.mjs <folder where @electric-sql/pglite is installed>
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { openPglite, replay, migrationFiles, repo, migDir } from './lib/pgliteSupabase.mjs'

const pgliteDir = process.argv[2]
if (!pgliteDir) { console.error('Pass the folder that holds node_modules/@electric-sql/pglite.'); process.exit(2) }

const migration = readFileSync(join(migDir, '20261120140000_realtime_publication.sql'), 'utf-8')
const rollback = readFileSync(join(repo, 'supabase/rollback/20261120140000_rollback.sql'), 'utf-8')
const inProduction = readFileSync(join(repo, 'supabase/baseline/prod_migrations_20261120_beta14.txt'), 'utf-8')
  .split(/\r?\n/).filter(Boolean).map((l) => l.split('|').slice(0, 2).join('_') + '.sql')

let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  ${detail}`}`)
  if (!ok) failures++
}

const db = await openPglite(pgliteDir)
await replay(db, migrationFiles().filter((f) => inProduction.includes(f)))
const snapshotSql = readFileSync(join(repo, 'scripts/schema-snapshot.sql'), 'utf-8')
const snapshot = async () => String((await db.query(snapshotSql)).rows[0].snapshot ?? '')
const prod = readFileSync(join(repo, 'supabase/baseline/prod_schema_20261120_beta14.txt'), 'utf-8').split(/\r?\n/).filter(Boolean).join('\n')
check('the starting point is production\'s schema', (await snapshot()) === prod)

const TABLES = ['announcements', 'calendar_event_responses', 'calendar_events', 'notifications', 'team_session_reviews', 'team_sessions']
const published = async () => (await db.query(`select tablename from pg_publication_tables where pubname = 'supabase_realtime' order by 1`)).rows.map((r) => r.tablename)

// Production already has an empty supabase_realtime publication: the same here.
await db.exec(`do $$ begin if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then create publication supabase_realtime; end if; end $$`)
await db.exec(migration)
await db.exec(migration)
check('the migration applies twice', true)
check('the six polled tables are published', JSON.stringify(await published()) === JSON.stringify(TABLES), JSON.stringify(await published()))
check('sync_records is not', !(await published()).includes('sync_records'))
const rls = (await db.query(`select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relname = any($1)`, [TABLES])).rows
check('every published table has RLS on', rls.length === TABLES.length && rls.every((r) => r.relrowsecurity), JSON.stringify(rls))
check('the migration leaves the schema fingerprint unchanged (publications are not in it)', (await snapshot()) === prod)

// What a subscriber may receive: what its SELECT policies show it.
const u = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const A = u(1), B = u(2), C = u(3)
const G1 = '10000000-0000-0000-0000-000000000001', G2 = '10000000-0000-0000-0000-000000000002'
for (const id of [A, B, C]) await db.query('insert into auth.users (id) values ($1)', [id])
await db.query(`insert into public.groups (id, name, kind, created_by) values ($1, 'G1', 'team', $3), ($2, 'G2', 'team', $4)`, [G1, G2, A, C])
await db.query(`insert into public.group_members (group_id, user_id, role, display_name) values ($1, $2, 'owner', 'A'), ($1, $3, 'player', 'B'), ($4, $5, 'owner', 'C')`, [G1, A, B, G2, C])
const one = async (sql, params) => (await db.query(sql, params)).rows[0]
const ev1 = (await one(`insert into public.calendar_events (group_id, kind, title, starts_at, ends_at, created_by) values ($1, 'scrim', 'G1 scrim', now() + interval '1 day', now() + interval '1 day 2 hours', $2) returning id`, [G1, A])).id
const ev2 = (await one(`insert into public.calendar_events (group_id, kind, title, starts_at, ends_at, created_by) values ($1, 'scrim', 'G2 scrim', now() + interval '1 day', now() + interval '1 day 2 hours', $2) returning id`, [G2, C])).id
await db.query(`insert into public.calendar_event_responses (event_id, user_id, status) values ($1, $2, 'confirmed'), ($3, $4, 'confirmed')`, [ev1, B, ev2, C])
// A scrim slot creates its team session (auto lifecycle): reuse it, or create it when the trigger did not.
const sessionOf = async (gid, ev) => (await one('select id from public.team_sessions where calendar_event_id = $1', [ev]))?.id
  ?? (await one('insert into public.team_sessions (group_id, calendar_event_id) values ($1, $2) returning id', [gid, ev])).id
const ts1 = await sessionOf(G1, ev1)
const ts2 = await sessionOf(G2, ev2)
await db.query(`insert into public.team_session_reviews (session_id, scope) values ($1, 'session'), ($2, 'session')`, [ts1, ts2])
await db.query(`insert into public.announcements (group_id, title, body, created_by) values ($1, 'G1 news', 'x', $2), ($3, 'G2 news', 'y', $4)`, [G1, A, G2, C])
await db.query(`insert into public.notifications (user_id, type, data, link) values ($1, 'event_response_reminder', '{}', '/planning'), ($2, 'event_response_reminder', '{}', '/planning')`, [B, C])

async function visible(user, table) {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, false)`, [user])
  await db.exec('set role authenticated')
  try { return Number((await db.query(`select count(*)::int n from public.${table}`)).rows[0].n) } finally { await db.exec('reset role') }
}
for (const t of ['calendar_events', 'calendar_event_responses', 'team_sessions', 'team_session_reviews', 'announcements']) {
  check(`${t}: a member sees their group's row only, not another group's`, (await visible(B, t)) === 1 && (await visible(C, t)) === 1)
}
check('notifications: each user sees their own only', (await visible(B, 'notifications')) === 1 && (await visible(A, 'notifications')) === 0)
await db.exec('set role anon')
const anon = Number((await db.query('select count(*)::int n from public.notifications')).rows[0].n)
await db.exec('reset role')
check('anon sees nothing', anon === 0)

await db.exec('begin')
await db.exec(rollback)
await db.exec('commit')
check('the rollback unpublishes the six tables', (await published()).length === 0, JSON.stringify(await published()))
await db.exec(rollback)
check('the rollback applies twice', true)
await db.exec(migration)
check('the migration applies again after the rollback', (await published()).length === TABLES.length)

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed')
process.exit(failures ? 1 : 0)
