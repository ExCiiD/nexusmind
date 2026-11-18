import { useEffect, useState } from 'react'

const FALLBACK_VERSION = '15.7.1'
let cachedVersion: string | null = null

/** Latest Data Dragon version, asked once per launch; a known one meanwhile
 *  (or offline). */
export function useDdragonVersion(): string {
  const [version, setVersion] = useState(cachedVersion ?? FALLBACK_VERSION)

  useEffect(() => {
    if (cachedVersion) {
      setVersion(cachedVersion)
      return
    }
    fetch('https://ddragon.leagueoflegends.com/api/versions.json')
      .then((r) => r.json())
      .then((versions: string[]) => {
        if (versions[0]) {
          cachedVersion = versions[0]
          setVersion(versions[0])
        }
      })
      .catch(() => {})
  }, [])

  return version
}

export function useChampionIconUrl(championName: string | null | undefined): string | null {
  const version = useDdragonVersion()
  if (!championName) return null
  return `https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${championName}.png`
}
