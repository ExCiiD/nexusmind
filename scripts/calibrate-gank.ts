/**
 * Calibration of the jungler's gank ledger (docs/PLAN_MOTEUR_BILANS.md phase 3), read-only, on a COPY of the MatchCache.
 * Usage: npx tsx scripts/calibrate-gank.ts <copy of nexusmind.db> [--list]
 * Every jungler of every cached 16.x game (both teams). Also measures the value of a camp without the passive income.
 */
import { cachedCurrentGames } from './lib/cacheReadOnly'
import { GANK_THRESHOLDS, gankLedger, type GankEntry, type GankThresholds, type GankVerdict } from '../src/lib/microReview/gankLedger'
import { buildLedgerTrack } from '../src/lib/microReview/ledgerCore'

const path = process.argv[2]
if (!path) throw new Error('usage: calibrate-gank.ts <db copy>')
const list = process.argv.includes('--list')
const games: any[] = []
for (const g of cachedCurrentGames(path)) games.push(g)
console.log(`games 16.x: ${games.length}`)

// ── Value of a camp: Δgold ≈ c + m × Δjungle CS over farm-only jungler minutes (no takedown, no lane minion) ──
{
  const xs: number[] = [], gs: number[] = [], ps: number[] = []
  for (const g of games) {
    const tr = buildLedgerTrack(g.match, g.timeline)
    if (!tr) continue
    for (const p of tr.parts.filter((x) => tr.positionOf(x) === 'JUNGLE')) {
      const id = p.participantId
      for (let k = 4; k < Math.min(14, tr.clock.last); k++) {
        const busy = tr.events.some((e) => e.timestamp > k * 60000 && e.timestamp <= (k + 1) * 60000 && (e.killerId === id || (e.assistingParticipantIds ?? []).includes(id) || e.victimId === id))
        const lane = (Number(tr.pframe(k + 1, id)?.minionsKilled) || 0) - (Number(tr.pframe(k, id)?.minionsKilled) || 0)
        if (busy || lane > 0) continue
        xs.push((Number(tr.pframe(k + 1, id)?.jungleMinionsKilled) || 0) - (Number(tr.pframe(k, id)?.jungleMinionsKilled) || 0))
        gs.push(tr.goldOf(k + 1, id) - tr.goldOf(k, id))
        ps.push(tr.xpOf(k + 1, id) - tr.xpOf(k, id))
      }
    }
  }
  const fit = (ys: number[]) => {
    const n = xs.length, mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n
    const m = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) / xs.reduce((s, x) => s + (x - mx) ** 2, 0)
    return { m, c: my - m * mx }
  }
  const G = fit(gs), P = fit(ps)
  console.log(`camp value over ${xs.length} farm-only jungler minutes: gold ${(G.m * 4).toFixed(0)} per camp (4 CS), passive ${G.c.toFixed(0)} g/min; XP ${(P.m * 4).toFixed(0)} per camp, base ${P.c.toFixed(0)} XP/min`)
}

interface Row { matchId: string; pid: number; win: boolean; champion: string; minor: number; entries: GankEntry[] }
function run(spec: GankThresholds): Row[] {
  const rows: Row[] = []
  for (const g of games) {
    const tr = buildLedgerTrack(g.match, g.timeline)
    if (!tr) continue
    for (const p of tr.parts.filter((x) => tr.positionOf(x) === 'JUNGLE')) {
      const l = gankLedger(g.match, g.timeline, p.participantId, spec, tr)
      if (!l) continue
      rows.push({ matchId: g.matchId, pid: p.participantId, win: !!p.win, champion: p.championName, minor: Number(String(g.match.info.gameVersion).split('.')[1]), entries: l.entries })
    }
  }
  return rows
}
const pct = (a: number, b: number) => (b ? (100 * a / b).toFixed(1) + ' %' : 'n/a')
const q = (v: number[], f: number) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * f))] : NaN }
const t = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

