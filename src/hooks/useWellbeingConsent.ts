import { useCallback, useEffect, useState } from 'react'
import type { WellbeingConsent } from '@/lib/wellbeing'

/** Version of the legal texts the consent refers to. */
export const WELLBEING_CONSENT_VERSION = 'v0.3' as const

const CHANGED = 'ascend:wellbeing-consent-changed'

/**
 * The user's consent to storing wellbeing check-ins (privacy policy v0.3,
 * § 3 bis). Every screen that reads it (check-in form, Privacy card, group
 * sharing switches) stays in step through a window event.
 *
 * `consent` is null while loading or when the API is missing (signed out /
 * no cloud): callers treat that as "not granted".
 */
export function useWellbeingConsent() {
  const [consent, setConsent] = useState<WellbeingConsent | null>(null)
  const [loading, setLoading] = useState(true)
  const available = typeof window.api?.wellbeingConsentGet === 'function'

  const reload = useCallback(async () => {
    if (!available) { setLoading(false); return }
    try { setConsent(await window.api.wellbeingConsentGet()) } catch { setConsent(null) } finally { setLoading(false) }
  }, [available])

  useEffect(() => {
    reload()
    const on = () => { reload() }
    window.addEventListener(CHANGED, on)
    return () => window.removeEventListener(CHANGED, on)
  }, [reload])

  /** Grants (true) or withdraws (false). Withdrawing deletes every check-in and stops all wellbeing sharing (server side). */
  const set = useCallback(async (granted: boolean) => {
    const next = await window.api.wellbeingConsentSet(granted, WELLBEING_CONSENT_VERSION)
    setConsent(next)
    window.dispatchEvent(new Event(CHANGED))
    return next
  }, [])

  return { consent, granted: consent?.status === 'granted', loading, available, set, reload }
}
