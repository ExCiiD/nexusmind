import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { HeartPulse, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { LegalDialog } from '@/components/Cloud/LegalDialog'

/**
 * Consent to storing wellbeing check-ins (privacy policy v0.3 § 3 bis, draft
 * part C). Nothing is pre-ticked and both choices carry the same weight.
 *
 * - `mode="first"`: asked when the user sends a check-in. "Not now" saves
 *   nothing and leaves the form as it was.
 * - `mode="existing"`: the user already has check-ins stored without a
 *   recorded consent. Declining deletes them (rule 5 of part C), so the
 *   second button says so.
 */
export function WellbeingConsentDialog({ open, mode = 'first', existingCount = 0, onDecide, onOpenChange }: {
  open: boolean
  mode?: 'first' | 'existing'
  existingCount?: number
  /** Called with the choice; resolves once it is applied. */
  onDecide: (granted: boolean) => Promise<void>
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState<'yes' | 'no' | null>(null)
  const [legal, setLegal] = useState(false)
  // No DialogTrigger: give focus back to the element that opened the dialog (same as ConfirmDialog).
  const returnTo = useRef<HTMLElement | null>(null)

  const decide = async (granted: boolean) => {
    setBusy(granted ? 'yes' : 'no')
    try { await onDecide(granted) } finally { setBusy(null) }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o) }}>
        <DialogContent
          className="max-w-md"
          onOpenAutoFocus={() => { returnTo.current = document.activeElement as HTMLElement | null }}
          onCloseAutoFocus={(e) => {
            const el = returnTo.current
            returnTo.current = null
            if (el?.isConnected) { e.preventDefault(); el.focus() }
          }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <HeartPulse className="h-5 w-5 text-hextech-gold" aria-hidden />
              {t('wellbeing.consent.title')}
            </DialogTitle>
            <DialogDescription>{t('wellbeing.consent.intro')}</DialogDescription>
          </DialogHeader>
          <ul className="list-disc space-y-1 pl-5 text-sm text-hextech-text">
            <li>{t('wellbeing.consent.private')}</li>
            <li>{t('wellbeing.consent.withdraw')}</li>
          </ul>
          {mode === 'existing' && (
            <p className="rounded-md border border-hextech-gold/30 bg-hextech-gold/5 px-3 py-2 text-sm text-hextech-text">
              {t('wellbeing.consent.existing', { count: existingCount })}
            </p>
          )}
          <button
            type="button"
            className="w-fit text-xs text-hextech-text-dim underline underline-offset-2 hover:text-hextech-text"
            onClick={() => setLegal(true)}
          >
            {t('wellbeing.consent.learnMore')}
          </button>
          {/* Same variant, size and weight for both answers: refusing must be as easy as
              accepting (EDPB guidelines 03/2022 on deceptive design, health data). */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button variant="outline" disabled={busy !== null} onClick={() => decide(false)} className="gap-2">
              {busy === 'no' && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {mode === 'existing' ? t('wellbeing.consent.declineDelete') : t('wellbeing.consent.notNow')}
            </Button>
            <Button variant="outline" disabled={busy !== null} onClick={() => decide(true)} className="gap-2">
              {busy === 'yes' && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {t('wellbeing.consent.accept')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <LegalDialog doc={legal ? 'privacy' : null} onClose={() => setLegal(false)} />
    </>
  )
}
