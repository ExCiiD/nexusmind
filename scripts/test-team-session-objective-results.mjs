#!/usr/bin/env node
/**
 * End-to-end check of supabase/migrations/20261120150000_team_session_objective_results.sql (team session history,
 * the staff's "objective held" verdicts) and its rollback, on a throw-away Postgres (PGlite 0.3, PostgreSQL 17)
 * rebuilt from the migrations production has applied (supabase/baseline/prod_migrations_20261120_beta11.txt).
 *
 * Usage: node scripts/test-team-session-objective-results.mjs <folder where @electric-sql/pglite is installed>
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { openPglite, replay, migrationFiles, repo, migDir } from './lib/pgliteSupabase.mjs'

const pgliteDir = process.argv[2]
if (!pgliteDir) { console.error('Pass the folder that holds node_modules/@electric-sql/pglite.'); process.exit(2) }

const MIGRATION = '20261120150000_team_session_objective_results.sql'
const migration = readFileSync(join(migDir, MIGRATION), 'utf-8')
const rollback = readFileSync(join(repo, 'supabase/rollback/20261120150000_rollback.sql'), 'utf-8')
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
const OWNER = u(1), CAPTAIN = u(2), PLAYER = u(3), OUTSIDER = u(4)
const G = '10000000-0000-0000-0000-000000000001', G2 = '10000000-0000-0000-0000-000000000002'
async function as(user, fn) {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [user])
  await db.exec('set role authenticated')
  try { return await fn() } finally { await db.exec('reset role') }
}
async function fails(fn) { try { await fn(); return null } catch (e) { return e.message } }
const one = async (sql, params) => (await db.query(sql, params)).rows[0]

for (const id of [OWNER, CAPTAIN, PLAYER, OUTSIDER]) await db.query('insert into auth.users (id) values ($1)', [id])
await db.query(`insert into public.groups (id, name, kind, created_by) values ($1, 'G', 'team', $2), ($3, 'G2', 'team', $4)`, [G, OWNER, G2, OUTSIDER])
await db.query(`insert into public.group_members (group_id, user_id, role, is_captain, display_name) values
  ($1, $2, 'owner', false, 'Owner'), ($1, $3, 'player', true, 'Captain'), ($1, $4, 'player', false, 'Player')`, [G, OWNER, CAPTAIN, PLAYER])
await db.query(`insert into public.group_members (group_id, user_id, role, display_name) values ($1, $2, 'owner', 'Out')`, [G2, OUTSIDER])
const ev = (await one(`insert into public.calendar_events (group_id, kind, title, starts_at, ends_at, created_by)
  values ($1, 'scrim', 'vs Aegis', now() - interval '1 day', now() - interval '1 day' + interval '2 hours', $2) returning id`, [G, OWNER])).id
const session = (await one('select id from public.team_sessions where calendar_event_id = $1', [ev]))?.id
  ?? (await one('insert into public.team_sessions (group_id, calendar_event_id) values ($1, $2) returning id', [G, ev])).id
const g1 = (await one(`insert into public.team_session_games (session_id, match_id, reported_by) values ($1, 'EUW1_1', $2) returning id`, [session, OWNER])).id
const ev2 = (await one(`insert into public.calendar_events (group_id, kind, title, starts_at, ends_at, created_by)
  values ($1, 'scrim', 'other', now(), now() + interval '1 hour', $2) returning id`, [G, OWNER])).id
const other = (await one('select id from public.team_sessions where calendar_event_id = $1', [ev2]))?.id
  ?? (await one('insert into public.team_sessions (group_id, calendar_event_id) values ($1, $2) returning id', [G, ev2])).id
const otherGame = (await one(`insert into public.team_session_games (session_id, match_id, reported_by) values ($1, 'EUW1_2', $2) returning id`, [other, OWNER])).id

await db.exec(migration)
await db.exec(migration)
check('the migration applies twice', true)

const set = (user, game, met, objective = 'vision_control') => as(user, () => db.query('select public.set_team_session_objective_result($1, $2, $3, $4)', [session, objective, game, met]))
const rows = async () => (await db.query('select objective_id, game_id, met, set_by from public.team_session_objective_results order by game_id nulls first')).rows

await set(OWNER, g1, true)
await set(OWNER, null, false)
check('the owner records a verdict for a game and for the whole session', JSON.stringify((await rows()).map((r) => [r.game_id, r.met])) === JSON.stringify([[null, false], [g1, true]]), JSON.stringify(await rows()))
await set(CAPTAIN, g1, false)
const after = await rows()
check('a captain may too, and a second verdict replaces the first (one row per objective and game)',
  after.length === 2 && after.find((r) => r.game_id === g1).met === false && after.find((r) => r.game_id === g1).set_by === CAPTAIN, JSON.stringify(after))
await set(OWNER, null, null)
check('null removes the verdict', (await rows()).length === 1)

check('a player cannot write', /FORBIDDEN/.test(await fails(() => set(PLAYER, g1, true)) ?? ''))
check('someone outside the group cannot write', /FORBIDDEN/.test(await fails(() => set(OUTSIDER, g1, true)) ?? ''))
check('a game of another session is refused', /NOT_FOUND/.test(await fails(() => set(OWNER, otherGame, true)) ?? ''))
check('an empty objective id is refused', /INVALID_OBJECTIVE/.test(await fails(() => set(OWNER, g1, true, '')) ?? ''))
const direct = await fails(() => as(OWNER, () => db.query(`insert into public.team_session_objective_results (session_id, objective_id, met) values ($1, 'x', true)`, [session])))
check('no direct write, even for the staff (the RPC only)', /permission denied/.test(direct ?? ''), direct ?? 'no error')

const seen = await as(PLAYER, () => db.query('select count(*)::int n from public.team_session_objective_results'))
check('a member of the group reads the verdicts', seen.rows[0].n === 1)
const hidden = await as(OUTSIDER, () => db.query('select count(*)::int n from public.team_session_objective_results'))
check('someone outside the group does not', hidden.rows[0].n === 0)
await db.exec('set role anon')
const anon = await fails(() => db.query('select public.set_team_session_objective_result($1, $2, null, true)', [session, 'x']))
await db.exec('reset role')
check('anon cannot call the RPC', /permission denied/.test(anon ?? ''), anon ?? 'no error')

await db.query('delete from public.team_session_games where id = $1', [g1])
check('deleting the game deletes its verdicts', (await rows()).length === 0)

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
