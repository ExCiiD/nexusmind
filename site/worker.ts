/**
 * The showcase site's Worker: www.asc3nd.app and the old workers.dev address redirect to asc3nd.app
 * (cloudflare/shared/hostRedirect.ts), every other request is the static site as before (public/, _headers, 404 page).
 */
import { redirectResponse, redirectTarget, SITE_ALIASES, SITE_HOST } from '../cloudflare/shared/hostRedirect'

interface Env { ASSETS: { fetch(req: Request): Promise<Response> } }

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const target = redirectTarget(req.url, SITE_HOST, SITE_ALIASES)
    return target ? redirectResponse(target) : env.ASSETS.fetch(req)
  },
}
