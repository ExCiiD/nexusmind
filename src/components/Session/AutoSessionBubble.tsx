import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Pencil, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useVisiblePolling } from '@/hooks/useVisiblePolling'

/** The active session is looked at every minute while the window is visible, and when it regains focus. */
const POLL_MS = 60_000

/**
 * User decision 27/11: a session starts by itself when the Record starts a game, even without objective or KPI.
 * While that active session has neither (`getActiveSession().needsObjective`, not dismissed yet), a small bubble offers to
 * add one. Closing it is stored per session by the main process (`dismissObjectivePrompt`), so it never comes back for it.
 * Same family as the announcement bubbles (fixed corner, only the card takes clicks); placed bottom-left of the content
 * so it does not sit over the job pill or the announcements on the right.
 */
export function AutoSessionBubble() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [pending, setPending] = useState<string | null>(null)
  const [closed, setClosed] = useState<Set<string>>(new Set())

  useVisiblePolling(async () => {
    try {
      const s = await window.api.getActiveSession()
      setPending(s?.needsObjective && s?.id ? String(s.id) : null)
    } catch {
      setPending(null)
    }
  }, POLL_MS)

  if (!pending || closed.has(pending)) return null

  const close = () => {
    setClosed((prev) => new Set(prev).add(pending))
    window.api.dismissObjectivePrompt(pending).catch(() => {})
  }
  const edit = () => {
    close()
    navigate('/session?modify=1')
  }

  return (
    <div className="pointer-events-none fixed bottom-4 left-[17rem] z-40 w-80 max-w-[calc(100vw-18rem)]">
      <div role="status" className="pointer-events-auto rounded-lg border border-hextech-gold/50 bg-hextech-dark/95 p-3 shadow-lg backdrop-blur" data-testid="auto-session-bubble">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 gap-2">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-hextech-gold" aria-hidden />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-hextech-gold-bright">{t('session.autoBubble.title')}</p>
              <p className="mt-0.5 text-xs text-hextech-text">{t('session.autoBubble.body')}</p>
            </div>
          </div>
          <button type="button" onClick={close} aria-label={t('session.autoBubble.close')} title={t('session.autoBubble.close')} className="shrink-0 text-hextech-text-dim hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
        <Button size="sm" variant="outline" className="mt-2.5 w-full gap-1.5" onClick={edit}>
          <Pencil className="h-3.5 w-3.5" aria-hidden />{t('session.autoBubble.edit')}
        </Button>
      </div>
    </div>
  )
}
