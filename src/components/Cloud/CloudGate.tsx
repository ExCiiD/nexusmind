import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { KeyRound, Loader2, Lock, Mail, ShieldCheck } from 'lucide-react'
import { PASSWORD_MAX, PASSWORD_MIN, isAcceptablePassword } from '@/lib/accessCore'
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
      // Sign-outs apply at once; a sign-in made on the login screen is applied by
      // CloudLogin itself once it is done (it may still offer to set a password).
      setStatus((prev) => (prev ? (user && !prev.user ? prev : { ...prev, user }) : prev))
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

/** Per-device conveniences (last e-mail, preferred sign-in method); never required. */
const LAST_EMAIL_KEY = 'nexusmind-last-email'
const LOGIN_MODE_KEY = 'nexusmind-login-mode'
function readPref(key: string): string | null {
  try { return window.localStorage.getItem(key) } catch { return null }
}
function writePref(key: string, value: string): void {
  try { window.localStorage.setItem(key, value) } catch { /* storage blocked */ }
}

function errorKey(err: unknown): string {
  const msg = (err as Error)?.message ?? ''
  if (msg.includes('AUTH_NEEDS_INVITE')) return 'cloud.login.errors.needsInvite'
  if (msg.includes('INVITE_INVALID')) return 'cloud.login.errors.inviteInvalid'
  if (msg.includes('AUTH_RATE_LIMITED')) return 'cloud.login.errors.rateLimited'
  if (msg.includes('AUTH_BAD_PASSWORD')) return 'cloud.login.errors.badPassword'
  if (msg.includes('AUTH_WEAK_PASSWORD')) return 'cloud.login.errors.weakPassword'
  if (msg.includes('AUTH_INVALID_CODE') || msg.includes('invalid code')) return 'cloud.login.errors.invalidCode'
  if (msg.includes('Invalid input') && msg.includes('cloud:send-code')) return 'cloud.login.errors.invalidEmail'
  return 'cloud.login.errors.generic'
}

