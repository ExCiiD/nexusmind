import { useEffect, useState } from 'react'

/** One request per champion and skin for the whole session, shared by every card. */
const requests = new Map<string, Promise<string | null>>()

function request(championKey: string, skin: number): Promise<string | null> {
  const key = `${championKey}_${skin}`
  let p = requests.get(key)
  if (!p) {
    const api = typeof window !== 'undefined' ? window.api?.championCutout : undefined
    p = api ? api(championKey, skin).then((r) => r.dataUrl).catch(() => null) : Promise.resolve(null)
    // A miss (offline, model not ready) is asked again on the next visit to the roster.
    void p.then((url) => { if (!url) setTimeout(() => requests.delete(key), 60_000) })
    requests.set(key, p)
  }
  return p
}

/**
 * The champion cut out of its loading art (a PNG data URL), once the main
 * process has it; null meanwhile, and for good when there is none (web app,
 * offline, unusable cut-out): the card then keeps the full art.
 */
export function useChampionCutout(championKey: string | null, skin = 0): string | null {
  const [url, setUrl] = useState<{ key: string; url: string | null } | null>(null)
  const key = championKey ? `${championKey}_${skin}` : null
  useEffect(() => {
    if (!championKey || !key) return
    let alive = true
    void request(championKey, skin).then((u) => { if (alive) setUrl({ key, url: u }) })
    return () => { alive = false }
  }, [championKey, skin, key])
  return url && url.key === key ? url.url : null
}
