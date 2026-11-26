/**
 * Phase 5 check: do the distributions of the bilan indicators justify an assistant rule ("at least 1 losing roam in 3 of the last
 * 5 games", "at least 2 losing ganks in 3 of 5")? Read-only, on a COPY of the MatchCache.
 * Usage: npx tsx scripts/calibrate-assistant-bilans.ts <copy of nexusmind.db>
 */
import { cachedCurrentGames } from './lib/cacheReadOnly'
import { analyzeGame } from '../src/lib/microReview/anomalyDetector'
import { bilanOf } from '../src/lib/microReview/bilanSummary'

const path = process.argv[2]
if (!path) throw new Error('usage')
const byRole = new Map<string, Array<{ roamsPaid: number; roams: number; ganksPaid: number; ganks: number }>>()
for (const g of cachedCurrentGames(path)) {
  for (const p of g.match.info.participants) {
    const a = analyzeGame(g.match, g.timeline, { puuids: [p.puuid] })
    const b = bilanOf(a)
    if (!b) continue
    const k = p.teamPosition || '?'
    byRole.set(k, [...(byRole.get(k) ?? []), { roamsPaid: b.roamsPaid, roams: b.roams, ganksPaid: b.ganksPaid, ganks: b.ganks }])
  }
}
/** P(at least 3 of 5 games satisfy a condition of probability p), games independent. */
const atLeast3of5 = (p: number) => { let s = 0; const c = [1, 5, 10, 10, 5, 1]; for (let k = 3; k <= 5; k++) s += c[k] * p ** k * (1 - p) ** (5 - k); return s }
for (const [role, rows] of [...byRole.entries()].sort()) {
  const n = rows.length
  const p1 = rows.filter((r) => r.roamsPaid >= 1).length / n
  const pG = rows.filter((r) => r.ganksPaid >= 2).length / n
  const pG1 = rows.filter((r) => r.ganksPaid >= 1).length / n
  console.log(`${role}: ${n} games; roams ${(rows.reduce((s, r) => s + r.roams, 0) / n).toFixed(1)}/game, losing roam in ${(100 * p1).toFixed(1)} % of games -> "3 of 5 games" would fire on ${(100 * atLeast3of5(p1)).toFixed(1)} % of 5-game windows` +
    (role === 'JUNGLE' ? `; ganks ${(rows.reduce((s, r) => s + r.ganks, 0) / n).toFixed(1)}/game, 1+ losing gank in ${(100 * pG1).toFixed(1)} %, 2+ in ${(100 * pG).toFixed(1)} % -> "2+ in 3 of 5" fires on ${(100 * atLeast3of5(pG)).toFixed(1)} %` : ''))
}
