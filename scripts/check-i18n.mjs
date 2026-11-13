#!/usr/bin/env node
// @ts-check
/**
 * i18n consistency check (run in CI):
 *  1. every key in en.json exists in fr.json and vice versa;
 *  2. every literal key used in the code (t('a.b'), i18nKey="a.b") exists in en.json.
 * Plural forms (`key_one`, `key_other`…) satisfy a usage of `key`.
 * Exits 1 on any problem.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const load = (lang) => JSON.parse(readFileSync(join(root, 'src', 'i18n', 'locales', `${lang}.json`), 'utf-8'))

/** @returns {string[]} */
const flatten = (obj, prefix = '') =>
  Object.entries(obj).flatMap(([k, v]) =>
    // Arrays are leaves: they are read whole with { returnObjects: true }.
    v && typeof v === 'object' && !Array.isArray(v) ? flatten(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  )

const en = new Set(flatten(load('en')))
const fr = new Set(flatten(load('fr')))
const PLURAL = /_(zero|one|two|few|many|other)$/
const enBase = new Set([...en].map((k) => k.replace(PLURAL, '')))

const problems = []
for (const k of en) if (!fr.has(k)) problems.push(`missing in fr.json: ${k}`)
for (const k of fr) if (!en.has(k)) problems.push(`missing in en.json: ${k}`)

/** @returns {string[]} */
const walk = (dir) =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? walk(p) : /\.(tsx?|jsx?)$/.test(f) ? [p] : []
  })

// Only plain literal keys: dynamic keys (`t(\`kpi.${id}\`)`) can't be checked statically.
const USAGE = /(?:\bt|i18n\.t)\(\s*['"]([\w.-]+)['"]|i18nKey=["']([\w.-]+)["']/g
for (const file of [...walk(join(root, 'src')), ...walk(join(root, 'web', 'src'))]) {
  const src = readFileSync(file, 'utf-8')
  for (const m of src.matchAll(USAGE)) {
    const key = m[1] ?? m[2]
    if (!key.includes('.')) continue // not a namespaced key (e.g. t('x') helpers)
    if (!en.has(key) && !enBase.has(key)) {
      problems.push(`used but not translated: ${key}  (${file.slice(root.length + 1)})`)
    }
  }
}

if (problems.length) {
  console.error(`i18n check failed (${problems.length}):\n  ` + [...new Set(problems)].join('\n  '))
  process.exit(1)
}
console.log(`i18n OK — ${en.size} keys, en/fr in sync, all literal usages translated.`)
