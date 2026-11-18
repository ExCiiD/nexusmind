import { useEffect } from 'react'
import type { ProfilePrefs } from '@/lib/profile'

/**
 * Shares the profile icon and banner with the player's cloud groups, so the
 * roster cards of their teammates (Team → Roster) show them. Runs at launch
 * and whenever the look changes, a moment after the last change; the main
 * process skips it when signed out and copies it again after a sign-in or
 * when a group is created or joined (electron/main/cloud/collab.ts).
 */
export function useShareProfileLook(prefs: ProfilePrefs | null): void {
  const iconId = prefs?.iconId
  const bannerId = prefs?.bannerId
  useEffect(() => {
    if (!iconId || !bannerId || !window.api.collabSetMyLook) return
    const timer = setTimeout(() => {
      window.api.collabSetMyLook({ iconId, bannerId }).catch(() => { /* signed out or offline: retried later */ })
    }, 1500)
    return () => clearTimeout(timer)
  }, [iconId, bannerId])
}
