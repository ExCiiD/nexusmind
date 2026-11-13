import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/hooks/useToast'
import { PASSWORD_MAX, PASSWORD_MIN, isAcceptablePassword } from '@/lib/accessCore'

/**
 * Account → password. Optional: with a password, signing in on a new
 * browser / PC (or after a sign-out) needs no e-mail code.
 */
export function PasswordSettings() {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [hasPassword, setHasPassword] = useState(false)
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    window.api.cloudStatus().then((s) => setHasPassword(!!s.user?.hasPassword)).catch(() => {})
  }, [])

  const save = async () => {
    setBusy(true)
    try {
      await window.api.cloudSetPassword(password)
      setHasPassword(true)
      setOpen(false)
      setPassword('')
      toast({ title: t('cloud.password.saved'), variant: 'gold' })
    } catch (err) {
      const weak = (err as Error)?.message?.includes('AUTH_WEAK_PASSWORD')
      toast({
        title: t('cloud.errors.title'),
        description: weak ? t('cloud.login.errors.weakPassword') : (err as Error).message,
        variant: 'destructive',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-hextech-border-dim p-3" data-testid="password-settings">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="flex items-center gap-2 text-hextech-text">
          <Lock className="h-4 w-4 text-hextech-gold" />
          {hasPassword ? t('cloud.password.isSet') : t('cloud.password.notSet')}
        </span>
        {!open && (
          <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
            {hasPassword ? t('cloud.password.change') : t('cloud.password.create')}
          </Button>
        )}
      </div>
      {open && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => { e.preventDefault(); if (!busy && isAcceptablePassword(password)) save() }}
        >
          <div className="min-w-[200px] flex-1 space-y-1">
            <Label htmlFor="account-new-password">{t('cloud.login.newPasswordLabel')}</Label>
            <Input
              id="account-new-password"
              type="password"
              autoFocus
              autoComplete="new-password"
              maxLength={PASSWORD_MAX}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <Button type="submit" size="sm" disabled={busy || !isAcceptablePassword(password)} className="gap-1">
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {t('cloud.login.savePassword')}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => { setOpen(false); setPassword('') }}>
            {t('common.cancel')}
          </Button>
          <p className="w-full text-xs text-hextech-text-dim">{t('cloud.login.passwordRules', { min: PASSWORD_MIN })}</p>
        </form>
      )}
      {!hasPassword && !open && <p className="text-xs text-hextech-text-dim">{t('cloud.password.why')}</p>}
    </div>
  )
}
