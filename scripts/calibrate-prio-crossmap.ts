/**
 * Calibration of the prio / crossmap / duo figures (docs/moteur/engine-reports/2026-11-27-prio-crossmap-duo.md § 6.1),
 * read-only, on a COPY of the MatchCache. Nothing is sent to Riot.
 * Usage: npx tsx scripts/calibrate-prio-crossmap.ts <copy of nexusmind.db> [--list] [--limit=N]
 * Every cached 16.x game, both teams (each side read as "ours"). --list prints examples (gameId + timestamp) for the video review.
 */
import { cachedCurrentGames } from './lib/cacheReadOnly'
import { OBJECTIVE_RULES_SPEC, objectiveRules, type ObjectiveRuleEntry, type ObjectiveRulesBlock } from '../src/lib/microReview/objectiveRules'
import { buildLedgerTrack } from '../src/lib/microReview/ledgerCore'

const path = process.argv[2]
if (!path) throw new Error('usage: calibrate-prio-crossmap.ts <db copy> [--list] [--limit=N]')
const list = process.argv.includes('--list')
const limit = Number(process.argv.find((a) => a.startsWith('--limit='))?.slice(8)) || Infinity

const t = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`
const pct = (a: number, b: number) => (b ? `${(100 * a / b).toFixed(1)} %` : 'n/a')
const count = <K extends string>(m: Map<K, number>, k: K) => m.set(k, (m.get(k) ?? 0) + 1)
const show = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(', ')

interface Row { matchId: string; team: number; win: boolean; block: ObjectiveRulesBlock }
const rows: Row[] = []
let games = 0
let ms = 0
for (const g of cachedCurrentGames(path, limit)) {
  games++
  const tr = buildLedgerTrack(g.match, g.timeline)
  if (!tr) continue
  for (const team of [100, 200] as const) {
    const t0 = performance.now()
    const block = objectiveRules(g.match, g.timeline, team, tr)
    ms += performance.now() - t0
    if (!block) continue
    const win = !!g.match.info.participants.find((p: any) => p.teamId === team)?.win
    rows.push({ matchId: g.matchId, team, win, block })
  }
}
console.log(`games 16.x: ${games}, team views: ${rows.length}, ${(ms / Math.max(1, rows.length)).toFixed(1)} ms per team view (target < 5 ms for the ledgers; this block is larger)`)

const all: Array<{ r: Row; o: ObjectiveRuleEntry }> = rows.flatMap((r) => r.block.objectives.map((o) => ({ r, o })))
console.log(`objectives read: ${all.length} (${(all.length / rows.length).toFixed(1)} per team view)`)

// 1. Prio distribution by objective kind and by signal.
console.log('\n===== 1. Prio at the climax (before 20:00 only, as the report reads it) =====')
const early = all.filter(({ o }) => o.atSec <= OBJECTIVE_RULES_SPEC.prio.untilSec && o.atSec >= OBJECTIVE_RULES_SPEC.prio.fromSec - 60)
for (const kind of ['dragon', 'grubs', 'herald', 'baron', 'elder'] as const) {
  const k = all.filter(({ o }) => o.kind === kind)
  if (!k.length) continue
  const w = k.filter(({ o }) => o.window)
  const states = (pick: (o: ObjectiveRuleEntry) => ObjectiveRuleEntry['mid']) => {
    const m = new Map<string, number>()
    for (const { o } of k) count(m, pick(o).state)
    return show(m)
  }
  const sig = new Map<string, number>()
  for (const { o } of k) count(sig, o.sideLane.signal ?? '-')
  console.log(`${kind} n=${k.length}, window ${pct(w.length, k.length)} | sideLane ${states((o) => o.sideLane)} | mid ${states((o) => o.mid)} | sideLane signals ${show(sig)}`)
}
const unk = early.filter(({ o }) => o.sideLane.state === 'unknown').length
console.log(`unknown share of the side lane before 20:00: ${pct(unk, early.length)} (target <= 25 %)`)

// 2. Coherence: the side with the prio on both lanes takes the objective.
console.log('\n===== 2. Coherence (target >= 65 %) =====')
for (const proofs of [['proven'], ['proven', 'probable'], ['proven', 'probable', 'suggested']] as const) {
  const ok = (l: ObjectiveRuleEntry['mid']) => l.proof != null && (proofs as readonly string[]).includes(l.proof)
  const A = all.filter(({ o }) => ok(o.sideLane) && ok(o.mid) && o.sideLane.state === o.mid.state && (o.mid.state === 'ours' || o.mid.state === 'theirs'))
  const hit = A.filter(({ o }) => (o.mid.state === 'ours') === o.ours)
  console.log(`  both lanes read with ${proofs.join('+')} and agreeing: n=${A.length}, the side with the prio took it ${pct(hit.length, A.length)}`)
}
const single = all.filter(({ o }) => (o.sideLane.state === 'ours' || o.sideLane.state === 'theirs') && o.sideLane.proof)
for (const proof of ['proven', 'probable', 'suggested'] as const) {
  const A = single.filter(({ o }) => o.sideLane.proof === proof)
  console.log(`  side lane alone, ${proof}: n=${A.length}, prio side took it ${pct(A.filter(({ o }) => (o.sideLane.state === 'ours') === o.ours).length, A.length)}`)
}
const bySignal = new Map<string, { n: number; hit: number }>()
for (const { o } of single) {
  const k = o.sideLane.signal ?? '-'
  const c = bySignal.get(k) ?? { n: 0, hit: 0 }
  c.n++; if ((o.sideLane.state === 'ours') === o.ours) c.hit++
  bySignal.set(k, c)
}
console.log('  by signal:', [...bySignal.entries()].sort().map(([k, v]) => `${k}: n=${v.n} ${pct(v.hit, v.n)}`).join(' | '))

// 3. Side to play, jungler engagement.
console.log('\n===== 3. Side to play (sideEdge) and engagement =====')
const fav = new Map<string, number>()
for (const { o } of all) count(fav, `${o.edge.favoured ?? 'none'}${o.edge.otherSideAvailable ? '+avail' : ''}`)
console.log(`favoured side: ${show(fav)}`)
const eng = all.filter(({ o }) => o.engaged && !o.ours && false)
void eng
const wrong = all.filter(({ o }) => o.engaged && o.edge.favoured && o.edge.favoured !== o.side && o.edge.otherSideAvailable && !o.edge.junglerEdge)
console.log(`engaged on the losing side (figure only): ${wrong.length} of ${all.length}; lost the objective ${pct(wrong.filter(({ o }) => !o.ours).length, wrong.length)}`)
const bl = new Map<string, number>()
for (const { o } of all) count(bl, o.blocked ?? 'free')
console.log(`canPlayObjective: ${show(bl)}`)

// 4. Crossmap.
console.log('\n===== 4. Objectives taken by them: contested, crossmap =====')
const theirs = all.filter(({ o }) => !o.ours)
const unc = theirs.filter(({ o }) => o.contested === false)
console.log(`theirs ${theirs.length}, not contested ${unc.length} (${pct(unc.length, theirs.length)})`)
const verdicts = new Map<string, number>()
for (const { o } of unc) count(verdicts, o.crossmap?.verdict ?? '?')
console.log(`verdicts: ${show(verdicts)}`)
const res = { objective: 0, plates: 0, towers: 0, kills: 0, invade: 0, numbers: 0 }
for (const { o } of unc) if (o.crossmap) {
  if (o.crossmap.resources.objective) res.objective++
  if (o.crossmap.resources.plates) res.plates++
  if (o.crossmap.resources.towers) res.towers++
  if (o.crossmap.resources.kills) res.kills++
  if (o.crossmap.resources.invade) res.invade++
  if (o.crossmap.resources.numbers) res.numbers++
}
console.log(`resources (objectives with at least one): ${JSON.stringify(res)}`)
for (const role of ['JUNGLE', 'MIDDLE', 'UTILITY']) {
  let n = 0, crossed = 0
  for (const { r, o } of unc) {
    if (!o.crossmap || o.crossmap.verdict === 'justified') continue
    const pid = r.block.roles.find((x) => x.role === role)?.pid
    if (pid == null) continue
    n++; if (o.crossmap.crossed.includes(pid)) crossed++
  }
  console.log(`  ${role}: crossed ${crossed}/${n} (${pct(crossed, n)})`)
}
const early14 = unc.filter(({ o }) => o.atSec < 840), late14 = unc.filter(({ o }) => o.atSec >= 840)
console.log(`  no-trade before 14:00 ${pct(early14.filter(({ o }) => o.crossmap?.verdict === 'no-trade').length, early14.length)} (n=${early14.length}), after ${pct(late14.filter(({ o }) => o.crossmap?.verdict === 'no-trade').length, late14.length)} (n=${late14.length})`)

// 5. Duo.
console.log('\n===== 5. Duo botlane =====')
const deaths = rows.flatMap((r) => r.block.duo.deaths.map((d) => ({ r, d })))
console.log(`deaths with the partner away: ${deaths.length} (${(deaths.length / rows.length).toFixed(2)} per team view)`)
for (const [label, sub] of [['before 14:00', deaths.filter((x) => !x.d.after14)], ['after 14:00', deaths.filter((x) => x.d.after14)]] as const) {
  const faults = new Map<string, number>(), reasons = new Map<string, number>()
  for (const { d } of sub) { count(faults, `${d.role === 'BOTTOM' ? 'ADC' : 'SUP'}:${d.fault}`); count(reasons, d.reason) }
  console.log(`  ${label}: n=${sub.length} | ${show(faults)} | reasons ${show(reasons)}`)
}
const adv = rows.flatMap((r) => r.block.duo.advances)
console.log(`ADC advances without the support: ${adv.length} (${(adv.length / rows.length).toFixed(2)} per team view), died in ${pct(adv.filter((a) => a.died).length, adv.length)}`)
const roamShare = deaths.filter((x) => x.d.roam).length
console.log(`deaths during a roam of the ledger: ${pct(roamShare, deaths.length)}`)

// Win rate of the games with a support fault.
const faulty = new Set(rows.filter((r) => r.block.duo.deaths.some((d) => d.fault === 'support')).map((r) => r.matchId + r.team))
const wf = rows.filter((r) => faulty.has(r.matchId + r.team)), wn = rows.filter((r) => !faulty.has(r.matchId + r.team))
console.log(`win rate: with a support-fault death ${pct(wf.filter((r) => r.win).length, wf.length)} (n=${wf.length}) vs without ${pct(wn.filter((r) => r.win).length, wn.length)}`)

// 6. Examples for the video review.
if (list) {
  console.log('\n===== 6. Examples (gameId + timestamp) =====')
  const pick = <T,>(xs: T[], n: number): T[] => { const step = Math.max(1, Math.floor(xs.length / n)); return xs.filter((_, i) => i % step === 0).slice(0, n) }
  const line = (r: Row, o: ObjectiveRuleEntry) => `${r.matchId} team ${r.team} ${r.win ? 'WIN ' : 'LOSS'} ${o.kind} taken ${t(o.atSec)} (${o.ours ? 'ours' : 'theirs'}) ref ${t(o.refSec)} W ${o.window ? `${t(o.window[0])}-${t(o.window[1])}` : '-'} side=${o.sideLane.state}/${o.sideLane.proof ?? '-'}/${o.sideLane.signal ?? '-'} mid=${o.mid.state}/${o.mid.proof ?? '-'}/${o.mid.signal ?? '-'} edge top ${o.edge.top} bot ${o.edge.bot} fav ${o.edge.favoured ?? '-'}`
  for (const kind of ['dragon', 'grubs', 'herald'] as const) {
    console.log(`-- 10 ${kind} (prio) --`)
    for (const { r, o } of pick(all.filter((x) => x.o.kind === kind && x.o.window), 10)) console.log('  ' + line(r, o))
  }
  console.log('-- 10 objectives where both sides were available (side to play) --')
  for (const { r, o } of pick(all.filter((x) => x.o.edge.favoured && x.o.edge.otherSideAvailable), 10)) console.log('  ' + line(r, o) + ` engaged=${o.engaged}`)
  console.log('-- 20 uncontested objectives of theirs (crossmap) --')
  for (const { r, o } of pick(unc.filter((x) => x.o.atSec < 840), 10).concat(pick(unc.filter((x) => x.o.atSec >= 840), 10))) {
    console.log(`  ${r.matchId} team ${r.team} ${o.kind} taken ${t(o.atSec)} ${o.crossmap?.verdict} ${JSON.stringify(o.crossmap?.resources)} crossed=[${o.crossmap?.crossed.join(',')}] blocked=${o.blocked ?? '-'}`)
  }
  console.log('-- 20 duo deaths --')
  for (const { r, d } of pick(deaths, 20)) console.log(`  ${r.matchId} team ${r.team} ${t(d.tSec)} ${d.role} died, fault=${d.fault} (${d.reason}) attackers ${d.attackers}${d.roam ? ' roam' : ''}${d.after14 ? ' after14' : ''}`)
}
