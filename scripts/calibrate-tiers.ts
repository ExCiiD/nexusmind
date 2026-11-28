/**
 * Calibration of the mistake tiers (docs/moteur/engine-reports/2026-11-28-tiers-erreurs.md § 6), read-only, on a COPY of the
 * MatchCache. Nothing is sent to Riot.
 * Usage: npx tsx scripts/calibrate-tiers.ts <copy of nexusmind.db> [--list] [--limit=N]
 * Every cached 16.x game, the 10 players, the auto-detected mistakes (rules M* + deaths).
 */
import { cachedCurrentGames } from './lib/cacheReadOnly'
import { detectMistakes, type MistakeCandidate } from '../electron/main/mistakeDetector'
import { TIER_SPEC, computeTiers, countTiers, fatalThreshold, criticalThreshold, type MistakeTier, type TierResult, type TierSpec } from '../src/lib/microReview/mistakeTiers'
import { buildLedgerTrack } from '../src/lib/microReview/ledgerCore'

const path = process.argv[2]
if (!path) throw new Error('usage: calibrate-tiers.ts <db copy> [--list] [--limit=N]')
const list = process.argv.includes('--list')
const limit = Number(process.argv.find((a) => a.startsWith('--limit='))?.slice(8)) || Infinity

interface Row { matchId: string; pid: number; role: string; champion: string; win: boolean; durationSec: number; cands: Array<MistakeCandidate & { key: string }>; game: any }
const rows: Row[] = []
for (const g of cachedCurrentGames(path, limit)) {
  const tr = buildLedgerTrack(g.match, g.timeline)
  if (!tr) continue
  for (const p of g.match.info.participants) {
    if (!p.puuid) continue
    const cands = detectMistakes(g.timeline, g.match, { puuids: [p.puuid] }).map((c, i) => ({ ...c, key: `${p.participantId}:${i}` }))
    rows.push({ matchId: g.matchId, pid: p.participantId, role: p.teamPosition || p.individualPosition || '?', champion: p.championName, win: !!p.win, durationSec: g.match.info.gameDuration, cands, game: g })
  }
}
console.log(`games 16.x with timeline: ${new Set(rows.map((r) => r.matchId)).size}, player-games: ${rows.length}, auto mistakes: ${rows.reduce((s, r) => s + r.cands.length, 0)}`)

const pct = (a: number, b: number) => (b ? `${(100 * a / b).toFixed(1)} %` : 'n/a')
const TIERS: MistakeTier[] = ['fatal', 'critical', 'medium', 'trivial']
const bucket = (sec: number) => (sec < 600 ? '0-10' : sec < 1200 ? '10-20' : sec < 1800 ? '20-30' : '30+')

function run(spec: TierSpec) {
  const t0 = performance.now()
  const res: Array<{ r: Row; c: MistakeCandidate & { key: string }; t: TierResult }> = []
  const perGame: Array<{ r: Row; results: TierResult[] }> = []
  for (const r of rows) {
    const out = computeTiers(r.game.match, r.game.timeline, r.pid, r.cands.map((c) => ({ key: c.key, tagSlug: c.tagSlug, tSec: c.gameTimeSec, autoDetected: true })), spec)
    if (!out) continue
    const results: TierResult[] = []
    for (const c of r.cands) { const t = out.get(c.key); if (t) { res.push({ r, c, t }); results.push(t) } }
    perGame.push({ r, results })
  }
  return { res, perGame, ms: performance.now() - t0 }
}

