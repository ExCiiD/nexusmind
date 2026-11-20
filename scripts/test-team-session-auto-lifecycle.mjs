#!/usr/bin/env node
/**
 * End-to-end check of supabase/migrations/20261120160000_team_session_auto_lifecycle.sql (team sessions that open on
 * their own, follow their slot, and go away with an empty slot) and its rollback, on a throw-away Postgres (PGlite
 * 0.3, PostgreSQL 17) rebuilt from the migrations production has applied (prod_migrations_20261120_beta11.txt).
 *
 * Usage: node scripts/test-team-session-auto-lifecycle.mjs <folder where @electric-sql/pglite is installed>
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { openPglite, replay, migrationFiles, repo, migDir } from './lib/pgliteSupabase.mjs'

const pgliteDir = process.argv[2]
if (!pgliteDir) { console.error('Pass the folder that holds node_modules/@electric-sql/pglite.'); process.exit(2) }

const migration = readFileSync(join(migDir, '20261120160000_team_session_auto_lifecycle.sql'), 'utf-8')
const rollback = readFileSync(join(repo, 'supabase/rollback/20261120160000_rollback.sql'), 'utf-8')
const inProduction = readFileSync(join(repo, 'supabase/baseline/prod_migrations_20261120_beta11.txt'), 'utf-8')
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
const prod = readFileSync(join(repo, 'supabase/baseline/prod_schema_20261120_beta11.txt'), 'utf-8').split(/\r?\n/).filter(Boolean).join('\n')
check('the starting point is production\'s schema', (await snapshot()) === prod)

const u = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const OWNER = u(1), COACH = u(2), FORMER = u(3), OWNER2 = u(4)
const G = '10000000-0000-0000-0000-000000000001'
for (const id of [OWNER, COACH, FORMER, OWNER2]) await db.query('insert into auth.users (id) values ($1)', [id])
await db.query(`insert into public.groups (id, name, kind, created_by) values ($1, 'G', 'team', $2)`, [G, OWNER])
await db.query(`insert into public.group_members (group_id, user_id, role, display_name, joined_at) values
  ($1, $2, 'owner', 'Owner', now() - interval '2 days'), ($1, $3, 'coach', 'Coach', now() - interval '1 day'), ($1, $4, 'owner', 'Owner2', now())`, [G, OWNER, COACH, OWNER2])

await db.exec(migration)
await db.exec(migration)
check('the migration applies twice', true)

const one = async (sql, params) => (await db.query(sql, params)).rows[0]
/** A slot of `kind` from `startMin` to `endMin` minutes from now, created by `by`. */
const slot = async (kind, startMin, endMin, by = COACH, title = 'Slot') => (await one(`insert into public.calendar_events (group_id, kind, title, starts_at, ends_at, created_by)
  values ($1, $2, $3, now() + make_interval(mins => $4), now() + make_interval(mins => $5), $6) returning id`, [G, kind, title, startMin, endMin, by])).id
const sessionOf = (ev) => one('select * from public.team_sessions where calendar_event_id = $1', [ev])
const sessionById = (id) => one('select * from public.team_sessions where id = $1', [id])
const tick = () => db.query('select public.run_team_session_lifecycle()')
const addGame = async (session, id) => db.query(`insert into public.team_session_games (session_id, match_id, reported_by) values ($1, $2, $3)`, [session, id, OWNER])

// Creation and the slot's copy.
const later = await slot('scrim', 60, 180, COACH, 'vs Aegis')
const s1 = await sessionOf(later)
check('a scrim slot gets an empty scheduled session, with a copy of the slot',
  s1?.status === 'scheduled' && s1.event_id === later && s1.event_kind === 'scrim' && s1.event_title === 'vs Aegis' && s1.event_starts_at !== null, JSON.stringify(s1))
const rest = await slot('rest', 60, 120)
check('a rest slot gets none', !(await sessionOf(rest)))
await db.query(`update public.calendar_events set kind = 'flex' where id = $1`, [rest])
check('a slot that becomes flex gets one', (await sessionOf(rest))?.event_kind === 'flex')
await db.query(`update public.calendar_events set starts_at = starts_at + interval '30 minutes', title = 'vs Aegis (moved)' where id = $1`, [later])
const moved = await sessionOf(later)
check('the copy follows the slot when it moves', moved.event_title === 'vs Aegis (moved)' && Date.parse(moved.event_starts_at) > Date.parse(s1.event_starts_at))

// Opening by the clock.
const now1 = await slot('scrim', -5, 60, COACH)
const meeting = await slot('meeting', -5, 60, COACH)
const tournament = await slot('tournament', -5, 60, FORMER)
await tick()
const live = await sessionOf(now1)
check('at its start time a scrim session opens by itself, the slot\'s creator responsible, scrim queue',
  live.status === 'live' && JSON.stringify(live.responsible_user_ids) === JSON.stringify([COACH]) && live.queue_filter === 'scrim'
  && Date.parse(live.started_at) < Date.now() - 4 * 60_000, JSON.stringify(live))
