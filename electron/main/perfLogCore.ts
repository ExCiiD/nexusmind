/**
 * Pure part of the performance log (AUDIT_PERF_2 gain 0, 20/11/2026): what one line says.
 *
 * No personal data in the log: Riot paths lose their ids (puuid, match id, Riot ID, summoner id), Supabase calls
 * keep only the table or function, never the query string (it holds the filters, ids included).
 */

export type PerfKind = 'ipc' | 'riot' | 'supabase' | 'net'

const LONG_ID = /^[A-Za-z0-9_-]{20,}$/
const MATCH_ID = /^[A-Z0-9]{2,5}_\d+$/

/** The kind of a network call and a label without ids. */
export function labelForUrl(rawUrl: string, method = 'GET'): { kind: PerfKind; label: string } {
  let url: URL
  try { url = new URL(rawUrl) } catch { return { kind: 'net', label: `${method} (invalid url)` } }
  const host = url.hostname
  const segments = url.pathname.split('/').filter(Boolean)

  if (host.endsWith('.supabase.co')) {
    // /rest/v1/<table>, /rest/v1/rpc/<fn>, /auth/v1/<op>, /functions/v1/<fn>, /storage/v1/object/<bucket>/…
    const keep = segments[0] === 'rest' && segments[2] === 'rpc' ? 4 : segments[0] === 'storage' ? 4 : 3
    return { kind: 'supabase', label: `${method} /${segments.slice(0, keep).join('/')}` }
  }

  const isRiot = host.endsWith('api.riotgames.com') || host.includes('riot-proxy')
  if (!isRiot) return { kind: 'net', label: `${method} ${host}` }

  const out: string[] = []
  for (let i = 0; i < segments.length; i++) {
    // A malformed % escape throws: the raw segment is kept, the request itself must never fail because of the log.
    let seg = segments[i]
    try { seg = decodeURIComponent(seg) } catch { /* keep the raw segment */ }
    const prev = segments[i - 1]
    if (prev === 'by-riot-id') { out.push(':name', ':tag'); i++; continue }
    if (MATCH_ID.test(seg)) out.push(':match')
    else if (LONG_ID.test(seg) || prev === 'by-puuid' || prev === 'by-summoner') out.push(':id')
    else out.push(seg)
  }
  // Through the proxy the first segment is the Riot host; directly, it is the subdomain.
  const riotHost = host.endsWith('api.riotgames.com') ? host.split('.')[0] : ''
  return { kind: 'riot', label: `${method} ${riotHost ? `${riotHost}/` : ''}${out.join('/')}` }
}

/** One tab-separated line: time, kind, label, milliseconds, outcome (status code, 'ok' or 'error'). */
export function formatPerfLine(at: Date, kind: PerfKind, label: string, ms: number, outcome: string | number): string {
  return `${at.toISOString()}\t${kind}\t${label}\t${Math.round(ms)}\t${outcome}\n`
}

export function perfLogEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.NEXUSMIND_PERF_LOG === '1'
}
