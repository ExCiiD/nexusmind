#!/usr/bin/env node
/**
 * End-to-end check of supabase/migrations/20261120140000_member_card_champion.sql (Team Lobby card champion and
 * skin) and its rollback, on a throw-away Postgres (PGlite 0.3, PostgreSQL 17) rebuilt from the migrations
 * production has applied (supabase/baseline/prod_migrations_20261120_beta10.txt).
 *
 * Usage: node scripts/test-member-card-champion.mjs <folder where @electric-sql/pglite is installed>
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { openPglite, replay, migrationFiles, repo, migDir } from './lib/pgliteSupabase.mjs'

const pgliteDir = process.argv[2]
if (!pgliteDir) { console.error('Pass the folder that holds node_modules/@electric-sql/pglite.'); process.exit(2) }

const MIGRATION = '20261120140000_member_card_champion.sql'
const migration = readFileSync(join(migDir, MIGRATION), 'utf-8')
const rollback = readFileSync(join(repo, 'supabase/rollback/20261120140000_rollback.sql'), 'utf-8')
const BASELINE = 'supabase/baseline/prod_schema_20261120_beta10.txt'
const inProduction = readFileSync(join(repo, 'supabase/baseline/prod_migrations_20261120_beta10.txt'), 'utf-8')
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
const prod = readFileSync(join(repo, BASELINE), 'utf-8').split(/\r?\n/).filter(Boolean).join('\n')
check('the starting point is production\'s schema', (await snapshot()) === prod)

const u = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const NAMI = u(1), MATE = u(2), OUTSIDER = u(3)
const G = '10000000-0000-0000-0000-000000000001', G2 = '10000000-0000-0000-0000-000000000002'
async function as(user, fn) {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [user])
  await db.exec('set role authenticated')
  try { return await fn() } finally { await db.exec('reset role') }
}
async function fails(fn) { try { await fn(); return null } catch (e) { return e.message } }
const one = async (sql, params) => (await db.query(sql, params)).rows[0]

for (const id of [NAMI, MATE, OUTSIDER]) await db.query('insert into auth.users (id) values ($1)', [id])
await db.query(`insert into public.groups (id, name, kind, created_by) values ($1, 'G', 'team', $2), ($3, 'G2', 'team', $2)`, [G, NAMI, G2])
await db.query(`insert into public.group_members (group_id, user_id, role, display_name) values
  ($1, $3, 'owner', 'Nami'), ($1, $4, 'player', 'Mate'), ($2, $3, 'owner', 'Nami')`, [G, G2, NAMI, MATE])
await db.query(`insert into public.group_members (group_id, user_id, role, display_name) values ($1, $2, 'owner', 'Out')`, [G2, OUTSIDER])

await db.exec(migration)
await db.exec(migration)
check('the migration applies twice', true)

// The member writes their own choice, on every membership (what the app does).
const write = (user, champ, skin, where = 'user_id = $3') =>
  as(user, () => db.query(`update public.group_members set card_champion = $1, card_skin_num = $2 where ${where}`, [champ, skin, user]))
const r = await write(NAMI, 'MonkeyKing', 7)
const mine = (await db.query('select group_id, card_champion, card_skin_num from public.group_members where user_id = $1 order by group_id', [NAMI])).rows
check('a member sets their card champion and skin on all their memberships',
  r.affectedRows === 2 && mine.every((m) => m.card_champion === 'MonkeyKing' && m.card_skin_num === 7), JSON.stringify(mine))

const seen = await as(MATE, () => db.query('select card_champion, card_skin_num from public.group_members where user_id = $1 and group_id = $2', [NAMI, G]))
check('a teammate reads it', seen.rows[0]?.card_champion === 'MonkeyKing' && seen.rows[0]?.card_skin_num === 7, JSON.stringify(seen.rows))

const theirs = await as(OUTSIDER, () => db.query('select count(*)::int n from public.group_members where user_id = $1 and group_id = $2', [NAMI, G]))
check('someone outside the group does not see it', theirs.rows[0].n === 0)

const other = await as(MATE, () => db.query(`update public.group_members set card_champion = 'Jinx', card_skin_num = 1 where user_id = $1`, [NAMI]))
const still = await one('select card_champion from public.group_members where user_id = $1 and group_id = $2', [NAMI, G])
check('a teammate cannot change someone else\'s choice', other.affectedRows === 0 && still.card_champion === 'MonkeyKing', JSON.stringify({ n: other.affectedRows, still }))

check('a champion that is not a Data Dragon id is refused',
  /check constraint/.test(await fails(() => write(NAMI, 'https://x.example/a.png', 1)) ?? ''))
check('a skin number out of range is refused', /check constraint/.test(await fails(() => write(NAMI, 'Ahri', 1000)) ?? ''))
check('a champion without a skin is refused', /check constraint/.test(await fails(() => write(NAMI, 'Ahri', null)) ?? ''))
check('a skin without a champion is refused', /check constraint/.test(await fails(() => write(NAMI, null, 3)) ?? ''))
await write(NAMI, null, null)
check('clearing both goes back to the default card',
  (await one('select count(*)::int n from public.group_members where user_id = $1 and card_champion is null and card_skin_num is null', [NAMI])).n === 2)

const roleChange = await fails(() => as(MATE, () => db.query(`update public.group_members set role = 'owner' where user_id = $1`, [MATE])))
check('the member still cannot change their role (the grant only adds the two columns)', /permission denied/.test(roleChange ?? ''), roleChange ?? 'no error')

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
