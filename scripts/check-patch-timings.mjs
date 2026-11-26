#!/usr/bin/env node
/**
 * Engine timing watch (26/11/2026, user request: "faire des recherches automatiques toutes les 2 semaines").
 *
 * The micro-review and the mistake rules rely on game timers (camps, Voidgrubs, Herald, Baron, dragons, minions,
 * Scuttle Crab, plates, respawn) listed in docs/moteur/DONNEES_JEU_2026.md and pinned in docs/engine-timings.json.
 * This script compares them with the newest patch:
 *   1. reads the latest live patch from Data Dragon (16.23.1 = patch 26.23);
 *   2. reads the "Patch History" of the official wiki pages that carry those timers;
 *   3. lists every entry newer than `lastVerifiedPatch` (manifest) that mentions a timer, spawn, respawn or clock time.
 *
 * Exit 0: nothing to review. Exit 1: a review is due (report on stdout, Markdown). Exit 2: network or parse failure.
 * After a review, bump `lastVerifiedPatch` in the manifest (and fix the code and docs if a timer moved).
 * Read-only, public pages only, no secret. Usage: node scripts/check-patch-timings.mjs [--manifest path] [--json]
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const argOf = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null }
const manifestPath = resolve(argOf('--manifest') ?? resolve(here, '../docs/engine-timings.json'))
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))

const UA = 'NexusMind-timing-check/1.0 (public patch-history reader)'
const WIKI = 'https://wiki.leagueoflegends.com/en-us/api.php'
// Words that make a patch-history line relevant to the engine's clocks.
const TIMING = /spawn|respawn|timer|initial|\bfirst\b|\bdelay|\bappear|despawn|cooldown|\d{1,2}:\d{2}|\d+\s*(?:seconds?|minutes?)|\bsecond\b|\bminute\b/i

/** "26.23" → [26, 23] ; "S1.2" suffixes sort after the numbered patches of the same season. */
function parsePatch(v) {
  const m = /^V?(\d{2})\.(\d{1,2})/.exec(v)
  return m ? [Number(m[1]), Number(m[2])] : null
}
const newer = (a, b) => a[0] > b[0] || (a[0] === b[0] && a[1] > b[1])

async function getJson(url) {
  const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } })
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  return res.json()
}

/** Live patch ("26.23") from Data Dragon: the game version 16.23.1 is season 2026, patch 23. */
async function latestPatch() {
  const versions = await getJson('https://ddragon.leagueoflegends.com/api/versions.json')
  const m = /^(\d+)\.(\d+)/.exec(versions[0])
  if (!m) throw new Error(`unexpected ddragon version ${versions[0]}`)
  return [Number(m[1]) + 10, Number(m[2])]
}

async function wikitext(title) {
  const url = `${WIKI}?action=query&prop=revisions&rvprop=content&rvslots=main&format=json&formatversion=2&redirects=1&titles=${encodeURIComponent(title)}`
  const page = (await getJson(url)).query?.pages?.[0]
  const text = page?.revisions?.[0]?.slots?.main?.content
  if (!text) throw new Error(`no wikitext for ${title}`)
  return text
}

/** The Patch History section as [{ version, lines }], newest first. */
function patchHistory(text) {
  const start = text.search(/==\s*Patch History\s*==/i)
  if (start < 0) return []
  const out = []
  let cur = null
  for (const line of text.slice(start).split('\n').slice(1)) {
    if (/^==[^=]/.test(line)) break
    const head = /^;\s*\[\[(V[\w.]+)/.exec(line)
    if (head) { cur = { version: head[1], lines: [] }; out.push(cur); continue }
    if (cur && line.trim()) cur.lines.push(line.replace(/\{\{[^}]*\}\}/g, (s) => s.replace(/\{\{|\}\}/g, '')).replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1').trim())
  }
  return out
}

const latest = await latestPatch().catch((e) => { console.error(`ddragon: ${e.message}`); process.exit(2) })
const verified = parsePatch(manifest.lastVerifiedPatch)
if (!verified) { console.error('manifest.lastVerifiedPatch is not a patch number'); process.exit(2) }

const findings = []
let failed = false
for (const title of manifest.wikiPages) {
  try {
    for (const entry of patchHistory(await wikitext(title))) {
      const p = parsePatch(entry.version)
      if (!p || !newer(p, verified)) continue
      const hits = entry.lines.filter((l) => TIMING.test(l))
      if (hits.length) findings.push({ page: title, version: entry.version, lines: hits })
    }
  } catch (e) {
    failed = true
    console.error(`wiki ${title}: ${e.message}`)
  }
}
if (failed && findings.length === 0) process.exit(2)

const behind = newer(latest, verified)
const label = `${latest[0]}.${latest[1]}`
if (args.includes('--json')) {
  console.log(JSON.stringify({ latestPatch: label, lastVerifiedPatch: manifest.lastVerifiedPatch, findings }, null, 2))
} else {
  console.log(`# Engine timings: patch ${label} live, last verified ${manifest.lastVerifiedPatch}\n`)
  if (!behind && findings.length === 0) console.log('Nothing to review.')
  if (behind) console.log(`New patch(es) since the last review: check the official notes for objective, camp, wave and respawn timers (https://www.leagueoflegends.com/en-us/news/tags/patch-notes/).\n`)
  for (const f of findings) {
    console.log(`## ${f.page}, ${f.version}`)
    for (const l of f.lines) console.log(`- ${l}`)
    console.log('')
  }
  console.log(`Pinned values: docs/engine-timings.json. After the review, set lastVerifiedPatch to ${label}.`)
}
process.exit(behind || findings.length ? 1 : 0)