const base = GANK_THRESHOLDS as GankThresholds
const rows = run(base)
const all = rows.flatMap((r) => r.entries.map((e) => ({ r, e })))
console.log(`\njunglers ${rows.length}, ganks ${all.length} (${(100 * all.length / rows.length).toFixed(0)}/100 jungler-games); proof position ${all.filter((x) => x.e.proof.position).length}, takedown ${all.filter((x) => x.e.proof.takedown).length}, minions only ${all.filter((x) => x.e.proof.minions).length}; died ${all.filter((x) => x.e.died).length}, by lane ${(['TOP', 'MID', 'BOT'] as const).map((l) => `${l} ${all.filter((x) => x.e.lane === l).length}`).join(', ')}`)
const nets = all.map((x) => x.e.net)
console.log(`net p5 ${q(nets, 0.05)} p25 ${q(nets, 0.25)} median ${q(nets, 0.5)} p75 ${q(nets, 0.75)} p95 ${q(nets, 0.95)}; campsLost median ${q(all.map((x) => x.e.campsLost), 0.5)} p90 ${q(all.map((x) => x.e.campsLost), 0.9)}`)
for (const s of [1, 1.5, 2, 2.5, 3, 4]) {
  const rr = run({ ...base, netThreshold: s })
  const a = rr.flatMap((r) => r.entries)
  const lose = rr.filter((r) => r.entries.some((e) => e.verdict === 'losing'))
  const none = rr.filter((r) => !r.entries.some((e) => e.verdict === 'losing'))
  console.log(`  s=${s}: losing ${(100 * a.filter((e) => e.verdict === 'losing').length / rr.length).toFixed(1)}/100, profitable ${(100 * a.filter((e) => e.verdict === 'profitable').length / rr.length).toFixed(1)}/100; games with a losing gank win ${pct(lose.filter((x) => x.win).length, lose.length)} (n=${lose.length}) vs ${pct(none.filter((x) => x.win).length, none.length)}`)
}
for (const v of ['profitable', 'neutral', 'losing'] as GankVerdict[]) {
  const x = all.filter((y) => y.e.verdict === v)
  console.log(`  at ${base.netThreshold}: ${v} ${x.length}, win rate of their games ${pct(x.filter((y) => y.r.win).length, x.length)}`)
}
const timers = new Map<string, { n: number; win: number; losing: number }>()
for (const { r, e } of all) { const c = timers.get(e.timer) ?? { n: 0, win: 0, losing: 0 }; c.n++; c.win += r.win ? 1 : 0; c.losing += e.verdict === 'losing' ? 1 : 0; timers.set(e.timer, c) }
console.log('by timer:', [...timers.entries()].map(([k, v]) => `${k}: n=${v.n} win ${pct(v.win, v.n)} losing ${pct(v.losing, v.n)}`).join(' | '))
const tiers = new Map<string, { n: number; g: number; l: number }>()
for (const r of rows) { const k = r.minor >= 16 ? '16.16+' : r.minor >= 9 ? '16.9-16.15' : '<16.9'; const c = tiers.get(k) ?? { n: 0, g: 0, l: 0 }; c.n++; c.g += r.entries.length; c.l += r.entries.filter((e) => e.verdict === 'losing').length; tiers.set(k, c) }
console.log('by patch step (ganks / losing per 100):', [...tiers.entries()].map(([k, v]) => `${k}: ${(100 * v.g / v.n).toFixed(0)} / ${(100 * v.l / v.n).toFixed(1)} (n=${v.n})`).join(', '))
if (list) {
  const losers = all.filter((x) => x.e.verdict === 'losing')
  const step = Math.max(1, Math.floor(losers.length / 20))
  console.log(`-- 20 losing ganks (every ${step}th of ${losers.length}) --`)
  for (let i = 0, n = 0; i < losers.length && n < 20; i += step, n++) {
    const { r, e } = losers[i]
    console.log(`${n + 1}. ${r.matchId} p${r.pid} ${r.champion} ${r.win ? 'WIN ' : 'LOSS'} ${t(e.fromSec)}-${t(e.backSec)} ${e.lane} timer=${e.timer}${e.died ? ' died' : ''} proof=${e.proof.position ? 'pos' : ''}${e.proof.takedown ? 'ev' : ''}${e.proof.minions ? 'min' : ''} | camps -${e.campsLost} stolen ${e.campsStolen} gap ${e.gap.goldBefore}/${e.gap.xpBefore} -> ${e.gap.goldAfter}/${e.gap.xpAfter} | gain k${e.gain.kills} a${e.gain.assists}${e.gain.forcedBack ? ' forcedBack' : ''} pl${e.gain.plates} obj[${e.gain.objectives}] | follow k${e.followUp.kills} obj[${e.followUp.objectives}] | net ${e.net}`)
  }
}
