/**
 * Phase 4 check (docs/PLAN_MOTEUR_BILANS.md): (1) can a simple model estimate the real end of a role quest to ~45 s from what the
 * timeline shows at 10:00 ? (2) does the quest gap with the direct opponent explain wins beyond the lane numbers ?
 * Read-only, on a COPY of the MatchCache. Usage: npx tsx scripts/validate-role-quest.ts <copy of nexusmind.db>
 */
import { cachedCurrentGames } from './lib/cacheReadOnly'
import { questCompletion, questGap } from '../src/lib/microReview/roleQuest'
import { buildLedgerTrack } from '../src/lib/microReview/ledgerCore'

const path = process.argv[2]
if (!path) throw new Error('usage')
const games: any[] = []
for (const g of cachedCurrentGames(path)) games.push(g)

/** Ordinary least squares y = Xb (X with an intercept column), by the normal equations. */
function ols(X: number[][], y: number[]): number[] {
  const k = X[0].length
  const A = Array.from({ length: k }, () => new Array(k + 1).fill(0))
  for (let n = 0; n < X.length; n++) for (let i = 0; i < k; i++) { for (let j = 0; j < k; j++) A[i][j] += X[n][i] * X[n][j]; A[i][k] += X[n][i] * y[n] }
  for (let i = 0; i < k; i++) {
    let p = i
    for (let r = i + 1; r < k; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r
    ;[A[i], A[p]] = [A[p], A[i]]
    for (let r = 0; r < k; r++) if (r !== i) { const f = A[r][i] / A[i][i]; for (let c = i; c <= k; c++) A[r][c] -= f * A[i][c] }
  }
  return A.map((row, i) => row[k] / row[i])
}
const med = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN }
const q = (v: number[], f: number) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * f))] : NaN }
const corr = (a: number[], b: number[]) => { const n = a.length, ma = a.reduce((x, y) => x + y, 0) / n, mb = b.reduce((x, y) => x + y, 0) / n; let sab = 0, saa = 0, sbb = 0; for (let i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2 } return sab / Math.sqrt(saa * sbb) }

for (const role of ['TOP', 'MIDDLE', 'BOTTOM', 'UTILITY', 'JUNGLE']) {
  const X: number[][] = [], y: number[] = []
  const pairs: { gap: number; win: number; csDiff: number; xpDiff: number; goldDiff: number }[] = []
  let total = 0, done = 0
  for (const g of games) {
    const tr = buildLedgerTrack(g.match, g.timeline)
    if (!tr) continue
    for (const p of tr.parts.filter((x) => tr.positionOf(x) === role)) {
      total++
      const id = p.participantId
      const end = questCompletion(g.match, g.timeline, id)
      if (!end) continue
      done++
      const takedowns = tr.kills.filter((e) => e.timestamp <= 600000 && tr.involves(e, id)).length
      const plates = tr.events.filter((e) => e.type === 'TURRET_PLATE_DESTROYED' && e.killerId === id && e.timestamp <= 600000).length
      X.push([1, tr.csOf(10, id) + (role === 'JUNGLE' ? 0 : 0), takedowns, plates, tr.xpOf(10, id)])
      y.push(end.endSec)
      const gap = questGap(g.match, g.timeline, id)
      const opp = tr.parts.find((x) => x.teamId !== p.teamId && tr.positionOf(x) === role)
      if (gap && opp && tr.clock.last >= 10) pairs.push({ gap: gap.gapSec, win: p.win ? 1 : 0, csDiff: tr.csOf(10, id) - tr.csOf(10, opp.participantId), xpDiff: tr.xpOf(10, id) - tr.xpOf(10, opp.participantId), goldDiff: tr.goldOf(10, id) - tr.goldOf(10, opp.participantId) })
    }
  }
  if (X.length < 30) { console.log(`${role}: ${done}/${total} quests ended, too few`); continue }
  const b = ols(X, y)
  const err = X.map((row, i) => Math.abs(row.reduce((s, v, j) => s + v * b[j], 0) - y[i]))
  const base = y.map((v) => Math.abs(v - med(y)))
  // Gap and win, controlling the lane numbers (partial correlation by residuals on csDiff, xpDiff, goldDiff).
  const Z = pairs.map((p) => [1, p.csDiff, p.xpDiff, p.goldDiff])
  const resid = (t: number[]) => { const c = ols(Z, t); return t.map((v, i) => v - Z[i].reduce((s, z, j) => s + z * c[j], 0)) }
  const pc = pairs.length > 30 ? corr(resid(pairs.map((p) => p.gap)), resid(pairs.map((p) => p.win))) : NaN
  console.log(`${role}: quests ended ${done}/${total} (${(100 * done / total).toFixed(0)} %); real end median ${med(y)} s; model (CS, takedowns, plates, XP at 10:00) abs error median ${med(err).toFixed(0)} s, p80 ${q(err, 0.8).toFixed(0)} s (constant guess: median ${med(base).toFixed(0)} s); share within 45 s: ${(100 * err.filter((e) => e <= 45).length / err.length).toFixed(0)} % (constant ${(100 * base.filter((e) => e <= 45).length / base.length).toFixed(0)} %)`)
  console.log(`   gap with the opponent: n=${pairs.length}, median ${med(pairs.map((p) => p.gap))} s, |gap| median ${med(pairs.map((p) => Math.abs(p.gap)))} s; corr(gap, win) ${corr(pairs.map((p) => p.gap), pairs.map((p) => p.win)).toFixed(3)}, partial corr given CS / XP / gold gaps at 10:00 ${pc.toFixed(3)}`)
}
