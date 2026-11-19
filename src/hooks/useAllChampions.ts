import { useEffect, useState } from 'react'
import { DDRAGON_BASE, getDdragonVersion } from '@/lib/ddragon'

export interface ChampionMeta {
  key: string       // Data Dragon key (e.g. "Renekton")
  name: string      // Display name (e.g. "Renekton")
  title: string     // Subtitle (e.g. "the Butcher of the Sands")
  tags: string[]    // ["Fighter", "Tank"]
}

let cachedChampions: ChampionMeta[] | null = null
let inflight: Promise<ChampionMeta[]> | null = null

async function fetchChampions(): Promise<ChampionMeta[]> {
  if (cachedChampions) return cachedChampions
  if (inflight) return inflight
  inflight = (async () => {
    const version = await getDdragonVersion() // T (L07): the shared version request
    try {
      const r = await fetch(`${DDRAGON_BASE}/cdn/${version}/data/en_US/champion.json`)
      const data = await r.json()
      const champions: ChampionMeta[] = Object.values(data.data ?? {}).map((c: any) => ({
        key: c.id,
        name: c.name,
        title: c.title,
        tags: c.tags ?? [],
      }))
      champions.sort((a, b) => a.name.localeCompare(b.name))
      cachedChampions = champions
      return champions
    } catch {
      return []
    } finally {
      inflight = null
    }
  })()
  return inflight
}

/**
 * Returns the full list of LoL champions (from Data Dragon).
 * Cached at module level so it's fetched at most once per session.
 */
export function useAllChampions(): { champions: ChampionMeta[]; loading: boolean } {
  const [champions, setChampions] = useState<ChampionMeta[]>(cachedChampions ?? [])
  const [loading, setLoading] = useState(!cachedChampions)

  useEffect(() => {
    if (cachedChampions) return
    let mounted = true
    fetchChampions().then((c) => {
      if (mounted) {
        setChampions(c)
        setLoading(false)
      }
    })
    return () => { mounted = false }
  }, [])

  return { champions, loading }
}
