import { app } from 'electron'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { getAccessToken } from './cloud/supabase'

/**
 * Decides how a Riot API call leaves the app.
 *
 *  - Proxy (default, and the only option in packaged builds): the call goes
 *    to the Ascend Cloudflare Worker with the user's Supabase token; the
 *    Riot key lives only in the Worker.
 *  - Direct (development only): `RIOT_DEV_API_KEY` from `.env`, read at
 *    runtime so it can never be inlined into a build.
 */

const PROXY_URL = ((import.meta.env.MAIN_VITE_RIOT_PROXY_URL as string | undefined) ?? '').trim().replace(/\/+$/, '')

const RIOT_HOST = /^https:\/\/([a-z0-9]+)\.api\.riotgames\.com(\/.*)$/

export class RiotAuthError extends Error {
  constructor(public readonly code: 'LOGIN_REQUIRED' | 'NOT_CONFIGURED', message: string) {
    super(message)
    this.name = 'RiotAuthError'
  }
}

/** https://euw1.api.riotgames.com/lol/... → <proxy>/euw1/lol/... */
export function toProxyUrl(riotUrl: string, proxyBase: string): string {
  const m = RIOT_HOST.exec(riotUrl)
  if (!m) throw new Error(`Not a Riot API URL: ${riotUrl}`)
  return `${proxyBase}/${m[1]}${m[2]}`
}

let devKeyCache: string | null | undefined
function readDevKey(): string | null {
  if (devKeyCache !== undefined) return devKeyCache
  devKeyCache = null
  if (app.isPackaged) return null
  const fromEnv = process.env.RIOT_DEV_API_KEY?.trim()
  if (fromEnv) return (devKeyCache = fromEnv)
  const envFile = join(process.cwd(), '.env')
  if (existsSync(envFile)) {
    const line = readFileSync(envFile, 'utf-8').split(/\r?\n/).find((l) => l.startsWith('RIOT_DEV_API_KEY='))
    const value = line?.slice('RIOT_DEV_API_KEY='.length).trim().replace(/^["']|["']$/g, '')
    if (value && !value.startsWith('RGAPI-xxx')) devKeyCache = value
  }
  return devKeyCache
}

export function riotTransportMode(): 'proxy' | 'direct' | 'none' {
  if (PROXY_URL) return 'proxy'
  if (readDevKey()) return 'direct'
  return 'none'
}

/** URL + headers for one Riot call. Throws RiotAuthError when it cannot be sent. */
export async function prepareRiotRequest(riotUrl: string): Promise<{ url: string; headers: Record<string, string> }> {
  const mode = riotTransportMode()
  if (mode === 'proxy') {
    const token = await getAccessToken()
    if (!token) throw new RiotAuthError('LOGIN_REQUIRED', 'Sign in to your Ascend account to load Riot data.')
    return { url: toProxyUrl(riotUrl, PROXY_URL), headers: { Authorization: `Bearer ${token}` } }
  }
  if (mode === 'direct') {
    return { url: riotUrl, headers: { 'X-Riot-Token': readDevKey()! } }
  }
  throw new RiotAuthError(
    'NOT_CONFIGURED',
    'Riot access is not configured: set MAIN_VITE_RIOT_PROXY_URL (or RIOT_DEV_API_KEY in .env for local development).',
  )
}
