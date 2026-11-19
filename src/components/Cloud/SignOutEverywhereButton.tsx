import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, MonitorX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'

/**
 * "Sign out of every device" (#32): ends the account's sessions on every PC
 * and browser, this one included. `cloudSignOutEverywhere` throws when the
 * server could not be reached — nothing is revoked then, and we say so
 * plainly instead of pretending it worked. Hidden where the API is missing.
 */
export function SignOutEverywhereButton({ size = 'sm' }: { size?: 'sm' | 'default' }) {
  const { t } = useTranslation()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (typeof window.api.cloudSignOutEverywhere !== 'function') return null

  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      await window.api.cloudSignOutEverywhere!()
      // Success also ends this session: the sign-in screen takes over.
    } catch (err) {
      console.warn('[SignOutEverywhere] failed:', err)
      setError(t('cloud.signOutEverywhere.failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button variant="outline" size={size} className="gap-2" disabled={busy} onClick={() => setConfirmOpen(true)}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <MonitorX className="h-4 w-4" aria-hidden />}
        {t('cloud.signOutEverywhere.button')}
      </Button>
      {error && <p role="alert" className="basis-full text-xs text-hextech-red">{error}</p>}
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t('cloud.signOutEverywhere.title')}
        description={t('cloud.signOutEverywhere.desc')}
        confirmLabel={t('cloud.signOutEverywhere.confirm')}
        onConfirm={() => { void run() }}
      />
    </>
  )
}
