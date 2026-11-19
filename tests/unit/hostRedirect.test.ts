/**
 * asc3nd.app: the old workers.dev addresses (and www) answer a 301 to the new address, path and query kept; the new
 * addresses are served as they are.
 */
import { describe, it, expect } from 'vitest'
import {
  redirectTarget, redirectResponse, SITE_HOST, SITE_ALIASES, WEB_APP_HOST, WEB_APP_ALIASES,
} from '../../cloudflare/shared/hostRedirect'

describe('redirectTarget', () => {
  it('the web app: old address → app.asc3nd.app, path and query kept', () => {
    expect(redirectTarget('https://nexusmind-web.nexusmind-riot-proxy.workers.dev/coaching/groups?tab=x', WEB_APP_HOST, WEB_APP_ALIASES))
      .toBe('https://app.asc3nd.app/coaching/groups?tab=x')
    expect(redirectTarget('https://nexusmind-web.nexusmind-riot-proxy.workers.dev/', WEB_APP_HOST, WEB_APP_ALIASES)).toBe('https://app.asc3nd.app/')
  })
  it('the site: www and the old address → asc3nd.app', () => {
    expect(redirectTarget('https://www.asc3nd.app/entrainement-solo', SITE_HOST, SITE_ALIASES)).toBe('https://asc3nd.app/entrainement-solo')
    expect(redirectTarget('http://ascend-site.nexusmind-riot-proxy.workers.dev/en/', SITE_HOST, SITE_ALIASES)).toBe('https://asc3nd.app/en/')
  })
  it('the new address over plain HTTP goes to HTTPS', () => {
    expect(redirectTarget('http://app.asc3nd.app/coaching?x=1', WEB_APP_HOST, WEB_APP_ALIASES)).toBe('https://app.asc3nd.app/coaching?x=1')
    expect(redirectTarget('http://asc3nd.app/', SITE_HOST, SITE_ALIASES)).toBe('https://asc3nd.app/')
  })
  it('the new addresses, and anything unknown, are served as they are', () => {
    expect(redirectTarget('https://app.asc3nd.app/coaching', WEB_APP_HOST, WEB_APP_ALIASES)).toBeNull()
    expect(redirectTarget('https://asc3nd.app/', SITE_HOST, SITE_ALIASES)).toBeNull()
    expect(redirectTarget('http://localhost:8787/', WEB_APP_HOST, WEB_APP_ALIASES)).toBeNull()
    // The web app never takes the site's aliases, and the reverse.
    expect(redirectTarget('https://www.asc3nd.app/', WEB_APP_HOST, WEB_APP_ALIASES)).toBeNull()
  })
  it('a hand-off link keeps its token: the fragment is the browser\'s, the path and query are carried', () => {
    // Browsers keep the #fragment across a redirect whose Location has none; the server never sees it.
    expect(redirectTarget('https://nexusmind-web.nexusmind-riot-proxy.workers.dev/?from=desktop', WEB_APP_HOST, WEB_APP_ALIASES))
      .toBe('https://app.asc3nd.app/?from=desktop')
  })
})

describe('redirectResponse', () => {
  it('301 with the location, no body', async () => {
    const r = redirectResponse('https://app.asc3nd.app/x')
    expect(r.status).toBe(301)
    expect(r.headers.get('location')).toBe('https://app.asc3nd.app/x')
    expect(await r.text()).toBe('')
  })
})
