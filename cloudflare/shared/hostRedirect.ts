/**
 * asc3nd.app (19/11/2026, domain bought by the user, addressing decided by the Chief):
 *   asc3nd.app        the showcase site (www.asc3nd.app redirects there)
 *   app.asc3nd.app    the web app
 * The old workers.dev addresses stay served by the same Workers and answer a 301 to the new address, path, query
 * and (in the browser) #fragment kept: released desktop apps open <web>/#handoff=… on the old address, and links
 * shared before the move keep working.
 *
 * Pure: the Workers' entry files (site/worker.ts, web/worker.ts) call it before serving their static assets.
 */

/** Where a request must go instead, or null to serve it here. */
export function redirectTarget(requestUrl: string, canonicalHost: string, aliases: readonly string[]): string | null {
  const url = new URL(requestUrl)
  const host = url.hostname.toLowerCase()
  // The new address over plain HTTP: to HTTPS (HSTS only helps from the second visit on).
  if (host === canonicalHost) {
    if (url.protocol !== 'http:') return null
    url.protocol = 'https:'
    url.port = ''
    return url.toString()
  }
  if (!aliases.includes(host)) return null
  url.protocol = 'https:'
  url.hostname = canonicalHost
  url.port = ''
  return url.toString()
}

/** The 301 answer: permanent, cacheable, no body. */
export function redirectResponse(location: string): Response {
  return new Response(null, { status: 301, headers: { location, 'cache-control': 'public, max-age=3600' } })
}

export const SITE_HOST = 'asc3nd.app'
export const WEB_APP_HOST = 'app.asc3nd.app'
/** The old addresses (and www), redirected. */
export const SITE_ALIASES = ['www.asc3nd.app', 'ascend-site.nexusmind-riot-proxy.workers.dev'] as const
export const WEB_APP_ALIASES = ['nexusmind-web.nexusmind-riot-proxy.workers.dev'] as const
