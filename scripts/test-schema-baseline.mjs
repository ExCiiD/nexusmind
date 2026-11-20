#!/usr/bin/env node
/**
 * WSC-05 / DA-4: the repository's migrations must rebuild the production schema exactly.
 *
 * 1. History: every migration production recorded (supabase/baseline/prod_migrations_20261120_beta10.txt, md5 of the SQL
 *    production ran) has a file in supabase/migrations under the same version and name (since 20/11/2026 every
 *    file carries its production version), and the file's SQL is the one production ran (the restore header of
 *    the 15 files restored on 20/11/2026 is set aside).
 * 2. Schema: the files production applied, replayed in order on a throw-away Postgres (PGlite, in memory) with a
 *    stand-in for what the Supabase platform provides (auth, storage, pg_cron, pgcrypto, roles, default grants),
 *    give the same fingerprint as production (scripts/schema-snapshot.sql, saved in
 *    supabase/baseline/prod_schema_20261120_beta10.txt). Migrations production has not applied yet are left out.
 *
 * Usage: node scripts/test-schema-baseline.mjs <folder where @electric-sql/pglite is installed>
 * Read-only: never touches production. Refresh the two baseline files with read-only queries only.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { openPglite, replay as replayFiles, PGLITE_VERSION, POSTGRES_MAJOR } from './lib/pgliteSupabase.mjs'

const pgliteDir = process.argv[2]
if (!pgliteDir) { console.error('Pass the folder that holds node_modules/@electric-sql/pglite.'); process.exit(2) }
const repo = join(dirname(fileURLToPath(import.meta.url)), '..')
const migDir = join(repo, 'supabase/migrations')

let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      ${detail}`}`)
  if (!ok) failures++
}
const md5 = (s) => createHash('md5').update(s).digest('hex')

// ── 1. History ─────────────────────────────────────────────────────────────
const prodMigrations = readFileSync(join(repo, 'supabase/baseline/prod_migrations_20261120_beta10.txt'), 'utf-8')
  .split(/\r?\n/).filter(Boolean).map((l) => { const [version, name, hash] = l.split('|'); return { version, name, hash } })
const files = readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort()
  .map((f) => { const m = /^(\d+)_(.+)\.sql$/.exec(f); return { file: f, version: m[1], name: m[2] } })

/** The SQL as production would have recorded it: CRs and the restore header removed, trimmed like btrim(' \n\t'). */
function bodyOf(file) {
  let text = readFileSync(join(migDir, file), 'utf-8').replace(/\r/g, '')
  if (text.startsWith('-- Restored ')) text = text.split('\n').slice(4).join('\n')
  return text.replace(/^[ \n\t]+|[ \n\t]+$/g, '')
}

/**
 * Production migrations whose statement was folded into another file instead of having its own: restoring them as
 * their own file would break a rebuild in file order (it would run before the object it locks exists). The test
 * checks that the statement production ran is in that file, word for word.
 */
const FOLDED = {
  e8_notifications_v2_lock_trigger_fn: {
    into: '20261114003906_e8_notifications_v2.sql',
    statement: 'revoke all on function public.notify_task_assigned() from public, authenticated, anon;',
  },
}

const applied = []
const differs = []
let accounted = 0
for (const p of prodMigrations) {
  const folded = FOLDED[p.name]
  if (folded) {
    const ok = md5(folded.statement) === p.hash && readFileSync(join(migDir, folded.into), 'utf-8').includes(folded.statement)
    check(`history: ${p.version}_${p.name} is folded into ${folded.into}, word for word`, ok)
    if (ok) accounted++
    continue
  }
  const f = files.find((x) => x.version === p.version && x.name === p.name)
  if (!f) {
    const renamed = files.find((x) => x.name === p.name)
    check(`history: production migration ${p.version}_${p.name} has a file`, false,
      renamed ? `${renamed.file} carries another version: supabase db push would run it again` : 'missing from supabase/migrations')
    continue
  }
  applied.push(f)
  accounted++
  if (md5(bodyOf(f.file)) !== p.hash) differs.push(`${f.file} (production ran ${p.version}_${p.name})`)
}
check(`history: all ${prodMigrations.length} production migrations are in the repository`, accounted === prodMigrations.length)
const notApplied = files.filter((f) => !applied.includes(f))
console.log(`INFO  files production has not applied yet (left out of the replay): ${notApplied.map((f) => f.file).join(', ') || 'none'}`)
// A file whose SQL differs from what production ran is reported, not failed: the schema comparison below decides
// whether the difference matters (comments and formatting do not).
console.log(`INFO  files whose text differs from what production ran: ${differs.length}${differs.length ? '\n      ' + differs.join('\n      ') : ''}`)
const restored = files.filter((f) => readFileSync(join(migDir, f.file), 'utf-8').startsWith('-- Restored '))
check(`history: the ${restored.length} restored files are byte for byte what production ran`,
  restored.every((f) => { const p = prodMigrations.find((x) => x.version === f.version); return p && md5(bodyOf(f.file)) === p.hash }),
  restored.filter((f) => { const p = prodMigrations.find((x) => x.version === f.version); return !p || md5(bodyOf(f.file)) !== p.hash }).map((f) => f.file).join(', '))

