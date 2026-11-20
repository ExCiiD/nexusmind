#!/usr/bin/env node
/**
 * End-to-end check of supabase/migrations/20261120060647_roster_member_link.sql (#46 point 4) and its rollback, on
 * a throw-away Postgres (PGlite 0.3, PostgreSQL 17) rebuilt from the migrations production has applied.
 *
 * Usage: node scripts/test-roster-member-link.mjs <folder where @electric-sql/pglite is installed>
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { openPglite, replay, migrationFiles, repo, migDir } from './lib/pgliteSupabase.mjs'

const pgliteDir = process.argv[2]
if (!pgliteDir) { console.error('Pass the folder that holds node_modules/@electric-sql/pglite.'); process.exit(2) }

const MIGRATION = '20261120060647_roster_member_link.sql'
const migration = readFileSync(join(migDir, MIGRATION), 'utf-8')
const rollback = readFileSync(join(repo, 'supabase/rollback/20261120060647_rollback.sql'), 'utf-8')

let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  ${detail}`}`)
  if (!ok) failures++
}

const db = await openPglite(pgliteDir)
await replay(db, migrationFiles().filter((f) => f < MIGRATION && !f.startsWith('20261119223819')))
const one = async (sql, params) => (await db.query(sql, params)).rows[0]
const u = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const COACH = u(1), MANAGER = u(2), AYURA = u(3), MID = u(4), OUTSIDER = u(5)
const G = '10000000-0000-0000-0000-000000000001', G2 = '10000000-0000-0000-0000-000000000002'
async function as(user, fn) {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [user])
  await db.exec('set role authenticated')
  try { return await fn() } finally { await db.exec('reset role') }
}
const link = (user, roster, member) => as(user, () => db.query('select public.link_roster_member($1, $2)', [roster, member]))
async function fails(user, roster, member) { try { await link(user, roster, member); return null } catch (e) { return e.message } }

for (const id of [COACH, MANAGER, AYURA, MID, OUTSIDER]) await db.query('insert into auth.users (id) values ($1)', [id])
await db.query(`insert into public.groups (id, name, kind, created_by) values ($1, 'G', 'team', $2), ($3, 'G2', 'team', $4)`, [G, COACH, G2, OUTSIDER])
await db.query(`insert into public.group_members (group_id, user_id, role, riot_id, puuid, puuid_status, display_name) values
  ($1, $2, 'owner', null, null, null, 'Coach'),
  ($1, $3, 'manager', null, null, null, 'Manager'),
  ($1, $4, 'player', 'AYURA#1012', 'PUUID-AYURA-000000000000', 'verified', 'AYURA'),
  ($1, $5, 'player', 'Mid Laner#EUW', 'PUUID-TYPED-000000000000', null, 'Mid')`, [G, COACH, MANAGER, AYURA, MID])
await db.query(`insert into public.group_members (group_id, user_id, role, display_name) values ($1, $2, 'owner', 'X')`, [G2, OUTSIDER])
const row = async (display, ign, tag, scouting = null) => (await one(`insert into public.team_rosters (group_id, display_name, ign, tag_line, role, status, scouting_id, created_by)
  values ($1, $2, $3, $4, 'ADC', 'starter', $5, $6) returning id`, [G, display, ign, tag, scouting, COACH])).id
const R_OLD = await row('ORE WA AYURA', 'ORE WA AYURA', 'EUW')
const R_OTHER = await row('Other', 'Other', 'EUW')
const S = (await one(`insert into public.team_scouting (group_id, name, created_by) values ($1, 'Rival', $2) returning id`, [G, COACH])).id
const R_OPP = await row('Opp', 'Opp', 'EUW', S)

await db.exec(migration)
await db.exec(migration)
check('the migration applies twice', true)

check('a manager (not staff for the roster) cannot link', /FORBIDDEN/.test(await fails(MANAGER, R_OLD, AYURA) ?? ''))
check('a player cannot link', /FORBIDDEN/.test(await fails(AYURA, R_OLD, AYURA) ?? ''))
check('a staff member of another group cannot', /FORBIDDEN/.test(await fails(OUTSIDER, R_OLD, AYURA) ?? ''))
check('a scouted opponent\'s row is not a roster row', /NOT_FOUND/.test(await fails(COACH, R_OPP, AYURA) ?? ''))
check('someone outside the group cannot be linked', /NOT_A_MEMBER/.test(await fails(COACH, R_OLD, OUTSIDER) ?? ''))

const r1 = (await link(COACH, R_OLD, AYURA)).rows[0].link_roster_member
const linked = await one('select user_id, puuid, ign, tag_line, display_name from public.team_rosters where id = $1', [R_OLD])
check('the coach links "ORE WA AYURA" to AYURA: account, current Riot ID, verified puuid (returns true)',
  r1 === true && linked.user_id === AYURA && linked.ign === 'AYURA' && linked.tag_line === '1012' && linked.puuid === 'PUUID-AYURA-000000000000', JSON.stringify({ r1, linked }))

const r2 = (await link(COACH, R_OTHER, MID)).rows[0].link_roster_member
const mid = await one('select user_id, puuid, ign, tag_line from public.team_rosters where id = $1', [R_OTHER])
check('CyberSecurity: a member whose Riot ID is not verified is linked, but the row keeps its own Riot ID and gets no puuid (returns false)',
  r2 === false && mid.user_id === MID && mid.puuid === null && mid.ign === 'Other' && mid.tag_line === 'EUW', JSON.stringify({ r2, mid }))

await link(COACH, R_OTHER, AYURA)
const moved = await one('select (select user_id from public.team_rosters where id = $1) a, (select user_id from public.team_rosters where id = $2) b', [R_OLD, R_OTHER])
check('one row per member: linking AYURA elsewhere unlinks the first row', moved.a === null && moved.b === AYURA, JSON.stringify(moved))

await link(COACH, R_OTHER, null)
check('null unlinks', (await one('select user_id from public.team_rosters where id = $1', [R_OTHER])).user_id === null)

await db.exec('set role anon')
let anonRefused = false
try { await db.query('select public.link_roster_member(null, null)') } catch (e) { anonRefused = /permission denied/.test(e.message) }
await db.exec('reset role')
check('anon may not call it', anonRefused)

await link(COACH, R_OLD, AYURA)
await db.exec(rollback)
await db.exec(rollback)
check('the rollback applies twice and removes the function',
  Number((await one(`select count(*) n from pg_proc where proname = 'link_roster_member'`)).n) === 0)
check('the links made stay after the rollback', (await one('select user_id from public.team_rosters where id = $1', [R_OLD])).user_id === AYURA)

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed')
process.exit(failures ? 1 : 0)