const tour = await sessionOf(tournament)
check('a slot created by someone no longer in the group: the owners are responsible, custom games for a tournament',
  tour.status === 'live' && JSON.stringify(tour.responsible_user_ids) === JSON.stringify([OWNER, OWNER2]) && tour.queue_filter === 'scrim', JSON.stringify(tour))
check('a meeting keeps its manual start', (await sessionOf(meeting)).status === 'scheduled')
check('a session in the future stays scheduled', (await sessionOf(later)).status === 'scheduled')

const chosen = await slot('flex', -5, 60, COACH)
await db.query(`update public.team_sessions set responsible_user_ids = $2, queue_filter = 'ranked5' where calendar_event_id = $1`, [chosen, `{${OWNER}}`])
await tick()
const kept = await sessionOf(chosen)
check('responsibles and queue already chosen are kept', JSON.stringify(kept.responsible_user_ids) === JSON.stringify([OWNER]) && kept.queue_filter === 'ranked5', JSON.stringify(kept))

const old = await slot('scrim', -300, -200, COACH)
await tick()
check('a slot that ended more than 1 h ago does not open its session', (await sessionOf(old)).status === 'scheduled')

// A live session follows its slot.
await db.query(`update public.calendar_events set starts_at = now() + interval '2 hours', ends_at = now() + interval '4 hours' where id = $1`, [now1])
check('an empty session opened by the clock goes back to scheduled when its slot moves later', (await sessionOf(now1)).status === 'scheduled' && (await sessionOf(now1)).started_at === null)
const withGame = await slot('scrim', -5, 60, COACH)
await tick()
await addGame((await sessionOf(withGame)).id, 'EUW1_1')
await db.query(`update public.calendar_events set starts_at = now() + interval '2 hours', ends_at = now() + interval '4 hours' where id = $1`, [withGame])
check('a session with a game stays live', (await sessionOf(withGame)).status === 'live')

// Closing by the clock.
const ending = await slot('scrim', -5, 60, COACH)
await tick()
await db.query(`update public.calendar_events set starts_at = now() - interval '3 hours', ends_at = now() - interval '61 minutes' where id = $1`, [ending])
await tick()
const ended = await sessionOf(ending)
check('a live session ends 1 h after its slot', ended.status === 'ended' && ended.ended_at !== null, JSON.stringify(ended))

// Deleting or cancelling a slot.
const emptyId = (await sessionOf(later)).id
await db.query('delete from public.calendar_events where id = $1', [later])
check('deleting a slot deletes its empty session', !(await sessionById(emptyId)))
const startedId = (await sessionOf(withGame)).id
await db.query('delete from public.calendar_events where id = $1', [withGame])
const orphan = await sessionById(startedId)
check('a started session is kept, ended, with the copy of its deleted slot',
  orphan && orphan.calendar_event_id === null && orphan.status === 'ended' && orphan.event_id === withGame && orphan.event_title === 'Slot', JSON.stringify(orphan))
check('its games stay', (await one('select count(*)::int n from public.team_session_games where session_id = $1', [startedId])).n === 1)

const leaving = await slot('scrim', 60, 120)
await db.query(`update public.calendar_events set kind = 'rest' where id = $1`, [leaving])
check('a slot that becomes a rest slot takes its empty session away', !(await sessionOf(leaving)))

const scrimSlot = await slot('scrim', 60, 120)
await db.query(`insert into public.scrims (group_id, calendar_event_id, title, scheduled_at, created_by) values ($1, $2, 'vs X', now() + interval '1 hour', $3)`, [G, scrimSlot, COACH])
await db.query(`update public.scrims set status = 'cancelled' where calendar_event_id = $1`, [scrimSlot])
check('a scrim marked cancelled takes its empty session away', !(await sessionOf(scrimSlot)))

const reviewed = await slot('scrim', 60, 120)
const rs = (await sessionOf(reviewed)).id
await db.query(`insert into public.team_session_reviews (session_id, scope, status) values ($1, 'session', 'pending')`, [rs])
await db.query('delete from public.calendar_events where id = $1', [reviewed])
check('a session with a review is kept too', !!(await sessionById(rs)))

check('the clock job is scheduled every minute', (await one(`select schedule from cron.job where jobname = 'team-session-lifecycle'`))?.schedule === '* * * * *')
const anon = await (async () => { await db.exec('set role authenticated'); try { await tick(); return null } catch (e) { return e.message } finally { await db.exec('reset role') } })()
check('the app cannot run the clock itself', /permission denied/.test(anon ?? ''), anon ?? 'no error')

const changed = await snapshot()
check('the migration changes the schema', changed !== prod)
await db.exec('begin')
await db.exec(rollback)
await db.exec('commit')
check('the rollback gives production\'s schema back, fingerprint for fingerprint', (await snapshot()) === prod)
check('the rollback drops the sessions it cannot hold (slot deleted)', !(await sessionById(startedId)) && !(await sessionById(rs)))
await db.exec(migration)
check('the migration applies again after the rollback', (await snapshot()) === changed)

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed')
process.exit(failures ? 1 : 0)
