import { useEffect, useState } from 'react'
import { DDRAGON_BASE, DDRAGON_FALLBACK_VERSION, getDdragonVersion, knownDdragonVersion } from '@/lib/ddragon'

/**
 * The Data Dragon version, or null while the first request of this launch (with no version seen before) is out.
 * One shared request for every caller (src/lib/ddragon.ts).
 */
export function useDdragonVersionOrNull(): string | null {
  const [version, setVersion] = useState<string | null>(knownDdragonVersion)

  useEffect(() => {
    let alive = true
    getDdragonVersion().then((v) => { if (alive) setVersion(v) })
    return () => { alive = false }
  }, [])

  return version
}

/** Latest Data Dragon version, asked once per launch; a known one meanwhile (or offline). */
export function useDdragonVersion(): string {
  return useDdragonVersionOrNull() ?? DDRAGON_FALLBACK_VERSION
}

/** The champion's icon URL; null until the version is known, so an icon never loads twice (T, L07). */
export function useChampionIconUrl(championName: string | null | undefined): string | null {
  const version = useDdragonVersionOrNull()
  if (!championName || !version) return null
  return `${DDRAGON_BASE}/cdn/${version}/img/champion/${championName}.png`
}
