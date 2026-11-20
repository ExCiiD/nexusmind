/**
 * « Importer depuis l'historique » (MatchHistoryPicker): never a spinner forever. The answer of fetchMatchHistory read
 * in either shape — the list, or { matches, partial } when Riot only answered part of it — and its errors mapped to a
 * translated message. Pure, tested.
 */

/** The picker gives up waiting (but still takes a late answer) after this. */
export const PICKER_SLOW_MS = 25_000

export function normalizeHistoryResult<T>(raw: unknown): { list: T[]; partial: boolean } {
  if (Array.isArray(raw)) return { list: raw as T[], partial: false }
  const r = raw as { matches?: unknown; partial?: unknown } | null | undefined
  return { list: Array.isArray(r?.matches) ? (r!.matches as T[]) : [], partial: r?.partial === true }
}

/** The i18n key of a fetch error (the rate limit has its own message, with its wait). */
export function pickerErrorKey(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err ?? '')
  if (/no user found|no account/i.test(msg)) return 'history.picker.errors.noAccount'
  if (/timeout|timed out|ETIMEDOUT|TIMEOUT/i.test(msg)) return 'history.picker.errors.timeout'
  if (/fetch failed|network|ENOTFOUND|ECONNRESET|ECONNREFUSED|offline/i.test(msg)) return 'history.picker.errors.offline'
  if (/\b(401|403)\b|forbidden|unauthori[sz]ed|api key/i.test(msg)) return 'history.picker.errors.riotUnavailable'
  return 'history.picker.errors.generic'
}
