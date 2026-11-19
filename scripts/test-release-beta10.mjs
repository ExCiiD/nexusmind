#!/usr/bin/env node
/**
 * Rehearsal of the beta.10 database release (docs/MISE_EN_PROD_BETA10.md), on a throw-away Postgres (PGlite 0.3,
 * PostgreSQL 17) rebuilt from every migration production has applied, never on the project's database:
 *   1. the three migrations in release order: 20261119290000 (analyst), 20261120120000 (#49), 20261120130000 (#46)
 *   2. their three rollbacks in reverse order: the schema is production's again (scripts/schema-snapshot.sql
 *      against supabase/baseline/prod_schema_20261120.txt)
 *   3. the three migrations once more (the release can be retried after a rollback)
 *
 * Usage: node scripts/test-release-beta10.mjs <folder where @electric-sql/pglite is installed>
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { openPglite, replay, migrationFiles, repo, migDir, forPglite } from './lib/pgliteSupabase.mjs'

const pgliteDir = process.argv[2]
if (!pgliteDir) { console.error('Pass the folder that holds node_modules/@electric-sql/pglite.'); process.exit(2) }

const RELEASE = ['20261119290000_analyst_draft_log_dossiers', '20261120120000_scrims_in_planning', '20261120130000_roster_member_link']
let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      ${detail}`}`)
  if (!ok) failures++
}

const prodMigrations = readFileSync(join(repo, 'supabase/baseline/prod_migrations_20261120.txt'), 'utf-8')
  .split(/\r?\n/).filter(Boolean).map((l) => l.split('|').slice(0, 2).join('_') + '.sql')
const files = migrationFiles()
const inProduction = files.filter((f) => prodMigrations.includes(f))
const releaseFiles = RELEASE.map((name) => `${name}.sql`)
check('the release files exist and are not in production yet', releaseFiles.every((f) => files.includes(f) && !inProduction.includes(f)), releaseFiles.join(', '))
check('nothing else is waiting to be released', files.filter((f) => !inProduction.includes(f) && !releaseFiles.includes(f)).length === 0,
  files.filter((f) => !inProduction.includes(f) && !releaseFiles.includes(f)).join(', '))

const db = await openPglite(pgliteDir)
await replay(db, inProduction)
const snapshotSql = readFileSync(join(repo, 'scripts/schema-snapshot.sql'), 'utf-8')
const snapshot = async () => String((await db.query(snapshotSql)).rows[0].snapshot ?? '')
const prod = readFileSync(join(repo, 'supabase/baseline/prod_schema_20261120.txt'), 'utf-8').split(/\r?\n/).filter(Boolean).join('\n')
check('the starting point is production\'s schema', (await snapshot()) === prod)

const apply = async (label) => {
  for (const f of releaseFiles) {
    try { await db.exec(forPglite(readFileSync(join(migDir, f), 'utf-8'))) }
    catch (e) { check(`${label}: ${f}`, false, e.message); return false }
  }
  check(`${label}: the three migrations apply in release order`, true)
  return true
}

if (await apply('release')) {
  const released = await snapshot()
  check('the release changes the schema', released !== prod)
  let rolledBack = true
  for (const name of [...RELEASE].reverse()) {
    try { await db.exec(readFileSync(join(repo, `supabase/rollback/${name.slice(0, 14)}_rollback.sql`), 'utf-8')) }
    catch (e) { check(`rollback ${name}`, false, e.message); rolledBack = false; break }
  }
  if (rolledBack) {
    const after = await snapshot()
    const a = new Set(after.split('\n'))
    const p = new Set(prod.split('\n'))
    const diff = [...[...p].filter((l) => !a.has(l)).map((l) => `missing   ${l}`), ...[...a].filter((l) => !p.has(l)).map((l) => `left over ${l}`)]
    check('the three rollbacks, in reverse order, give production\'s schema back exactly', diff.length === 0, diff.join('\n      '))
    if (await apply('again')) check('after a rollback the release gives the same schema again', (await snapshot()) === released)
  }
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed')
process.exit(failures ? 1 : 0)
