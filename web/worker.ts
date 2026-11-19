/**
 * The web app's Worker: the old workers.dev address redirects to app.asc3nd.app (cloudflare/shared/hostRedirect.ts),
 * every other request is the static app as before (dist/, _headers, single-page fallback).
 */
import { redirectResponse, redirectTarget, WEB_APP_ALIASES, WEB_APP_HOST } from '../cloudflare/shared/hostRedirect'

interface Env { ASSETS: { fetch(req: Request): Promise<Response> } }

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const target = redirectTarget(req.url, WEB_APP_HOST, WEB_APP_ALIASES)
    return target ? redirectResponse(target) : env.ASSETS.fetch(req)
  },
}
