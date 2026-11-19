import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Power } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { useToast } from '@/hooks/useToast'

/**
 * "Launch Ascend when Windows starts" (electron/main/launchAtLogin.ts). Hidden
 * where the bridge doesn't exist (web app); disabled outside the installed
 * Windows app.
 */
export function StartupCard() {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [state, setState] = useState<{ supported: boolean; enabled: boolean } | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let alive = true
    window.api.getLaunchAtLogin?.()
      .then((s) => { if (alive) setState(s) })
      .catch(() => { if (alive) setState({ supported: false, enabled: false }) })
    return () => { alive = false }
  }, [])

  if (!window.api.getLaunchAtLogin || !state) return null

  const toggle = async (enabled: boolean) => {
    if (!window.api.setLaunchAtLogin) return
    setSaving(true)
    try {
      setState(await window.api.setLaunchAtLogin(enabled))
    } catch {
      toast({ title: t('settings.startup.error'), variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Power className="h-5 w-5 text-hextech-teal" />
          {t('settings.startup.title')}
        </CardTitle>
        <CardDescription>{t('settings.startup.desc')}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-start justify-between gap-4">
          <div>
            <label htmlFor="launch-at-login" className="text-sm font-medium text-hextech-text-bright">{t('settings.startup.label')}</label>
            <p id="launch-at-login-desc" className="mt-0.5 text-xs text-hextech-text-dim">
              {state.supported ? t('settings.startup.labelDesc') : t('settings.startup.unsupported')}
            </p>
          </div>
          <Switch
            id="launch-at-login"
            checked={state.enabled}
            disabled={!state.supported || saving}
            onCheckedChange={toggle}
            aria-describedby="launch-at-login-desc"
            className="mt-0.5"
          />
        </div>
      </CardContent>
    </Card>
  )
}
