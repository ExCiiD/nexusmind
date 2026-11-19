import { useEffect, useState } from 'react'

/**
 * YouTube upload (connect a channel, send a recording or clip) is hidden in
 * the packaged app — user decision "option A" of 19/11/2026: the OAuth
 * client secret must not ship in the build. The main process says whether
 * upload is possible (`youtubeGetStatus().available`: false in the installed
 * app, and in development without OAuth credentials). Existing YouTube links
 * (pasted URLs, earlier uploads) keep showing everywhere.
 *
 * False until confirmed, so a packaged build never flashes the controls.
 */
export function useYoutubeUploadAvailable(): boolean {
  const [available, setAvailable] = useState(false)
  useEffect(() => {
    const getStatus = window.api?.youtubeGetStatus
    if (typeof getStatus !== 'function') return
    let alive = true
    getStatus().then((s) => { if (alive) setAvailable(s?.available === true) }).catch(() => {})
    return () => { alive = false }
  }, [])
  return available
}
