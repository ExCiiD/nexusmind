/**
 * Phase 0a of docs/moteur/PLAN_MOTEUR_BILANS.md: four read-only checks on a copy of the MatchCache (16.x games only).
 * Usage: npx tsx scripts/verify-bilans-0a.ts <path-to-copy-of-nexusmind.db>
 * No write, no Riot call.
 */
import { cachedCurrentGames } from './lib/cacheReadOnly'
import { analyzeGame } from '../src/lib/microReview/anomalyDetector'

const path = process.argv[2]
if (!path) throw new Error('usage: verify-bilans-0a.ts <db copy>')

const patchOf = (m: any) => String(m?.info?.gameVersion ?? '').split('.').slice(0, 2).join('.')
const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)} %` : 'n/a')
const median = (v: number[]) => (v.length ? [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)] : null)

let games = 0
const byPatch = new Map<string, number>()
let kills = 0, killsBounty = 0, killsShutdown = 0, killsShutdownPositive = 0
const bountyVals: number[] = []
// item id -> role -> patch -> destroy times (s) of the player's own ITEM_DESTROYED
const destroyed = new Map<string, number[]>()
const participantsByRole = new Map<string, number>()
let jglFrames = 0, jglMinionsPresent = 0, jglMinionsPositive = 0
let jglLaneGainSamples = 0
const timings: number[] = []
const analysed: Array<{ ms: number; frames: number }> = []

for (const g of cachedCurrentGames(path)) {
  games++
  const patch = patchOf(g.match)
  byPatch.set(patch, (byPatch.get(patch) ?? 0) + 1)
  const parts: any[] = g.match.info.participants
  const posOf = (p: any) => p.teamPosition || p.individualPosition || ''
  for (const p of parts) participantsByRole.set(posOf(p), (participantsByRole.get(posOf(p)) ?? 0) + 1)
  const frames: any[] = g.timeline.info.frames ?? []
  for (const f of frames) {
    for (const e of f.events ?? []) {
      if (e.type === 'CHAMPION_KILL') {
        kills++
        if (typeof e.bounty === 'number') { killsBounty++; bountyVals.push(e.bounty) }
        if (typeof e.shutdownBounty === 'number') { killsShutdown++; if (e.shutdownBounty > 0) killsShutdownPositive++ }
      } else if (e.type === 'ITEM_DESTROYED' && typeof e.itemId === 'number' && e.itemId >= 1200 && e.itemId <= 1230) {
        const p = parts.find((x) => x.participantId === e.participantId)
        const role = p ? posOf(p) : '?'
        const key = `${e.itemId}|${role}|${patch}`
        const arr = destroyed.get(key) ?? []
        arr.push(Math.round(e.timestamp / 1000))
        destroyed.set(key, arr)
      }
    }
    for (const p of parts.filter((x) => posOf(x) === 'JUNGLE')) {
      const pf = f.participantFrames?.[String(p.participantId)]
      if (!pf) continue
      jglFrames++
      if (typeof pf.minionsKilled === 'number') { jglMinionsPresent++; if (pf.minionsKilled > 0) jglMinionsPositive++ }
    }
  }
  // lane-minion gains of the jungler between 2:00 and 12:00 minutes (is the counter usable as a presence proof?)
  for (const p of parts.filter((x) => posOf(x) === 'JUNGLE')) {
    for (let k = 2; k < Math.min(12, frames.length - 1); k++) {
      const a = frames[k].participantFrames?.[String(p.participantId)]?.minionsKilled
      const b = frames[k + 1].participantFrames?.[String(p.participantId)]?.minionsKilled
      if (typeof a === 'number' && typeof b === 'number') jglLaneGainSamples += b > a ? 1 : 0
    }
  }
  // recompute time on up to 20 games (the user's own side: each mid + the first jungler, to keep it representative)
  if (analysed.length < 20) {
    const me = parts.find((x) => posOf(x) === 'MIDDLE') ?? parts[0]
    const t0 = performance.now()
    analyzeGame(g.match, g.timeline, { puuids: [me.puuid] })
    const ms = performance.now() - t0
    timings.push(ms)
    analysed.push({ ms, frames: frames.length })
  }
}

console.log(`games 16.x: ${games}`)
console.log('by patch:', [...byPatch.entries()].sort().map(([k, v]) => `${k}:${v}`).join(' '))
console.log(`\n(1) CHAMPION_KILL: ${kills} kills; bounty present ${killsBounty} (${pct(killsBounty, kills)}); shutdownBounty present ${killsShutdown} (${pct(killsShutdown, kills)}), > 0 on ${killsShutdownPositive}`)
console.log(`    bounty median ${median(bountyVals)}, min ${Math.min(...bountyVals)}, max ${Math.max(...bountyVals)}`)
console.log('\n(2) ITEM_DESTROYED 1200-1230 by item | role | patch: count, p10/median/p90 (s)')
const q = (v: number[], f: number) => [...v].sort((a, b) => a - b)[Math.min(v.length - 1, Math.floor(v.length * f))]
for (const [k, v] of [...destroyed.entries()].sort()) {
  if (v.length < 5) continue
  console.log(`    ${k}: n=${v.length} ${q(v, 0.1)}/${q(v, 0.5)}/${q(v, 0.9)}`)
}
console.log('    participants by role:', [...participantsByRole.entries()].map(([k, v]) => `${k}:${v}`).join(' '))
console.log(`\n(3) jungler frames ${jglFrames}; minionsKilled present ${jglMinionsPresent} (${pct(jglMinionsPresent, jglFrames)}), > 0 on ${jglMinionsPositive} (${pct(jglMinionsPositive, jglFrames)}); minute pairs 2-12 min with a lane-CS gain: ${jglLaneGainSamples}`)
console.log(`\n(4) analyzeGame on ${timings.length} games: median ${median(timings)?.toFixed(0)} ms, mean ${(timings.reduce((a, b) => a + b, 0) / timings.length).toFixed(0)} ms, max ${Math.max(...timings).toFixed(0)} ms (frames ${analysed.map((a) => a.frames).join(',')})`)
