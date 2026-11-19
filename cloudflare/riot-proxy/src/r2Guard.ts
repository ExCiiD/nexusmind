/**
 * Cost guard of the shared match store (R2), asked by the user on 19/11/2026: at most €2 a month above the free
 * tier, whatever happens. On the Workers free plan nothing else of the proxy can cost money (requests, the Durable
 * Object and Analytics Engine are refused at their limits, not billed). R2 is billed beyond its free tier, so the
 * proxy counts its own R2 use and stops using R2 (back to Riot directly) before the estimated extra cost reaches the
 * budget, until the next month.
 *
 * Prices and free tier: developers.cloudflare.com/r2/pricing (read 19/11/2026), R2 Standard.
 *   storage $0.015 per GB-month (10 GB-month free) · Class A (PutObject) $4.50 per million (1 M free)
 *   Class B (GetObject) $0.36 per million (10 M free) · egress through the Workers API free · DeleteObject free.
 *
 * The estimate is pessimistic on purpose: every read counts (a miss too), and everything written in the last
 * LIFECYCLE_DAYS days counts as stored for the whole month (the lifecycle rule deletes objects after that).
 * Pure: the Durable Object (budgetObject.ts) keeps the counters.
 */

export const R2_FREE = { storageGB: 10, classA: 1_000_000, classB: 10_000_000 } as const
export const R2_PRICE_USD = { storagePerGBMonth: 0.015, classAPerMillion: 4.5, classBPerMillion: 0.36 } as const
/** Objects expire after 90 days (bucket lifecycle rule). */
export const LIFECYCLE_DAYS = 90
/** €2 at about 1.08 USD per euro is 2.16 USD: 2 USD keeps a margin. */
export const DEFAULT_EXTRA_BUDGET_USD = 2

export interface R2Usage {
  /** "2026-11": Class A / B operations reset each month. */
  month: string
  classA: number
  classB: number
  /** Bytes written per day ("2026-11-19"), kept LIFECYCLE_DAYS days. */
  bytesByDay: Record<string, number>
}

export type R2Op = 'read' | 'write'

const dayOf = (now: number) => new Date(now).toISOString().slice(0, 10)
const monthOf = (now: number) => new Date(now).toISOString().slice(0, 7)

export function emptyUsage(now: number): R2Usage {
  return { month: monthOf(now), classA: 0, classB: 0, bytesByDay: {} }
}

/** The counters of this month, older days dropped. */
export function currentUsage(u: R2Usage | null | undefined, now: number): R2Usage {
  const base = u && typeof u === 'object' ? u : emptyUsage(now)
  const cutoff = dayOf(now - LIFECYCLE_DAYS * 86_400_000)
  const bytesByDay: Record<string, number> = {}
  for (const [day, bytes] of Object.entries(base.bytesByDay ?? {})) if (day > cutoff && Number.isFinite(bytes)) bytesByDay[day] = bytes
  return base.month === monthOf(now)
    ? { month: base.month, classA: base.classA || 0, classB: base.classB || 0, bytesByDay }
    : { month: monthOf(now), classA: 0, classB: 0, bytesByDay }
}

export function storedGB(u: R2Usage): number {
  return Object.values(u.bytesByDay).reduce((s, b) => s + b, 0) / 1e9
}

/** Estimated cost above the free tier this month (USD). */
export function extraCostUSD(u: R2Usage): number {
  const storage = Math.max(0, storedGB(u) - R2_FREE.storageGB) * R2_PRICE_USD.storagePerGBMonth
  const a = (Math.max(0, u.classA - R2_FREE.classA) / 1e6) * R2_PRICE_USD.classAPerMillion
  const b = (Math.max(0, u.classB - R2_FREE.classB) / 1e6) * R2_PRICE_USD.classBPerMillion
  return storage + a + b
}

/** Share of the free tier used, the highest of the three (1 = free tier used up). */
export function freeTierShare(u: R2Usage): number {
  return Math.max(storedGB(u) / R2_FREE.storageGB, u.classA / R2_FREE.classA, u.classB / R2_FREE.classB)
}

/**
 * Whether one more R2 operation may run, and the counters after it. Refused when, with it, the estimated extra
 * cost would reach the budget: the operation is then not counted (the caller does not run it).
 */
export function decideR2(u: R2Usage | null | undefined, op: R2Op, bytes: number, budgetUSD: number, now: number): { allow: boolean; usage: R2Usage; extraUSD: number } {
  const usage = currentUsage(u, now)
  const next: R2Usage = {
    ...usage,
    classA: usage.classA + (op === 'write' ? 1 : 0),
    classB: usage.classB + (op === 'read' ? 1 : 0),
    bytesByDay: op === 'write'
      ? { ...usage.bytesByDay, [dayOf(now)]: (usage.bytesByDay[dayOf(now)] ?? 0) + Math.max(0, bytes) }
      : usage.bytesByDay,
  }
  const extra = extraCostUSD(next)
  if (extra >= budgetUSD) return { allow: false, usage, extraUSD: extraCostUSD(usage) }
  return { allow: true, usage: next, extraUSD: extra }
}

/** R2_EXTRA_BUDGET_USD as a number in [0, 50], else the default. */
export function parseBudgetUSD(raw: string | undefined | null): number {
  const n = Number(raw)
  return raw != null && raw !== '' && Number.isFinite(n) && n >= 0 && n <= 50 ? n : DEFAULT_EXTRA_BUDGET_USD
}
