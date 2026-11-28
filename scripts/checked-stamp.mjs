// Remembers which code `npm run check` last passed on, so scripts/release.ps1 does not run
// the same checks a second time (28/11/2026: releases ran typecheck, lint, i18n and the
// unit tests twice, once before the commit and again in the release script).
//
//   node scripts/checked-stamp.mjs write    after the checks pass (end of `npm run check`)
//   node scripts/checked-stamp.mjs verify   exit 0 if the folder is exactly what passed, 1 otherwise
//
// Any edit, even one byte, to a tracked or untracked (non-ignored) file means checking again.
// Bump the version before `npm run check`, not after, or the release runs the checks again.
// The stamp lives in node_modules/.cache (git-ignored), so writing it does not change the fingerprint.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')
const stampPath = join(repo, 'node_modules', '.cache', 'ascend-checked.json')
const git = (args, env) =>
  execFileSync('git', args, { cwd: repo, env: { ...process.env, ...env }, maxBuffer: 1024 * 1024 * 1024 })

// The git tree of the folder as it is (tracked edits and untracked, non-ignored files), built in a
// throw-away index so the real one is untouched. It depends on the content only: committing what
// was checked keeps the same tree, so a release right after `check` + commit skips the checks.
function fingerprint() {
  const tmpIndex = join(repo, 'node_modules', '.cache', 'ascend-checked.index')
  mkdirSync(dirname(tmpIndex), { recursive: true })
  const realIndex = join(repo, git(['rev-parse', '--git-path', 'index']).toString('utf8').trim())
  if (existsSync(realIndex)) copyFileSync(realIndex, tmpIndex)
  else rmSync(tmpIndex, { force: true })
  const env = { GIT_INDEX_FILE: tmpIndex }
  git(['add', '-A', '--', '.'], env)
  const tree = git(['write-tree'], env).toString('utf8').trim()
  rmSync(tmpIndex, { force: true })
  return createHash('sha256').update(tree).digest('hex')
}

const mode = process.argv[2]
if (mode === 'write') {
  mkdirSync(dirname(stampPath), { recursive: true })
  writeFileSync(stampPath, JSON.stringify({ fingerprint: fingerprint(), at: new Date().toISOString() }) + '\n')
  console.log('[checked-stamp] checks recorded for this exact working folder')
} else if (mode === 'verify') {
  if (!existsSync(stampPath)) process.exit(1)
  let stamp
  try { stamp = JSON.parse(readFileSync(stampPath, 'utf8')) } catch { process.exit(1) }
  if (stamp?.fingerprint !== fingerprint()) process.exit(1)
  console.log(`[checked-stamp] this exact working folder passed npm run check at ${stamp.at}`)
} else {
  console.error('usage: node scripts/checked-stamp.mjs write|verify')
  process.exit(2)
}
