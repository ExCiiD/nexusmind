#!/usr/bin/env node
/**
 * End-to-end check of supabase/migrations/20261120190000_event_response_reminders.sql ("Relancer", § 18.1) and its
 * rollback, on a throw-away Postgres (PGlite 0.3, PostgreSQL 17) rebuilt from the migrations production has applied
 * (supabase/baseline/prod_migrations_20261120_beta13.txt).
 *
 * Usage: node scripts/test-event-response-reminders.mjs <folder where @electric-sql/pglite is installed>
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { openPglite, replay, migrationFiles, repo, migDir } from './lib/pgliteSupabase.mjs'

const pgliteDir = process.argv[2]
if (!pgliteDir) { console.error('Pass the folder that holds node_modules/@electric-sql/pglite.'); process.exit(2) }

const migration = readFileSync(join(migDir, '20261120190000_event_response_reminders.sql'), 'utf-8')
const rollback = readFileSync(join(repo, 'supabase/rollback/20261120190000_rollback.sql'), 'utf-8')
const inProduction = readFileSync(join(repo, 'supabase/baseline/prod_migrations_20261120_beta13.txt'), 'utf-8')
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
const prod = readFileSync(join(repo, 'supabase/baseline/prod_schema_20261120_beta13.txt'), 'utf-8').split(/\r?\n/).filter(Boolean).join('\n')
check('the starting point is production\'s schema', (await snapshot()) === prod)

const u = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const MANAGER = u(1), P1 = u(2), P2 = u(3), P3 = u(4), COACH = u(5), OUTSIDER = u(6)
const G = '10000000-0000-0000-0000-000000000001'
for (const id of [MANAGER, P1, P2, P3, COACH, OUTSIDER]) await db.query('insert into auth.users (id) values ($1)', [id])
await db.query(`insert into public.groups (id, name, kind, created_by) values ($1, 'G', 'team', $2)`, [G, MANAGER])
await db.query(`insert into public.group_members (group_id, user_id, role, display_name) values
  ($1, $2, 'owner', 'Manager'), ($1, $3, 'player', 'P1'), ($1, $4, 'player', 'P2'), ($1, $5, 'player', 'P3'), ($1, $6, 'coach', 'Coach')`, [G, MANAGER, P1, P2, P3, COACH])
const one = async (sql, params) => (await db.query(sql, params)).rows[0]
const slot = async (scope, hours = 24, kind = 'scrim') => (await one(`insert into public.calendar_events (group_id, kind, title, starts_at, ends_at, created_by, attendee_scope)
  values ($1, $2, 'vs KCA', now() + make_interval(hours => $3), now() + make_interval(hours => $3 + 2), $4, $5) returning id`, [G, kind, hours, MANAGER, scope])).id
async function as(user, fn) {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [user])
  await db.exec('set role authenticated')
  try { return await fn() } finally { await db.exec('reset role') }
}
async function fails(fn) { try { await fn(); return null } catch (e) { return e.message } }

await db.exec(migration)
await db.exec(migration)
check('the migration applies twice', true)

const remind = async (user, event, ids = null) => (await as(user, () => db.query('select public.remind_event_responses($1, $2) r', [event, ids]))).rows[0].r
const ev = await slot('all_players')
await db.query(`insert into public.calendar_event_responses (event_id, user_id, status) values ($1, $2, 'confirmed')`, [ev, P3])
const first = await remind(MANAGER, ev)
check('the manager reminds the players who have not answered (not the one who did, not the staff for a players event)',
  JSON.stringify([...first.reminded].sort()) === JSON.stringify([P1, P2].sort()) && first.skipped.length === 0, JSON.stringify(first))
const notes = (await db.query(`select user_id, data->>'eventTitle' t, link from public.notifications where type = 'event_response_reminder' order by user_id`)).rows
check('each gets an in-app notification with the event, linked to the Planning', notes.length === 2 && notes.every((n) => n.t === 'vs KCA' && n.link === '/planning'), JSON.stringify(notes))
const again = await remind(MANAGER, ev)
check('reminded again within 6 hours: skipped, with the time it is allowed again',
  again.reminded.length === 0 && again.skipped.length === 2 && again.skipped.every((s) => Date.parse(s.nextAt) > Date.now() + 5 * 3_600_000), JSON.stringify(again))
await db.query(`update public.event_response_reminders set sent_at = now() - interval '7 hours' where user_id = $1`, [P1])
const later = await remind(MANAGER, ev)
check('after 6 hours a person can be reminded again', JSON.stringify(later.reminded) === JSON.stringify([P1]) && later.skipped.length === 1, JSON.stringify(later))

const ev2 = await slot('whole_team')
const narrowed = await remind(COACH, ev2, [P2, OUTSIDER])
check('a coach may remind too, narrowed to chosen people (someone outside the group is ignored)', JSON.stringify(narrowed.reminded) === JSON.stringify([P2]), JSON.stringify(narrowed))
const all = await remind(MANAGER, ev2)
check('a whole-team event reminds the staff too, never the caller', !all.reminded.includes(MANAGER) && all.reminded.includes(COACH) && all.skipped.length === 1, JSON.stringify(all))

const ev3 = await slot('custom')
await db.query('insert into public.calendar_event_attendees (event_id, user_id) values ($1, $2)', [ev3, P3])
check('a custom event reminds its invitees only', JSON.stringify((await remind(MANAGER, ev3)).reminded) === JSON.stringify([P3]))

// 50 per call, the never reminded first: a group of 52 waiting players is reached in two calls.
const many = Array.from({ length: 52 }, (_, i) => u(100 + i))
for (const id of many) await db.query('insert into auth.users (id) values ($1)', [id])
for (const id of many) await db.query(`insert into public.group_members (group_id, user_id, role, display_name) values ($1, $2, 'player', 'X')`, [G, id])
const big = await slot('custom')
for (const id of many) await db.query('insert into public.calendar_event_attendees (event_id, user_id) values ($1, $2)', [big, id])
const round1 = await remind(MANAGER, big)
const round2 = await remind(MANAGER, big)
check('at most 50 per call', round1.reminded.length === 50, String(round1.reminded.length))
check('the next call reaches the 2 left over first (never reminded before the recently reminded)',
  round2.reminded.length === 2 && round2.reminded.every((id) => !round1.reminded.includes(id)) && round2.skipped.length === 48, JSON.stringify({ r: round2.reminded.length, s: round2.skipped.length }))

check('a player cannot remind', /FORBIDDEN/.test(await fails(() => remind(P1, ev2)) ?? ''))
check('someone outside the group cannot', /FORBIDDEN/.test(await fails(() => remind(OUTSIDER, ev2)) ?? ''))
check('not for an event already started', /EVENT_PAST/.test(await fails(async () => remind(MANAGER, await slot('whole_team', -1))) ?? ''))
check('not for an unknown event', /NOT_FOUND/.test(await fails(() => remind(MANAGER, u(99))) ?? ''))
const read = async (user) => (await as(user, () => db.query('select count(*)::int n from public.event_response_reminders'))).rows[0].n
check('the managers read who was reminded, a player does not', (await read(MANAGER)) > 0 && (await read(P1)) === 0)
check('no direct write to the anti-spam record', /permission denied/.test(await fails(() => as(MANAGER, () => db.query('delete from public.event_response_reminders'))) ?? ''))
await db.exec('set role anon')
const anon = await fails(() => db.query('select public.remind_event_responses($1)', [ev]))
await db.exec('reset role')
check('anon cannot call it', /permission denied/.test(anon ?? ''), anon ?? 'no error')

const changed = await snapshot()
check('the migration changes the schema', changed !== prod)
await db.exec('begin')
await db.exec(rollback)
await db.exec('commit')
check('the rollback gives production\'s schema back, fingerprint for fingerprint', (await snapshot()) === prod)
await db.exec(migration)
check('the migration applies again after the rollback', (await snapshot()) === changed)

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed')
process.exit(failures ? 1 : 0)
