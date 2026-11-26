/**
 * Calibration of the roam ledger for top, ADC and support (docs/PLAN_MOTEUR_BILANS.md phase 2), read-only, on a COPY of the MatchCache.
 * Usage: npx tsx scripts/calibrate-roam-roles.ts <copy of nexusmind.db> [--list]
 * Every laner of the role in every cached 16.x game (both teams). Also checks the mid is unchanged.
 */
import { cachedCurrentGames } from './lib/cacheReadOnly'
import { ROAM_ROLE_SPEC, ROAM_THRESHOLDS, roamLedger, type RoamEntry, type RoamThresholds, type RoamVerdict } from '../src/lib/microReview/roamLedger'
import { buildLedgerTrack } from '../src/lib/microReview/ledgerCore'

const path = process.argv[2]
if (!path) throw new Error('usage: calibrate-roam-roles.ts <db copy>')
const list = process.argv.includes('--list')
const games: any[] = []
for (const g of cachedCurrentGames(path)) games.push(g)
console.log(`games 16.x: ${games.length}`)

interface Row { matchId: string; pid: number; win: boolean; champion: string; minor: number; entries: RoamEntry[] }
function run(role: string, spec: RoamThresholds): Row[] {
  const rows: Row[] = []
  for (const g of games) {
    const tr = buildLedgerTrack(g.match, g.timeline)
    if (!tr) continue
    for (const p of tr.parts.filter((x) => tr.positionOf(x) === role)) {
      const l = roamLedger(g.match, g.timeline, p.participantId, spec, tr)
      if (!l) continue
      rows.push({ matchId: g.matchId, pid: p.participantId, win: !!p.win, champion: p.championName, minor: Number(String(g.match.info.gameVersion).split('.')[1]), entries: l.entries })
    }
  }
  return rows
}
const pct = (a: number, b: number) => (b ? (100 * a / b).toFixed(1) + ' %' : 'n/a')
const q = (v: number[], f: number) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * f))] : NaN }
const tier = (m: number) => (m >= 16 ? '16.16+' : m >= 9 ? '16.9-16.15' : '<16.9')
const t = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

for (const role of ['TOP', 'BOTTOM', 'UTILITY']) {
  const key = ROAM_ROLE_SPEC[role].netKey
  const base = ROAM_THRESHOLDS as RoamThresholds
  const rows = run(role, base)
  const all = rows.flatMap((r) => r.entries.map((e) => ({ r, e })))
  console.log(`\n===== ${role} (${key} = ${base[key]}) =====`)
  console.log(`player-games ${rows.length}, roams ${all.length} (${(100 * all.length / rows.length).toFixed(0)}/100)`)
  const nets = all.map((x) => x.e.net)
  console.log(`net p5 ${q(nets, 0.05)} p25 ${q(nets, 0.25)} median ${q(nets, 0.5)} p75 ${q(nets, 0.75)} p95 ${q(nets, 0.95)}; died ${all.filter((x) => x.e.died).length}, shortProof ${all.filter((x) => x.e.shortProof).length}, crossed ${all.filter((x) => x.e.crossed).length}, tpLikely ${all.filter((x) => x.e.tpLikely).length}`)
  for (const s of [0.5, 0.75, 1, 1.25, 1.5, 2]) {
    const rr = run(role, { ...base, [key]: s } as RoamThresholds)
    const a = rr.flatMap((r) => r.entries)
    const lose = rr.filter((r) => r.entries.some((e) => e.verdict === 'losing'))
    const none = rr.filter((r) => !r.entries.some((e) => e.verdict === 'losing'))
    console.log(`  s=${s}: losing ${(100 * a.filter((e) => e.verdict === 'losing').length / rr.length).toFixed(1)}/100, profitable ${(100 * a.filter((e) => e.verdict === 'profitable').length / rr.length).toFixed(1)}/100; games with a losing roam win ${pct(lose.filter((x) => x.win).length, lose.length)} (n=${lose.length}) vs ${pct(none.filter((x) => x.win).length, none.length)}`)
  }
  for (const v of ['profitable', 'neutral', 'losing'] as RoamVerdict[]) {
    const x = all.filter((y) => y.e.verdict === v)
    console.log(`  at ${base[key]}: ${v} ${x.length}, win rate of their games ${pct(x.filter((y) => y.r.win).length, x.length)}`)
  }
  const tiers = new Map<string, { n: number; losing: number; roams: number }>()
  for (const r of rows) { const k = tier(r.minor); const c = tiers.get(k) ?? { n: 0, losing: 0, roams: 0 }; c.n++; c.roams += r.entries.length; c.losing += r.entries.filter((e) => e.verdict === 'losing').length; tiers.set(k, c) }
  console.log('  by patch step (roams / losing per 100):', [...tiers.entries()].map(([k, v]) => `${k}: ${(100 * v.roams / v.n).toFixed(0)} / ${(100 * v.losing / v.n).toFixed(1)} (n=${v.n})`).join(', '))
  if (role === 'UTILITY') {
    const timers = new Map<string, { n: number; win: number; losing: number }>()
    for (const { r, e } of all) { const k = e.timer ?? '?'; const c = timers.get(k) ?? { n: 0, win: 0, losing: 0 }; c.n++; c.win += r.win ? 1 : 0; c.losing += e.verdict === 'losing' ? 1 : 0; timers.set(k, c) }
    console.log('  by timer:', [...timers.entries()].map(([k, v]) => `${k}: n=${v.n} win ${pct(v.win, v.n)} losing ${pct(v.losing, v.n)}`).join(' | '))
    const good = all.filter((x) => x.e.goodTimer)
    console.log(`  good timer ${good.length}/${all.length} (${pct(good.length, all.length)}); taxed ${all.filter((x) => x.e.taxed).length}; partner forcedBack ${all.filter((x) => x.e.partner?.forcedBack).length}, partner died ${all.filter((x) => x.e.partner?.died).length}`)
  }
  if (list) {
    const losers = all.filter((x) => x.e.verdict === 'losing')
    const step = Math.max(1, Math.floor(losers.length / 20))
    console.log(`  -- 20 losing roams (every ${step}th of ${losers.length}) --`)
    for (let i = 0, n = 0; i < losers.length && n < 20; i += step, n++) {
      const { r, e } = losers[i]
      console.log(`  ${n + 1}. ${r.matchId} p${r.pid} ${r.champion} ${r.win ? 'WIN ' : 'LOSS'} ${t(e.fromSec)}-${t(e.backSec)} ${e.side}${e.timer ? ' timer=' + e.timer : ''}${e.taxed ? ' taxed' : ''}${e.tpLikely ? ' TP' : ''}${e.died ? ' died' : ''}${e.partner?.forcedBack ? ' adcBack' : ''}${e.partner?.died ? ' partnerDied' : ''} | cost cs${e.cost.cs} xp${e.cost.xp} pl${e.cost.plates} death${e.cost.deathGold} | gain k${e.gain.kills} a${e.gain.assists} obj[${e.gain.objectives}] | follow k${e.followUp.kills} pl${e.followUp.plates} | net ${e.net}`)
    }
  }
}
