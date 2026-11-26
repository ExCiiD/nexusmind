/**
 * Calibration of the mid roam ledger (docs/PLAN_MOTEUR_BILANS.md § 3), read-only, on a COPY of the MatchCache.
 * Usage: npx tsx scripts/calibrate-roam-mid.ts <copy of nexusmind.db> [--list]
 * Every mid laner of every cached 16.x game is read (both teams: the verdict is about the roam, not about who owns the app).
 */
import { cachedCurrentGames } from './lib/cacheReadOnly'
import { ROAM_THRESHOLDS, roamLedger, type RoamEntry, type RoamThresholds, type RoamVerdict } from '../src/lib/microReview/roamLedger'
import { buildLedgerTrack } from '../src/lib/microReview/ledgerCore'

const path = process.argv[2]
if (!path) throw new Error('usage: calibrate-roam-mid.ts <db copy>')
const listLosers = process.argv.includes('--list')

interface Row { matchId: string; pid: number; win: boolean; champion: string; patch: string; entries: RoamEntry[] }
const games: any[] = []
for (const g of cachedCurrentGames(path)) games.push(g)
console.log(`games 16.x in the copy: ${games.length}`)

// ── minionGold: Δgold ≈ c + m × ΔCS on mid minutes 2-10 where the player had no takedown, plate or objective ──
{
  const xs: number[] = [], ys: number[] = []
  for (const g of games) {
    const tr = buildLedgerTrack(g.match, g.timeline)
    if (!tr) continue
    for (const p of tr.parts.filter((x) => tr.positionOf(x) === 'MIDDLE')) {
      for (let k = 2; k < Math.min(10, tr.clock.last); k++) {
        const busy = tr.events.some((e) => e.timestamp > k * 60000 && e.timestamp <= (k + 1) * 60000 && (e.killerId === p.participantId || (e.assistingParticipantIds ?? []).includes(p.participantId)))
        if (busy) continue
        xs.push(tr.csOf(k + 1, p.participantId) - tr.csOf(k, p.participantId))
        ys.push(tr.goldOf(k + 1, p.participantId) - tr.goldOf(k, p.participantId))
      }
    }
  }
  const n = xs.length, mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n
  const m = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) / xs.reduce((s, x) => s + (x - mx) ** 2, 0)
  console.log(`minionGold regression on ${n} mid minutes: ${m.toFixed(1)} g per CS, intercept ${(my - m * mx).toFixed(0)} g/min`)
}

function run(spec: RoamThresholds): Row[] {
  const rows: Row[] = []
  for (const g of games) {
    const tr = buildLedgerTrack(g.match, g.timeline)
    if (!tr) continue
    for (const p of tr.parts.filter((x) => tr.positionOf(x) === 'MIDDLE')) {
      const l = roamLedger(g.match, g.timeline, p.participantId, spec, tr)
      if (!l) continue
      rows.push({ matchId: g.matchId, pid: p.participantId, win: !!p.win, champion: p.championName, patch: String(g.match.info.gameVersion).split('.').slice(0, 2).join('.'), entries: l.entries })
    }
  }
  return rows
}
const pct = (a: number, b: number) => (b ? (100 * a / b).toFixed(1) + ' %' : 'n/a')
const q = (v: number[], f: number) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * f))] : NaN }

function report(rows: Row[], label: string) {
  const all = rows.flatMap((r) => r.entries.map((e) => ({ r, e })))
  const by = (v: RoamVerdict) => all.filter((x) => x.e.verdict === v)
  console.log(`\n== ${label} ==`)
  console.log(`player-games ${rows.length}, roams ${all.length} (${(100 * all.length / rows.length).toFixed(0)} per 100 player-games): profitable ${by('profitable').length}, neutral ${by('neutral').length}, losing ${by('losing').length}`)
  console.log(`   per 100 player-games: profitable ${(100 * by('profitable').length / rows.length).toFixed(1)}, neutral ${(100 * by('neutral').length / rows.length).toFixed(1)}, losing ${(100 * by('losing').length / rows.length).toFixed(1)}`)
  const nets = all.map((x) => x.e.net)
  console.log(`   net: p5 ${q(nets, 0.05)} p25 ${q(nets, 0.25)} median ${q(nets, 0.5)} p75 ${q(nets, 0.75)} p95 ${q(nets, 0.95)}`)
  console.log(`   shortProof ${all.filter((x) => x.e.shortProof).length}, reset ${all.filter((x) => x.e.reset).length}, crossed ${all.filter((x) => x.e.crossed).length}, died ${all.filter((x) => x.e.died).length}, freezeLikely ${all.filter((x) => x.e.freezeLikely).length}, unmeasured ${all.filter((x) => !x.e.costMeasured).length}`)
  // Win rate per player-game, by its worst / best verdict.
  const cls = (r: Row) => (r.entries.some((e) => e.verdict === 'losing') ? 'has-losing' : r.entries.some((e) => e.verdict === 'profitable') ? 'profitable-only' : r.entries.length ? 'neutral-only' : 'no-roam')
  const groups = new Map<string, Row[]>()
  for (const r of rows) groups.set(cls(r), [...(groups.get(cls(r)) ?? []), r])
  for (const k of ['no-roam', 'neutral-only', 'profitable-only', 'has-losing']) {
    const g = groups.get(k) ?? []
    console.log(`   ${k}: ${g.length} player-games, win rate ${pct(g.filter((x) => x.win).length, g.length)}`)
  }
  // Per roam: the win rate of the game each verdict sits in.
  for (const v of ['profitable', 'neutral', 'losing'] as RoamVerdict[]) console.log(`   roams ${v}: win rate of their games ${pct(by(v).filter((x) => x.r.win).length, by(v).length)}`)
  // Per-patch counts of losing roams (the patch steps 16.9 / 16.16).
  const tiers = new Map<string, { n: number; losing: number }>()
  for (const r of rows) { const t = Number(r.patch.split('.')[1]) >= 16 ? '16.16+' : Number(r.patch.split('.')[1]) >= 9 ? '16.9-16.15' : '<16.9'; const c = tiers.get(t) ?? { n: 0, losing: 0 }; c.n++; c.losing += r.entries.filter((e) => e.verdict === 'losing').length; tiers.set(t, c) }
  console.log('   losing roams per 100 player-games by patch step:', [...tiers.entries()].map(([k, v]) => `${k}: ${(100 * v.losing / v.n).toFixed(1)} (n=${v.n})`).join(', '))
}

