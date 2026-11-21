/**
 * The showcase site's Worker: www.asc3nd.app and the old workers.dev address redirect to asc3nd.app
 * (cloudflare/shared/hostRedirect.ts), every other request is the static site as before (public/, _headers, 404 page).
 */
import { redirectResponse, redirectTarget, SITE_ALIASES, SITE_HOST } from '../cloudflare/shared/hostRedirect'

interface Env { ASSETS: { fetch(req: Request): Promise<Response> } }

/**
 * Google Search Console ownership file (21/11/2026, Google verification for the YouTube upload). Served as is,
 * without the assets' `.html` → clean-URL redirect: Google checks this exact address. Public by design.
 */
const GOOGLE_VERIFICATION_PATH = '/googlec7dae68e8dccf3cd.html'
const GOOGLE_VERIFICATION_BODY = 'google-site-verification: googlec7dae68e8dccf3cd.html'

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (new URL(req.url).pathname === GOOGLE_VERIFICATION_PATH) {
      return new Response(GOOGLE_VERIFICATION_BODY, { headers: { 'content-type': 'text/html; charset=utf-8' } })
    }
    const target = redirectTarget(req.url, SITE_HOST, SITE_ALIASES)
    return target ? redirectResponse(target) : env.ASSETS.fetch(req)
  },
}
