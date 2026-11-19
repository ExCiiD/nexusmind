import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, ShieldCheck } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useToast } from '@/hooks/useToast'
import { useWellbeingConsent } from '@/hooks/useWellbeingConsent'
import { WellbeingConsentDialog } from './WellbeingConsentDialog'

/**
 * Settings → Privacy (desktop) / Account (web): the wellbeing consent, when
 * it was given, and how to withdraw it (privacy policy v0.3 § 3 bis and § 8).
 * Withdrawing deletes every check-in and stops all wellbeing sharing.
 */
export function WellbeingPrivacyCard() {
  const { t, i18n } = useTranslation()
  const { toast } = useToast()
  const { consent, granted, loading, available, set } = useWellbeingConsent()
  const [askOpen, setAskOpen] = useState(false)
  const [withdrawOpen, setWithdrawOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  if (!available) return null
  const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(i18n.language, { dateStyle: 'long' }) : '')

  const withdraw = async () => {
    setBusy(true)
    try {
      await set(false)
      toast({ title: t('wellbeing.privacy.withdrawn'), variant: 'gold' })
    } catch (err) {
      toast({ title: t('wellbeing.privacy.failed'), description: (err as Error)?.message, variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  const status = loading
    ? t('common.loading')
    : granted
      ? t('wellbeing.privacy.statusGranted', { date: date(consent?.grantedAt ?? null), version: consent?.version ?? '' })
      : consent?.status === 'withdrawn'
        ? t('wellbeing.privacy.statusWithdrawn', { date: date(consent.withdrawnAt) })
        : t('wellbeing.privacy.statusNone')

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-hextech-gold" aria-hidden />
          {t('wellbeing.privacy.title')}
        </CardTitle>
        <CardDescription>{t('wellbeing.privacy.desc')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center justify-between gap-3">
        <p role="status" className="text-sm text-hextech-text">{status}</p>
        {!loading && (granted ? (
          <Button variant="outline" size="sm" disabled={busy} onClick={() => setWithdrawOpen(true)} className="gap-2">
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {t('wellbeing.privacy.withdraw')}
          </Button>
        ) : (
          <Button size="sm" onClick={() => setAskOpen(true)}>{t('wellbeing.privacy.give')}</Button>
        ))}
      </CardContent>

      <ConfirmDialog
        open={withdrawOpen}
        onOpenChange={setWithdrawOpen}
        title={t('wellbeing.privacy.withdrawTitle')}
        description={t('wellbeing.privacy.withdrawDesc')}
        confirmLabel={t('wellbeing.privacy.withdrawConfirm')}
        onConfirm={() => { void withdraw() }}
      />
      <WellbeingConsentDialog
        open={askOpen}
        onOpenChange={setAskOpen}
        onDecide={async (yes) => {
          if (yes) {
            try { await set(true) } catch (err) {
              toast({ title: t('wellbeing.privacy.failed'), description: (err as Error)?.message, variant: 'destructive' })
              return
            }
          }
          setAskOpen(false)
        }}
      />
    </Card>
  )
}