export function CloudLogin({ onSignedIn, footer }: { onSignedIn: (user: CloudStatus['user']) => void; footer?: ReactNode }) {
  const { t } = useTranslation()
  const [email, setEmail] = useState(() => readPref(LAST_EMAIL_KEY) ?? '')
  const [code, setCode] = useState('')
  const [password, setPasswordValue] = useState('')
  // A user who set a password signs in with it: no e-mail needed.
  const [mode, setMode] = useState<'code' | 'password'>(() => (readPref(LOGIN_MODE_KEY) === 'password' ? 'password' : 'code'))
  // Invite-only access: the first sign-in of an e-mail needs an invite code.
  const [invite, setInvite] = useState(() => window.api.pendingInviteCode?.() ?? '')
  const [showInvite, setShowInvite] = useState(invite !== '')
  const [step, setStep] = useState<'email' | 'code' | 'set-password'>('email')
  const [pendingUser, setPendingUser] = useState<CloudStatus['user']>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [legal, setLegal] = useState<'privacy' | 'terms' | null>(null)

  const finish = (user: CloudStatus['user'], usedMode: 'code' | 'password') => {
    writePref(LAST_EMAIL_KEY, email.trim().toLowerCase())
    writePref(LOGIN_MODE_KEY, usedMode === 'password' || user?.hasPassword ? 'password' : 'code')
    onSignedIn(user)
  }

  const signInPassword = async () => {
    setBusy(true)
    setError(null)
    try {
      const user = await window.api.cloudSignInPassword(email, password)
      if (user) finish(user, 'password')
    } catch (err) {
      setError(t(errorKey(err)))
    } finally {
      setBusy(false)
    }
  }

  const savePassword = async () => {
    setBusy(true)
    setError(null)
    try {
      const user = await window.api.cloudSetPassword(password)
      finish(user ?? pendingUser, 'password')
    } catch (err) {
      setError(t(errorKey(err)))
    } finally {
      setBusy(false)
    }
  }

  const sendCode = async () => {
    setBusy(true)
    setError(null)
    try {
      await window.api.cloudSendCode(email, showInvite && invite.trim() ? invite : undefined)
      setStep('code')
    } catch (err) {
      if ((err as Error)?.message?.includes('AUTH_NEEDS_INVITE')) setShowInvite(true)
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
      if (!user) return
      // First code sign-in: offer a password so the next sign-in needs no e-mail.
      if (user.hasPassword) finish(user, 'code')
      else { setPendingUser(user); setPasswordValue(''); setStep('set-password') }
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
          {step === 'set-password' ? (
            <form
              className="space-y-4"
              data-testid="set-password-step"
              onSubmit={(e) => { e.preventDefault(); if (!busy) savePassword() }}
            >
              <p className="text-sm text-hextech-text">{t('cloud.login.setPasswordIntro')}</p>
              <div className="space-y-2">
                <Label htmlFor="cloud-new-password">{t('cloud.login.newPasswordLabel')}</Label>
                <Input
                  id="cloud-new-password"
                  type="password"
                  autoFocus
                  autoComplete="new-password"
                  maxLength={PASSWORD_MAX}
                  value={password}
                  onChange={(e) => setPasswordValue(e.target.value)}
                />
                <p className="text-xs text-hextech-text-dim">{t('cloud.login.passwordRules', { min: PASSWORD_MIN })}</p>
              </div>
              <Button type="submit" className="w-full" disabled={!isAcceptablePassword(password) || busy}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Lock className="mr-2 h-4 w-4" />}
                {t('cloud.login.savePassword')}
              </Button>
              <button
                type="button"
                className="w-full text-xs text-hextech-text-dim underline-offset-2 hover:underline"
                onClick={() => finish(pendingUser, 'code')}
              >
                {t('cloud.login.skipPassword')}
              </button>
            </form>
          ) : step === 'email' && mode === 'password' ? (
            <form
              className="space-y-4"
              onSubmit={(e) => { e.preventDefault(); if (email && password && !busy) signInPassword() }}
            >
              <div className="space-y-2">
                <Label htmlFor="cloud-email">{t('cloud.login.emailLabel')}</Label>
                <Input
                  id="cloud-email"
                  type="email"
                  autoFocus={!email}
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cloud-password">{t('cloud.login.passwordLabel')}</Label>
                <Input
                  id="cloud-password"
                  type="password"
                  autoFocus={!!email}
                  autoComplete="current-password"
                  maxLength={PASSWORD_MAX}
                  value={password}
                  onChange={(e) => setPasswordValue(e.target.value)}
                />
              </div>
              <Button type="submit" className="w-full" disabled={!email || !password || busy}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Lock className="mr-2 h-4 w-4" />}
                {t('cloud.login.signInPassword')}
              </Button>
              <button
                type="button"
                className="w-full text-xs text-hextech-text-dim underline-offset-2 hover:underline"
                onClick={() => { setMode('code'); setPasswordValue(''); setError(null) }}
              >
                {t('cloud.login.useCodeInstead')}
              </button>
            </form>
          ) : step === 'email' ? (
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
              {showInvite ? (
                <div className="space-y-2">
                  <Label htmlFor="cloud-invite">{t('cloud.login.inviteLabel')}</Label>
                  <Input
                    id="cloud-invite"
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={20}
                    value={invite}
                    onChange={(e) => setInvite(e.target.value.toUpperCase())}
                    placeholder="ABCD-EFGH-JKMN"
                    className="font-mono tracking-wider"
                  />
                  <p className="text-xs text-hextech-text-dim">{t('cloud.login.inviteHint')}</p>
                </div>
              ) : (
                <button
                  type="button"
                  className="flex items-center gap-1 text-xs text-hextech-text-dim underline-offset-2 hover:underline"
                  onClick={() => setShowInvite(true)}
                >
                  <KeyRound className="h-3 w-3" />
                  {t('cloud.login.haveInvite')}
                </button>
              )}
              <Button type="submit" className="w-full" disabled={!email || busy}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mail className="mr-2 h-4 w-4" />}
                {t('cloud.login.sendCode')}
              </Button>
              <button
                type="button"
                className="w-full text-xs text-hextech-text-dim underline-offset-2 hover:underline"
                onClick={() => { setMode('password'); setError(null) }}
              >
                {t('cloud.login.usePasswordInstead')}
              </button>
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