function report(label: string, spec: TierSpec, verbose: boolean) {
  const { res, perGame, ms } = run(spec)
  const total = res.length
  const counts = countTiers(res.map((x) => x.t))
  console.log(`\n===== ${label} =====`)
  console.log(`mistakes ${total}: ${TIERS.map((t) => `${t} ${counts[t]} (${pct(counts[t], total)})`).join(', ')}   [target: fatal 5-10 %, critical 20-30 %, medium 45-60 %, trivial 10-20 %]`)
  console.log(`compute ${(ms / Math.max(1, rows.length)).toFixed(2)} ms per player-game (target < 2 ms per analysis)`)
  const fatalGames = perGame.filter((g) => g.results.some((t) => t.tier === 'fatal'))
  const critGames = perGame.filter((g) => !g.results.some((t) => t.tier === 'fatal') && g.results.some((t) => t.tier === 'critical'))
  const none = perGame.filter((g) => !g.results.some((t) => t.tier === 'fatal' || t.tier === 'critical'))
  const wr = (xs: typeof perGame) => `${pct(xs.filter((g) => g.r.win).length, xs.length)} (n=${xs.length})`
  console.log(`win rate: with a fatal ${wr(fatalGames)} [target <= 30 %] | critical only ${wr(critGames)} [35-45 %] | neither ${wr(none)} [~55 %]`)
  if (!verbose) return
  const byRole = new Map<string, Record<string, number>>()
  for (const x of res) { const k = x.r.role; const m = byRole.get(k) ?? {}; m[x.t.tier] = (m[x.t.tier] ?? 0) + 1; byRole.set(k, m) }
  for (const [role, m] of [...byRole.entries()].sort()) console.log(`  ${role.padEnd(8)} ${TIERS.map((t) => `${t} ${pct(m[t] ?? 0, Object.values(m).reduce((s, v) => s + v, 0))}`).join(', ')}`)
  const byTime = new Map<string, Record<string, number>>()
  for (const x of res) { const k = bucket(x.c.gameTimeSec); const m = byTime.get(k) ?? {}; m[x.t.tier] = (m[x.t.tier] ?? 0) + 1; byTime.set(k, m) }
  for (const [b, m] of [...byTime.entries()].sort()) console.log(`  min ${b.padEnd(6)} ${TIERS.map((t) => `${t} ${pct(m[t] ?? 0, Object.values(m).reduce((s, v) => s + v, 0))}`).join(', ')}`)
  const byTag = new Map<string, Record<string, number>>()
  for (const x of res) { const m = byTag.get(x.c.tagSlug) ?? {}; m[x.t.tier] = (m[x.t.tier] ?? 0) + 1; byTag.set(x.c.tagSlug, m) }
  console.log('  by tag:', [...byTag.entries()].map(([k, m]) => `${k}: ${TIERS.map((t) => m[t] ?? 0).join('/')}`).join(' | '), '(fatal/critical/medium/trivial)')
  const reasons = new Map<string, number>()
  for (const x of res) if (x.t.reason) reasons.set(`${x.t.tier}:${x.t.reason.kind}`, (reasons.get(`${x.t.tier}:${x.t.reason.kind}`) ?? 0) + 1)
  console.log('  reasons:', [...reasons.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(', '))
  const chain = res.filter((x) => (x.c.tagSlug === 'late-back' || x.c.tagSlug === 'unused-gold'))
  const promoted = chain.filter((x) => x.t.chainRole === 'cause')
  console.log(`  chain: ${promoted.length} of ${chain.length} late-back / unused-gold promoted (${pct(promoted.length, chain.length)}) [target < 15 % of late-backs]`)
  const lb = chain.filter((x) => x.c.tagSlug === 'late-back')
  console.log(`  late-back promoted ${pct(lb.filter((x) => x.t.chainRole === 'cause').length, lb.length)} (n=${lb.length})`)
  console.log('  thresholds: ' + [300, 600, 900, 1200, 1500, 1800, 2100].map((s) => `${s / 60}:00 → ${Math.round(fatalThreshold(s, spec))} / ${Math.round(criticalThreshold(s, spec))}`).join(', '))
  if (list) {
    const pick = <T,>(xs: T[], n: number): T[] => { const step = Math.max(1, Math.floor(xs.length / n)); return xs.filter((_, i) => i % step === 0).slice(0, n) }
    const t = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
    for (const tier of ['fatal', 'critical'] as const) {
      console.log(`-- 20 ${tier} (gameId, player, time) --`)
      for (const x of pick(res.filter((y) => y.t.tier === tier), 20)) console.log(`  ${x.r.matchId} p${x.r.pid} ${x.r.role} ${x.r.champion} ${x.r.win ? 'WIN ' : 'LOSS'} ${t(x.c.gameTimeSec)} ${x.c.tagSlug} | ${x.t.reason?.kind} ${x.t.reason?.gold}g/${x.t.reason?.minutes ?? '-'}min ${x.t.reason?.parts ? JSON.stringify(x.t.reason.parts) : ''}`)
    }
  }
}

report('BASE (spec of the report)', TIER_SPEC as TierSpec, true)

console.log('\n########## Sensitivity (report § 6.3) ##########')
const scale = (k: number): TierSpec => ({ ...TIER_SPEC, fatal: { ...TIER_SPEC.fatal, early: TIER_SPEC.fatal.early * k, mid: TIER_SPEC.fatal.mid * k, late: TIER_SPEC.fatal.late * k } }) as TierSpec
for (const k of [0.78, 1, 1.22]) report(`T_fatal at 15:00 = ${Math.round(1150 * k)} (x${k})`, scale(k), false)
for (const s of [0.6, 0.71, 0.85]) report(`critical = ${s} x fatal`, { ...TIER_SPEC, criticalShare: s } as TierSpec, false)
for (const w of [0.3, 0.4, 0.53]) report(`XP weight ${w}`, { ...TIER_SPEC, xpWeight: w } as TierSpec, false)
for (const from of [600, 900, 1200, 1500]) report(`garbage time judged from ${from / 60}:00`, { ...TIER_SPEC, garbage: { ...TIER_SPEC.garbage, fromSec: from } } as TierSpec, false)
for (const steps of [2, 3]) report(`snowball over ${steps} snapshots`, { ...TIER_SPEC, snowball: { ...TIER_SPEC.snowball, steps } } as TierSpec, false)
