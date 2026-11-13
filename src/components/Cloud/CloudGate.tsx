import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Mail, ShieldCheck } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { CloudStatus } from '@/lib/ipc'
import { LegalDialog } from './LegalDialog'

/**
 * A NexusMind account is required: it authenticates Riot calls (the Riot API
 * key lives in our proxy, not in the app) and owns the cloud backups.
 * Builds without cloud configuration (CI, tests) skip the gate.
 */
/** `loginFooter`: extra content under the sign-in card (the web app shows the download link there). */
export function CloudGate({ children, loginFooter }: { children: ReactNode; loginFooter?: ReactNode }) {
  const [status, setStatus] = useState<CloudStatus | null>(null)

  useEffect(() => {
    let alive = true
    window.api.cloudStatus().then((s) => alive && setStatus(s)).catch(() => alive && setStatus(null))
    const off = window.api.onCloudAuthChanged((user) => {
      setStatus((prev) => (prev ? { ...prev, user } : prev))
    })
    return () => { alive = false; off() }
  }, [])

  if (status === null) {
    return (
      <div className="flex h-screen items-center justify-center bg-hextech-black">
        <Loader2 className="h-6 w-6 animate-spin text-hextech-gold" />
      </div>
    )
  }
  if (!status.configured || status.user) return <>{children}</>
  return <CloudLogin footer={loginFooter} onSignedIn={(user) => setStatus({ ...status, user })} />
}

function errorKey(err: unknown): string {
  const msg = (err as Error)?.message ?? ''
  if (msg.includes('AUTH_RATE_LIMITED')) return 'cloud.login.errors.rateLimited'
  if (msg.includes('AUTH_INVALID_CODE') || msg.includes('invalid code')) return 'cloud.login.errors.invalidCode'
  if (msg.includes('Invalid input') && msg.includes('cloud:send-code')) return 'cloud.login.errors.invalidEmail'
  return 'cloud.login.errors.generic'
}

export function CloudLogin({ onSignedIn, footer }: { onSignedIn: (user: CloudStatus['user']) => void; footer?: ReactNode }) {
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [legal, setLegal] = useState<'privacy' | 'terms' | null>(null)

  const sendCode = async () => {
    setBusy(true)
    setError(null)
    try {
      await window.api.cloudSendCode(email)
      setStep('code')
    } catch (err) {
      setError(t(errorKey(err)))
    } finally {
      setBusy(false)
    }
  }

  const verify = async () => {
    setBusy(true)
    setError(null)
    try {
      const user = await window.api.cloudVerifyCode(email, code)
      if (user) onSignedIn(user)
    } catch (err) {
      setError(t(errorKey(err)))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-screen items-center justify-center bg-hextech-black p-4">
      <Card className="w-full max-w-md border-hextech-border bg-hextech-dark">
        <CardHeader>
          <div className="mb-2 flex items-center gap-2 text-hextech-gold">
            <ShieldCheck className="h-5 w-5" />
            <span className="font-display text-sm tracking-wider">NexusMind</span>
          </div>
          <CardTitle>{t('cloud.login.title')}</CardTitle>
          <CardDescription>{t('cloud.login.subtitle')}</CardDescription>
        </CardHeader>
        <CardContent>
          {step === 'email' ? (
            <form
              className="space-y-4"
              onSubmit={(e) => { e.preventDefault(); if (email && !busy) sendCode() }}
            >
              <div className="space-y-2">
                <Label htmlFor="cloud-email">{t('cloud.login.emailLabel')}</Label>
                <Input
                  id="cloud-email"
                  type="email"
                  autoFocus
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                />
              </div>
              <Button type="submit" className="w-full" disabled={!email || busy}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mail className="mr-2 h-4 w-4" />}
                {t('cloud.login.sendCode')}
              </Button>
            </form>
          ) : (
            <form
              className="space-y-4"
              onSubmit={(e) => { e.preventDefault(); if (code && !busy) verify() }}
            >
              <p className="text-sm text-hextech-text-dim">{t('cloud.login.codeSent', { email })}</p>
              <div className="space-y-2">
                <Label htmlFor="cloud-code">{t('cloud.login.codeLabel')}</Label>
                <Input
                  id="cloud-code"
                  inputMode="numeric"
                  autoFocus
                  autoComplete="one-time-code"
                  maxLength={10}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="123456"
                />
              </div>
              <Button type="submit" className="w-full" disabled={code.length < 6 || busy}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t('cloud.login.verify')}
              </Button>
              <button
                type="button"
                className="w-full text-xs text-hextech-text-dim underline-offset-2 hover:underline"
                onClick={() => { setStep('email'); setCode(''); setError(null) }}
              >
                {t('cloud.login.changeEmail')}
              </button>
            </form>
          )}
          {error && <p role="alert" className="mt-4 text-sm text-hextech-red">{error}</p>}
          <p className="mt-6 text-xs leading-relaxed text-hextech-text-dim">{t('cloud.login.why')}</p>
          <p className="mt-2 text-xs text-hextech-text-dim">
            {t('cloud.login.consent')}{' '}
            <button type="button" className="underline underline-offset-2 hover:text-hextech-text" onClick={() => setLegal('terms')}>
              {t('cloud.legal.terms')}
            </button>
            {' · '}
            <button type="button" className="underline underline-offset-2 hover:text-hextech-text" onClick={() => setLegal('privacy')}>
              {t('cloud.legal.privacy')}
            </button>
          </p>
          {footer && <div className="mt-4 border-t border-hextech-border-dim pt-4">{footer}</div>}
        </CardContent>
      </Card>
      <LegalDialog doc={legal} onClose={() => setLegal(null)} />
    </div>
  )
}
