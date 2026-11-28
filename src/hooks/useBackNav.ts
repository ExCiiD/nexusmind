import { useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { backTarget } from '@/lib/backNav'

/**
 * `[goBack, cameFromApp]`: `goBack()` returns to the page we came from (router history), or to `fallback` when this page was opened
 * directly (`cameFromApp` false: the button then names the fallback page). See `backTarget`.
 */
export function useBackNav(fallback: string): [goBack: () => void, cameFromApp: boolean] {
  const navigate = useNavigate()
  const { key } = useLocation()
  const cameFromApp = backTarget(key, fallback) === -1
  const goBack = useCallback(() => {
    const to = backTarget(key, fallback)
    if (to === -1) navigate(-1)
    else navigate(to)
  }, [navigate, key, fallback])
  return [goBack, cameFromApp]
}
