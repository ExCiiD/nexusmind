import { useEffect, useState } from 'react'

const REPO = 'ExCiiD/nexusmind'
const RELEASES_PAGE = `https://github.com/${REPO}/releases`

export interface LatestRelease {
  /** Direct link to the Windows installer when found, else the releases page. */
  url: string
  version: string | null
}

let cache: Promise<LatestRelease> | null = null

/**
 * Newest NexusMind installer, pre-releases included: GitHub's
 * `releases/latest` skips pre-releases, and every beta is one.
 */
function fetchLatest(): Promise<LatestRelease> {
  cache ??= fetch(`https://api.github.com/repos/${REPO}/releases?per_page=5`, { headers: { Accept: 'application/vnd.github+json' } })
    .then((r) => (r.ok ? r.json() : []))
    .then((releases: Array<{ tag_name: string; draft: boolean; assets: Array<{ name: string; browser_download_url: string }> }>) => {
      const rel = releases.find((r) => !r.draft && r.assets.some((a) => /Setup.*\.exe$/i.test(a.name)))
      const asset = rel?.assets.find((a) => /Setup.*\.exe$/i.test(a.name))
      return asset ? { url: asset.browser_download_url, version: rel!.tag_name.replace(/^v/, '') } : { url: RELEASES_PAGE, version: null }
    })
    .catch(() => ({ url: RELEASES_PAGE, version: null }))
  return cache
}

export function useLatestRelease(): LatestRelease {
  const [rel, setRel] = useState<LatestRelease>({ url: RELEASES_PAGE, version: null })
  useEffect(() => { fetchLatest().then(setRel) }, [])
  return rel
}
