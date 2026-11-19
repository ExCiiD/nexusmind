/**
 * T (L07): the Data Dragon version, fetched once per launch through ONE shared promise. Before, useChampionIconUrl
 * and useAllChampions each kept their own cache without a shared request, so the first opening of Draft or the
 * Champion Pool sent ~170 versions.json requests, and every icon loaded twice (fallback version, then the real one).
 *
 * The last version seen is kept in localStorage, so the next launch builds the right URLs at once (icons load once).
 */

export const DDRAGON_BASE = 'https://ddragon.leagueoflegends.com'
/** Used only offline on a first launch (no version seen yet). */
export const DDRAGON_FALLBACK_VERSION = '15.7.1'
const STORAGE_KEY = 'ascend:ddragon-version'
/** After a failed request (offline), the next caller may ask again after this delay. */
const RETRY_AFTER_MS = 60_000

let latest: string | null = null
let pending: Promise<string> | null = null

function stored(): string | null {
  try { return localStorage.getItem(STORAGE_KEY) } catch { return null }
}

/** The version known right now without a request: this launch's, else the last launch's, else null. */
export function knownDdragonVersion(): string | null {
  return latest ?? stored()
}

/** The latest Data Dragon version. Every caller shares the same request; offline gives the known or fallback one. */
export function getDdragonVersion(): Promise<string> {
  if (latest) return Promise.resolve(latest)
  if (!pending) {
    pending = fetch(`${DDRAGON_BASE}/api/versions.json`)
      .then((r) => r.json())
      .then((versions: unknown) => {
        const v = Array.isArray(versions) && typeof versions[0] === 'string' ? versions[0] : null
        if (!v) throw new Error('no version')
        latest = v
        try { localStorage.setItem(STORAGE_KEY, v) } catch { /* private mode: memory only */ }
        return v
      })
      .catch(() => {
        const p = pending
        setTimeout(() => { if (pending === p) pending = null }, RETRY_AFTER_MS)
        return stored() ?? DDRAGON_FALLBACK_VERSION
      })
  }
  return pending
}

/** Tests only. */
export function resetDdragonVersionForTests(): void {
  latest = null
  pending = null
}