const base = ROAM_THRESHOLDS as RoamThresholds
const baseRows = run(base)
report(baseRows, `thresholds as committed (netThreshold ${base.netThreshold}, minCsLost ${base.minCsLost}, followUp ${base.followUpSec}s)`)

console.log('\n== sweep: netThreshold ==')
for (const s of [0.05, 0.1, 0.15, 0.2, 0.3, 0.4]) {
  const rows = run({ ...base, netThreshold: s })
  const all = rows.flatMap((r) => r.entries)
  const losing = rows.filter((r) => r.entries.some((e) => e.verdict === 'losing'))
  const prof = rows.filter((r) => !r.entries.some((e) => e.verdict === 'losing') && r.entries.some((e) => e.verdict === 'profitable'))
  console.log(`  s=${s}: losing roams ${(100 * all.filter((e) => e.verdict === 'losing').length / rows.length).toFixed(1)}/100, games with a losing roam: win ${pct(losing.filter((x) => x.win).length, losing.length)} (n=${losing.length}); profitable-only: win ${pct(prof.filter((x) => x.win).length, prof.length)} (n=${prof.length})`)
}
console.log('\n== sweep: driftShare x netThreshold ==')
for (const d of [0, 0.5, 1]) for (const sThr of [0.15, 0.3, 0.5, 0.75, 1.0, 1.5]) {
  const rows = run({ ...base, driftShare: d, netThreshold: sThr })
  const all = rows.flatMap((r) => r.entries)
  const losing = rows.filter((r) => r.entries.some((e) => e.verdict === 'losing'))
  const prof = rows.filter((r) => !r.entries.some((e) => e.verdict === 'losing') && r.entries.some((e) => e.verdict === 'profitable'))
  const none = rows.filter((r) => !r.entries.some((e) => e.verdict === 'losing'))
  console.log(`  drift=${d} s=${sThr}: losing roams ${(100 * all.filter((e) => e.verdict === 'losing').length / rows.length).toFixed(1)}/100, profitable ${(100 * all.filter((e) => e.verdict === 'profitable').length / rows.length).toFixed(1)}/100; games with a losing roam win ${pct(losing.filter((x) => x.win).length, losing.length)} (n=${losing.length}), without ${pct(none.filter((x) => x.win).length, none.length)}, profitable-only ${pct(prof.filter((x) => x.win).length, prof.length)}`)
}
console.log('\n== sweep: follow-up duration (s) ==')
for (const f of [120, 180, 240]) {
  const rows = run({ ...base, followUpSec: f })
  const losing = rows.filter((r) => r.entries.some((e) => e.verdict === 'losing'))
  console.log(`  followUp=${f}: games with a losing roam ${losing.length}, win ${pct(losing.filter((x) => x.win).length, losing.length)}`)
}

if (listLosers) {
  const losers = baseRows.flatMap((r) => r.entries.filter((e) => e.verdict === 'losing').map((e) => ({ r, e })))
  // 20 spread over the list, not the first 20.
  const step = Math.max(1, Math.floor(losers.length / 20))
  console.log(`\n== 20 losing roams (every ${step}th of ${losers.length}) ==`)
  for (let i = 0, n = 0; i < losers.length && n < 20; i += step, n++) {
    const { r, e } = losers[i]
    const t = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
    console.log(`${n + 1}. ${r.matchId} p${r.pid} ${r.champion} ${r.win ? 'WIN ' : 'LOSS'} ${t(e.fromSec)}-${t(e.backSec)} ${e.side}${e.shortProof ? ' short' : ''}${e.reset ? ' reset' : ''}${e.crossed ? ' crossed' : ''}${e.died ? ' died' : ''}${e.freezeLikely ? ' freeze' : ''} | cost cs${e.cost.cs} xp${e.cost.xp} plates${e.cost.plates}${e.cost.towerLost ? ' T1' : ''} death${e.cost.deathGold} z${e.cost.z} | gain k${e.gain.kills} a${e.gain.assists} obj[${e.gain.objectives}] lane${e.gain.laneGold}/${e.gain.laneXp} fight${e.gain.fightGold} z${e.gain.z} | follow k${e.followUp.kills} obj[${e.followUp.objectives}] pl${e.followUp.plates}${e.followUp.towerLost ? ' T1' : ''} +cs${e.followUp.extraCs} +xp${e.followUp.extraXp} z${e.followUp.z} | net ${e.net}`)
  }
}
