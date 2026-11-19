import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { scrimCalendarEventId } from '../scrims'

/**
 * #49: the Scrims page is gone — scrims are planned in the Planning (docs/DESIGN_STATE.md § 13). Old links
 * (`/scrims`, `/scrims?scrim=<id>` from Home, Discord or bookmarks) land on the Planning, on the scrim's slot when
 * it has one (its week shown, its panel open).
 */
export function ScrimsRedirect() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const scrimId = params.get('scrim')

  useEffect(() => {
    let alive = true
    const go = (eventId: string | null) => {
      if (alive) navigate(eventId ? `/management?tab=planning&event=${encodeURIComponent(eventId)}` : '/management?tab=planning', { replace: true })
    }
    if (!scrimId) { go(null); return }
    scrimCalendarEventId(scrimId).then(go, () => go(null))
    return () => { alive = false }
  }, [scrimId, navigate])

  return (
    <div role="status" className="flex justify-center p-8">
      <Loader2 className="h-6 w-6 animate-spin text-hextech-gold" aria-hidden />
      <span className="sr-only">{t('planning.match.redirecting')}</span>
    </div>
  )
}
