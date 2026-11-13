/**
 * Assistant — A4 per-player rule weights from 👍/👎 feedback.
 *
 * Each rule gets a Beta(α, β) posterior on "this kind of advice helps me":
 * α = prior + 👍, β = prior + 👎. The report ranks with the posterior mean:
 * deterministic and monotone (a 👍 never pushes an insight down). Passing a
 * seeded RNG switches to Thompson sampling for exploration — kept available,
 * but not used by default because random re-ordering hurts explainability.
 * A rule with no vote keeps a neutral weight of 1. The multiplier is bounded
 * (0.4–1.6): feedback re-orders advice, it never fully silences a rule;
 * wellbeing rules (`fixedWeight`) are not re-weighted at all.
 */

export interface RuleVotes {
  up: number
  down: number
}

export const PRIOR = { alpha: 2, beta: 2 }
export const MIN_MULTIPLIER = 0.4
export const MAX_MULTIPLIER = 1.6

/** Deterministic PRNG (mulberry32) seeded from a string. */
export function seededRng(seed: string): () => number {
  let h = 1779033703 ^ seed.length
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  let a = h >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Standard normal via Box–Muller. */
function normal(rng: () => number): number {
  const u = Math.max(rng(), 1e-12)
  const v = rng()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

/** Gamma(k, 1) sample — Marsaglia & Tsang. */
export function sampleGamma(k: number, rng: () => number): number {
  if (k < 1) return sampleGamma(k + 1, rng) * Math.pow(Math.max(rng(), 1e-12), 1 / k)
  const d = k - 1 / 3
  const c = 1 / Math.sqrt(9 * d)
  for (;;) {
    let x: number
    let v: number
    do {
      x = normal(rng)
      v = 1 + c * x
    } while (v <= 0)
    v = v * v * v
    const u = rng()
    if (u < 1 - 0.0331 * x ** 4) return d * v
    if (Math.log(Math.max(u, 1e-12)) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v
  }
}

export function sampleBeta(alpha: number, beta: number, rng: () => number): number {
  const x = sampleGamma(alpha, rng)
  const y = sampleGamma(beta, rng)
  return x / (x + y)
}

export function posterior(votes: RuleVotes | undefined): { alpha: number; beta: number } {
  return { alpha: PRIOR.alpha + (votes?.up ?? 0), beta: PRIOR.beta + (votes?.down ?? 0) }
}

export function posteriorMean(votes: RuleVotes | undefined): number {
  const { alpha, beta } = posterior(votes)
  return alpha / (alpha + beta)
}

/**
 * Weight multiplier for a rule. With an RNG: Thompson sample; without: the
 * posterior mean. Maps p ∈ [0, 1] → [MIN, MAX] (p = 0.5, no feedback → 1).
 */
export function ruleMultiplier(votes: RuleVotes | undefined, rng?: () => number): number {
  // No feedback yet → neutral weight: a new player gets the plain priority order.
  if (!votes || votes.up + votes.down === 0) return 1
  const { alpha, beta } = posterior(votes)
  const p = rng ? sampleBeta(alpha, beta, rng) : alpha / (alpha + beta)
  return MIN_MULTIPLIER + (MAX_MULTIPLIER - MIN_MULTIPLIER) * p
}

/** Aggregates raw votes (+1 / -1) into per-rule counts. */
export function tallyVotes(rows: Array<{ ruleId: string; vote: number }>): Record<string, RuleVotes> {
  const out: Record<string, RuleVotes> = {}
  for (const r of rows) {
    const t = (out[r.ruleId] ??= { up: 0, down: 0 })
    if (r.vote > 0) t.up++
    else if (r.vote < 0) t.down++
  }
  return out
}
