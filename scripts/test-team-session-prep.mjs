#!/usr/bin/env node
/**
 * End-to-end check of supabase/migrations/20261120110520_team_session_prep.sql (preparing a team session ahead: each
 * player's objectives, the coach's message, drafts attached) and its rollback, on a throw-away Postgres (PGlite 0.3, PostgreSQL 17) rebuilt
 * from the migrations production has applied (prod_migrations_20261120_beta11.txt). Also checks that the collective
 * objectives (team_session_objectives) can be set while the session is scheduled.
 *
 * Usage: node scripts/test-team-session-prep.mjs <folder where @electric-sql/pglite is installed>
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { openPglite, replay, migrationFiles, repo, migDir } from './lib/pgliteSupabase.mjs'

const pgliteDir = process.argv[2]
if (!pgliteDir) { console.error('Pass the folder that holds node_modules/@electric-sql/pglite.'); process.exit(2) }

const migration = readFileSync(join(migDir, '20261120110520_team_session_prep.sql'), 'utf-8')
const rollback = readFileSync(join(repo, 'supabase/rollback/20261120110520_rollback.sql'), 'utf-8')
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
const COACH = u(1), ANALYST = u(2), CAPTAIN = u(3), PLAYER = u(4), MATE = u(5), OUTSIDER = u(6)
const G = '10000000-0000-0000-0000-000000000001', G2 = '10000000-0000-0000-0000-000000000002'
for (const id of [COACH, ANALYST, CAPTAIN, PLAYER, MATE, OUTSIDER]) await db.query('insert into auth.users (id) values ($1)', [id])
await db.query(`insert into public.groups (id, name, kind, created_by) values ($1, 'G', 'team', $2), ($3, 'G2', 'team', $4)`, [G, COACH, G2, OUTSIDER])
await db.query(`insert into public.group_members (group_id, user_id, role, is_captain, display_name) values
  ($1, $2, 'owner', false, 'Coach'), ($1, $3, 'analyst', false, 'Analyst'), ($1, $4, 'player', true, 'Captain'),
  ($1, $5, 'player', false, 'Player'), ($1, $6, 'player', false, 'Mate')`, [G, COACH, ANALYST, CAPTAIN, PLAYER, MATE])
await db.query(`insert into public.group_members (group_id, user_id, role, display_name) values ($1, $2, 'owner', 'Out')`, [G2, OUTSIDER])
const one = async (sql, params) => (await db.query(sql, params)).rows[0]
const slot = async () => (await one(`insert into public.calendar_events (group_id, kind, title, starts_at, ends_at, created_by)
  values ($1, 'scrim', 'vs Aegis', now() + interval '1 day', now() + interval '1 day 2 hours', $2) returning id`, [G, COACH])).id
const ev = await slot()
const session = (await one('select id from public.team_sessions where calendar_event_id = $1', [ev])).id
async function as(user, fn) {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [user])
  await db.exec('set role authenticated')
  try { return await fn() } finally { await db.exec('reset role') }
}
async function fails(fn) { try { await fn(); return null } catch (e) { return e.message } }

// Collective objectives, before the migration and after: the coach sets them while the session is scheduled.
const collective = await fails(() => as(COACH, () => db.query(`insert into public.team_session_objectives (session_id, objective_ids, kpi_ids, set_by)
  values ($1, '{vision_control}', '{}', $2) on conflict (session_id) do update set objective_ids = excluded.objective_ids`, [session, COACH])))
check('the collective objectives can be set while the session is scheduled', collective === null && (await one('select status from public.team_sessions where id = $1', [session])).status === 'scheduled', collective ?? '')

const analystCollective = () => as(ANALYST, () => db.query(`insert into public.team_session_objectives (session_id, objective_ids, kpi_ids, set_by)
  values ($1, '{tempo}', '{}', $2) on conflict (session_id) do update set objective_ids = excluded.objective_ids`, [session, ANALYST]))
check('before: the analyst cannot set the collective objectives', /row-level security/.test(await fails(analystCollective) ?? ''))

await db.exec(migration)
await db.exec(migration)
check('the migration applies twice', true)
check('after: the analyst sets the collective objectives too', (await fails(analystCollective)) === null
  && (await one('select objective_ids from public.team_session_objectives where session_id = $1', [session])).objective_ids[0] === 'tempo')
check('a player still cannot', /row-level security/.test(await fails(() => as(PLAYER, () => db.query(`update public.team_session_objectives set objective_ids = '{x}' where session_id = $1 returning 1`, [session]).then((r) => { if (!r.rows.length) throw new Error('row-level security: nothing updated') }))) ?? ''))

const setObj = (user, player, ids, note = null) => as(user, () => db.query(`insert into public.team_session_player_objectives (session_id, player_id, objective_ids, note)
  values ($1, $2, $3, $4) on conflict (session_id, player_id) do update set objective_ids = excluded.objective_ids, note = excluded.note, set_at = now()`, [session, player, ids, note]))
await setObj(COACH, PLAYER, ['lane_plan_clarity', 'ward_timing'], 'Ward le pixel à 2:50')
await setObj(ANALYST, MATE, ['wincon_per_comp'])
await setObj(CAPTAIN, CAPTAIN, ['shotcalling'])
check('the coach, the analyst and the captain set players\' objectives ahead', (await one('select count(*)::int n from public.team_session_player_objectives')).n === 3)
check('a player cannot set objectives', /row-level security/.test(await fails(() => setObj(PLAYER, PLAYER, ['x'])) ?? ''))
check('someone outside the group cannot', /row-level security/.test(await fails(() => setObj(OUTSIDER, PLAYER, ['x'])) ?? ''))
check('not for someone outside the group', /row-level security/.test(await fails(() => setObj(COACH, OUTSIDER, ['x'])) ?? ''))
check('at most 2 objectives', /check constraint/.test(await fails(() => setObj(COACH, PLAYER, ['a', 'b', 'c'])) ?? ''))
check('a note of 140 characters at most', /check constraint/.test(await fails(() => setObj(COACH, PLAYER, ['a'], 'x'.repeat(141))) ?? ''))
check('each once', /check constraint/.test(await fails(() => setObj(COACH, PLAYER, ['a', 'a'])) ?? ''))
check('not empty (an objective or a note)', /check constraint/.test(await fails(() => setObj(COACH, PLAYER, [])) ?? ''))

const seenBy = async (user) => (await as(user, () => db.query('select player_id from public.team_session_player_objectives order by player_id'))).rows.map((r) => r.player_id)
check('the group reads every player\'s objectives (their own first, the others folded, § 17)', (await seenBy(PLAYER)).length === 3 && (await seenBy(ANALYST)).length === 3)

// The coach's message.
const message = (user, text) => as(user, () => db.query(`insert into public.team_session_prep_notes (session_id, message) values ($1, $2)
  on conflict (session_id) do update set message = excluded.message, set_at = now()`, [session, text]))
await message(COACH, 'Focus tempo Herald, on joue autour du bot')
await message(ANALYST, 'Focus tempo Herald')
check('the coach and the analyst write the message to the players, one per session', (await one('select message from public.team_session_prep_notes where session_id = $1', [session])).message === 'Focus tempo Herald')
check('a player cannot', /row-level security/.test(await fails(() => message(PLAYER, 'x')) ?? ''))
check('280 characters at most, not empty', /check constraint/.test(await fails(() => message(COACH, 'x'.repeat(281))) ?? '') && /check constraint/.test(await fails(() => message(COACH, '  ')) ?? ''))
check('a player of the group reads it', (await as(MATE, () => db.query('select count(*)::int n from public.team_session_prep_notes'))).rows[0].n === 1)
check('someone outside the group does not', (await as(OUTSIDER, () => db.query('select count(*)::int n from public.team_session_prep_notes'))).rows[0].n === 0)
check('someone outside the group reads none', (await seenBy(OUTSIDER)).length === 0)

const draft = (user, sourceId, name = 'Comp poke', picks = ['Jayce', 'Nidalee']) => as(user, () => db.query(`insert into public.team_session_drafts (session_id, source_id, name, blue_picks, position)
  values ($1, $2, $3, $4::jsonb, 0) on conflict on constraint team_session_drafts_one_copy do update set name = excluded.name, blue_picks = excluded.blue_picks returning id`, [session, sourceId, name, JSON.stringify(picks)]))
const d1 = (await draft(COACH, 'prep-1')).rows[0].id
const d1again = (await draft(ANALYST, 'prep-1', 'Comp poke v2')).rows[0].id
check('a draft attached again by its source replaces its copy', d1 === d1again && (await one('select name from public.team_session_drafts where id = $1', [d1])).name === 'Comp poke v2')
await draft(COACH, null, 'Sans source')
await draft(COACH, null, 'Sans source 2')
check('drafts without a source are separate copies', (await one('select count(*)::int n from public.team_session_drafts')).n === 3)
check('a player cannot attach a draft', /row-level security/.test(await fails(() => draft(PLAYER, 'p')) ?? ''))
check('at most 5 picks', /check constraint/.test(await fails(() => draft(COACH, 'big', 'Big', ['a', 'b', 'c', 'd', 'e', 'f'])) ?? ''))
// CyberSecurity (c): every champion of a slot is 1 to 40 characters, a slot of options holds at most 10, nothing else.
check('a slot of options is fine', (await fails(() => draft(COACH, 'opts', 'Opts', [['Ahri', 'Syndra'], 'Jayce']))) === null)
check('a champion key of 41 characters is refused', /check constraint/.test(await fails(() => draft(COACH, 'long', 'Long', ['x'.repeat(41)])) ?? ''))
check('a slot of 11 options is refused', /check constraint/.test(await fails(() => draft(COACH, 'wide', 'Wide', [Array.from({ length: 11 }, (_, i) => 'C' + i)])) ?? ''))
check('an object in a slot is refused', /check constraint/.test(await fails(() => draft(COACH, 'obj', 'Obj', [{ evil: true }])) ?? ''))
check('a KPI id of 65 characters is refused', /check constraint/.test(await fails(() => as(COACH, () => db.query(`update public.team_session_player_objectives set kpi_ids = $2 where session_id = $1 and player_id = $3`, [session, ['k'.repeat(65)], PLAYER]))) ?? ''))
await db.query('delete from public.team_session_drafts where source_id = $1', ['opts'])

// CyberSecurity (a): a shared draft copied onto the session comes from the session's group.
const sharedHere = (await one(`insert into public.team_drafts (group_id, name, created_by) values ($1, 'Ici', $2) returning id`, [G, COACH])).id
const sharedThere = (await one(`insert into public.team_drafts (group_id, name, created_by) values ($1, 'Ailleurs', $2) returning id`, [G2, OUTSIDER])).id
check('a shared draft of the session\'s group is attached', (await fails(() => draft(COACH, 'team:' + sharedHere, 'Ici'))) === null)
check('a shared draft of another group is refused', /FORBIDDEN/.test(await fails(() => draft(COACH, 'team:' + sharedThere, 'Ailleurs')) ?? ''))
check('a shared source that is not a draft id is refused', /INVALID_SOURCE/.test(await fails(() => draft(COACH, 'team:not-a-uuid', 'X')) ?? ''))
await db.query('delete from public.team_session_drafts where source_id = $1', ['team:' + sharedHere])
const can = async (user) => (await as(user, () => db.query('select public.can_prepare_team_session($1) ok', [session]))).rows[0].ok
check('the screen asks who may prepare: the coach and the analyst yes, a player no', (await can(COACH)) === true && (await can(ANALYST)) === true && (await can(PLAYER)) === false)
check('a player of the group reads the drafts', (await as(MATE, () => db.query('select count(*)::int n from public.team_session_drafts'))).rows[0].n === 3)
check('someone outside the group does not', (await as(OUTSIDER, () => db.query('select count(*)::int n from public.team_session_drafts'))).rows[0].n === 0)

await db.query(`update public.team_sessions set status = 'live', started_at = now() where id = $1`, [session])
check('once the session started the preparation is read only', (await can(COACH)) === false && /row-level security/.test(await fails(() => message(COACH, 'trop tard')) ?? ''))
await db.query(`update public.team_sessions set status = 'ended', ended_at = now() where id = $1`, [session])
check('nobody prepares an ended session', (await can(COACH)) === false)
check('an ended session is frozen: no new objective', /row-level security/.test(await fails(() => setObj(COACH, PLAYER, ['late'])) ?? ''))
const frozenDelete = await as(COACH, () => db.query('delete from public.team_session_drafts where session_id = $1', [session]))
check('… and its drafts cannot be removed', frozenDelete.affectedRows === 0)
check('… but they are still read', (await seenBy(COACH)).length === 3)

await db.query('delete from public.team_sessions where id = $1', [session])
check('deleting the session deletes what was prepared', (await one('select ((select count(*) from public.team_session_drafts) + (select count(*) from public.team_session_player_objectives) + (select count(*) from public.team_session_prep_notes))::int n')).n === 0)

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
