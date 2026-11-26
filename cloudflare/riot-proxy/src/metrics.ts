/**
 * P1-10 (docs/prod/PLAN_CLE_PROD.md): what the proxy measures, per endpoint. These numbers back the request for a
 * production key: calls made, calls Riot actually received, cache hit rate, and 429s (ours and Riot's).
 *
 * Each request writes one data point to Workers Analytics Engine when the METRICS binding exists (queried with
 * SQL, see wrangler.toml), and one JSON log line in every case (wrangler tail, Workers Logs). Nothing personal:
 * the endpoint is the fixed label of its route (routing.ts), never a puuid, Riot ID, match id or user id.
 */

export type Outcome =
  | 'cache_hit' // served from the shared store, Riot not called
  | 'upstream' // Riot called (any status)
  | 'proxy_limited' // global budget full: 429 from the proxy, Riot not called
  | 'user_limited' // this user's own limit: 429 from the proxy
  | 'riot_key_rejected' // Riot refused the key (401/403)
  | 'upstream_error' // Riot unreachable
  | 'budget_unreachable' // the global budget could not be asked: a background call gets 503
  | 'r2_guard_stopped' // the R2 cost guard refused a read or write: Riot is called directly (status 0)

export interface MetricPoint {
  endpoint: string
  host: string
  outcome: Outcome
  priority: 'interactive' | 'background'
  status: number
  ms: number
}

export interface AnalyticsDataset {
  writeDataPoint(point: { blobs?: string[]; doubles?: number[]; indexes?: string[] }): void
}

export function recordMetric(dataset: AnalyticsDataset | undefined, m: MetricPoint, log: (line: string) => void = console.log): void {
  log(JSON.stringify({ metric: 'riot_proxy', ...m }))
  try {
    // blob1..4 = endpoint, host, outcome, priority; double1..3 = status, ms, count (for SUM).
    dataset?.writeDataPoint({ blobs: [m.endpoint, m.host, m.outcome, m.priority], doubles: [m.status, m.ms, 1], indexes: [m.endpoint] })
  } catch {
    // Measuring must never break a request.
  }
}