// ── 2. Schema ──────────────────────────────────────────────────────────────
// The Supabase stand-in (roles, default grants read on production, auth, storage, pg_cron, extensions) lives in
// scripts/lib/pgliteSupabase.mjs, shared with the other migration tests.
const snapshotSql = readFileSync(join(repo, 'scripts/schema-snapshot.sql'), 'utf-8')
const prod = readFileSync(join(repo, 'supabase/baseline/prod_schema_20261120_beta10.txt'), 'utf-8').split(/\r?\n/).filter(Boolean)
const key = (l) => l.split('|').slice(0, 2).join('|')

/** Replays `list` on a fresh database: the database, or null after reporting the file that failed. */
async function replay(label, list) {
  let db
  // PostgreSQL 17 only, like production (openPglite says which PGlite to install otherwise).
  try { db = await openPglite(pgliteDir) }
  catch (e) { check(`${label}: PostgreSQL ${POSTGRES_MAJOR} (PGlite ${PGLITE_VERSION})`, false, e.message); return null }
  try { await replayFiles(db, list.map((f) => f.file)) }
  catch (e) { check(`${label}: every file runs`, false, e.message); return null }
  check(`${label}: the ${list.length} migrations run on an empty database`, true)
  return db
}

/** The differences between a replayed database and production, as lines (empty when they match). */
async function diffWithProduction(db) {
  const local = String((await db.query(snapshotSql)).rows[0].snapshot ?? '').split('\n').filter(Boolean)
  const localByKey = new Map(local.map((l) => [key(l), l]))
  const prodByKey = new Map(prod.map((l) => [key(l), l]))
  return [
    ...prod.filter((l) => !localByKey.has(key(l))).map((l) => `missing   ${key(l)}`),
    ...local.filter((l) => !prodByKey.has(key(l))).map((l) => `extra     ${key(l)}`),
    ...prod.filter((l) => localByKey.has(key(l)) && localByKey.get(key(l)) !== l)
      .map((l) => `different ${key(l)}: production ${l.split('|')[2]}, repository ${localByKey.get(key(l)).split('|')[2]}`),
  ]
}

// a. In the order production applied them.
const inProdOrder = await replay('replay in production order', applied)
if (inProdOrder) {
  const diff = await diffWithProduction(inProdOrder)
  check(`schema (production order): the same ${prod.length} objects as production, same fingerprints`, diff.length === 0, diff.join('\n      '))

  // The comparison can fail: one column more, one grant less, and it says so.
  await inProdOrder.exec('alter table public.scrims add column zz_probe int; revoke execute on function public.set_captain(uuid, uuid, boolean) from authenticated;')
  const probe = await diffWithProduction(inProdOrder)
  check('schema: the comparison catches a changed table and a changed grant',
    probe.some((l) => l.startsWith('different table|public.scrims')) && probe.some((l) => l.includes('public.set_captain(')), probe.join('\n      '))
}

// b. In file-name order, what `supabase db reset` does on a new database.
const inFileOrder = await replay('replay in file order', [...applied].sort((a, b) => a.file.localeCompare(b.file)))
if (inFileOrder) {
  const diff = await diffWithProduction(inFileOrder)
  check('schema (file order): the same objects and fingerprints as production', diff.length === 0, diff.join('\n      '))
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed')
process.exit(failures ? 1 : 0)
