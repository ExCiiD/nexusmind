import type { TFunction } from 'i18next'

/**
 * Riot rate limits, shown the same way on desktop and web.
 * - Desktop: riotFetch throws RiotRateLimitError, whose message reaches the screens through IPC as
 *   "Error invoking remote method '…': Error: RIOT_RATE_LIMITED: too many Riot requests right now. Try again in
 *   about N seconds." (the code does not survive IPC, the message does).
 * - Web: riotWeb throws RiotWebError with code 'rate-limited' and retryAfterSec.
 * Pure, tested.
 */

const DESKTOP_RE = /RIOT_RATE_LIMITED[\s\S]*?about (\d+) seconds/

/** The wait in seconds when `err` is a Riot rate limit, else null. */
export function riotRateLimitSeconds(err: unknown): number | null {
  if (err && typeof err === 'object' && (err as { code?: unknown }).code === 'rate-limited') {
    const sec = (err as { retryAfterSec?: unknown }).retryAfterSec
    return typeof sec === 'number' && Number.isFinite(sec) ? Math.max(1, Math.ceil(sec)) : 30
  }
  const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
  if (!msg.includes('RIOT_RATE_LIMITED')) return null
  const m = DESKTOP_RE.exec(msg)
  return m ? Number(m[1]) : 30
}

export const isRiotRateLimited = (err: unknown): boolean => riotRateLimitSeconds(err) !== null

/** The text to show for a Riot error: the translated rate-limit message with its wait, else the error's message. */
export function riotErrorText(err: unknown, t: TFunction): string {
  const sec = riotRateLimitSeconds(err)
  if (sec !== null) return t('riotErrors.rateLimited', { count: sec })
  return err instanceof Error ? err.message : String(err ?? '')
}
