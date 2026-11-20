#!/usr/bin/env node
/**
 * End-to-end check of supabase/migrations/20261120110540_team_sessions_hardening.sql (team_sessions UPDATE granted per
 * column; recording paths kept as file names) and its rollback, on a throw-away Postgres (PGlite 0.3, PostgreSQL 17)
 * rebuilt from the migrations production has applied, plus 20261120110436 (which adds the slot's copy, event_*).
 *
 * Usage: node scripts/test-team-sessions-hardening.mjs <folder where @electric-sql/pglite is installed>
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { openPglite, replay, migrationFiles, repo, migDir } from './lib/pgliteSupabase.mjs'

const pgliteDir = process.argv[2]
if (!pgliteDir) { console.error('Pass the folder that holds node_modules/@electric-sql/pglite.'); process.exit(2) }

const migration = readFileSync(join(migDir, '20261120110540_team_sessions_hardening.sql'), 'utf-8')
const rollback = readFileSync(join(repo, 'supabase/rollback/20261120110540_rollback.sql'), 'utf-8')
const inProduction = readFileSync(join(repo, 'supabase/baseline/prod_migrations_20261120_beta11.txt'), 'utf-8')
  .split(/\r?\n/).filter(Boolean).map((l) => l.split('|').slice(0, 2).join('_') + '.sql')

let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  ${detail}`}`)
  if (!ok) failures++
}

const db = await openPglite(pgliteDir)
await replay(db, [...migrationFiles().filter((f) => inProduction.includes(f)), '20261120110436_team_session_auto_lifecycle.sql'])
const snapshotSql = readFileSync(join(repo, 'scripts/schema-snapshot.sql'), 'utf-8')
const snapshot = async () => String((await db.query(snapshotSql)).rows[0].snapshot ?? '')
const before = await snapshot()

const u = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const OWNER = u(1), OUTSIDER = u(2)
const G = '10000000-0000-0000-0000-000000000001', G2 = '10000000-0000-0000-0000-000000000002'
await db.query('insert into auth.users (id) values ($1), ($2)', [OWNER, OUTSIDER])
await db.query(`insert into public.groups (id, name, kind, created_by) values ($1, 'G', 'team', $2), ($3, 'G2', 'team', $2)`, [G, OWNER, G2])
await db.query(`insert into public.group_members (group_id, user_id, role, display_name) values ($1, $2, 'owner', 'Owner'), ($3, $2, 'owner', 'Owner')`, [G, OWNER, G2])
const one = async (sql, params) => (await db.query(sql, params)).rows[0]
const ev = (await one(`insert into public.calendar_events (group_id, kind, title, starts_at, ends_at, created_by)
  values ($1, 'scrim', 'vs Aegis', now() + interval '1 day', now() + interval '1 day 2 hours', $2) returning id`, [G, OWNER])).id
const session = (await one('select id from public.team_sessions where calendar_event_id = $1', [ev])).id
const review = (await one(`insert into public.team_session_reviews (session_id, scope, status, recording_local_path)
  values ($1, 'session', 'processing', 'C:\\Users\\Kaito\\AppData\\Roaming\\Ascend\\recordings\\lol_123.mp4') returning id`, [session])).id
await db.query(`insert into public.team_session_reviews (session_id, scope, status, recording_local_path) values ($1, 'meeting', 'done', '/home/kaito/rec/meet.webm')`, [session])
async function as(user, fn) {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [user])
  await db.exec('set role authenticated')
  try { return await fn() } finally { await db.exec('reset role') }
}
async function fails(fn) { try { await fn(); return null } catch (e) { return e.message } }

await db.exec(migration)
await db.exec(migration)
check('the migration applies twice', true)

// (b)
const start = await fails(() => as(OWNER, () => db.query(`update public.team_sessions set status = 'live', responsible_user_ids = $2, queue_filter = 'scrim', started_at = now() where id = $1`, [session, `{${OWNER}}`])))
check('a manager still starts the session (status, responsibles, queue, start time)', start === null, start ?? '')
const end = await fails(() => as(OWNER, () => db.query(`update public.team_sessions set status = 'ended', ended_at = now() where id = $1`, [session])))
check('… and ends it', end === null, end ?? '')
for (const [col, value] of [['group_id', G2], ['calendar_event_id', null], ['event_title', 'x'], ['event_starts_at', new Date().toISOString()]]) {
  const err = await fails(() => as(OWNER, () => db.query(`update public.team_sessions set ${col} = $2 where id = $1`, [session, value])))
  check(`… but cannot write ${col}`, /permission denied/.test(err ?? ''), err ?? 'no error')
}
await db.query(`update public.calendar_events set title = 'vs Aegis (moved)' where id = $1`, [ev])
check('the slot\'s triggers still write the copy', (await one('select event_title from public.team_sessions where id = $1', [session])).event_title === 'vs Aegis (moved)')

// (c)
const paths = (await db.query('select recording_local_path p from public.team_session_reviews order by scope desc')).rows.map((r) => r.p)
check('existing paths are cleaned to the file name (Windows and Unix)', JSON.stringify(paths) === JSON.stringify(['lol_123.mp4', 'meet.webm']), JSON.stringify(paths))
await db.query(`update public.team_session_reviews set recording_local_path = 'D:\\Records\\Bob\\lol_456.mp4' where id = $1`, [review])
check('a full path written by any app version keeps only the file name', (await one('select recording_local_path p from public.team_session_reviews where id = $1', [review])).p === 'lol_456.mp4')
await db.query(`update public.team_session_reviews set recording_local_path = 'C:\\Rec\\' where id = $1`, [review])
check('a path without a file name becomes null', (await one('select recording_local_path p from public.team_session_reviews where id = $1', [review])).p === null)

// (e) availability
const rule = (user, group, owner = user) => as(user, () => db.query(`insert into public.availability_rules (group_id, user_id, weekday, start_time, end_time) values ($1, $2, 2, '18:00', '22:00')`, [group, owner]))
const exception = (user, group) => as(user, () => db.query(`insert into public.availability_exceptions (group_id, user_id, date, available) values ($1, $2, '2026-11-25', false)`, [group, user]))
check('a member writes their own availability', (await fails(() => rule(OWNER, G))) === null && (await fails(() => exception(OWNER, G))) === null)
check('someone outside the group cannot write their availability into it', /row-level security/.test(await fails(() => rule(OUTSIDER, G)) ?? '') && /row-level security/.test(await fails(() => exception(OUTSIDER, G)) ?? ''))
check('nor can a calendar editor write it for someone outside the group', /row-level security/.test(await fails(() => rule(OWNER, G, OUTSIDER)) ?? ''))

const changed = await snapshot()
check('the migration changes the schema', changed !== before)
await db.exec('begin')
await db.exec(rollback)
await db.exec('commit')
// (d) The rollback gives the table-level UPDATE back to authenticated only: every fingerprint as before except
// team_sessions' grants, where anon no longer has UPDATE.
const without = (s) => s.split('\n').map((l) => (l.startsWith('table|public.team_sessions|') ? l.replace(/ g\w+/, '') : l)).join('\n')
const after = await snapshot()
check('the rollback gives the schema back, fingerprint for fingerprint (team_sessions grants aside)', without(after) === without(before))
const priv = async (role, p) => (await one(`select has_table_privilege('${role}', 'public.team_sessions', '${p}') ok`)).ok
check('… authenticated gets UPDATE back on the table, anon does not', (await priv('authenticated', 'UPDATE')) === true && (await priv('anon', 'UPDATE')) === false)
await db.exec(migration)
check('the migration applies again after the rollback', (await snapshot()) === changed)

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed')
process.exit(failures ? 1 : 0)
