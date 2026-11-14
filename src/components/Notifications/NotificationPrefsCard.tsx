import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bell, Loader2 } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/hooks/useToast'
import { NOTIFICATION_TYPES, type NotificationPrefs, type NotificationType } from '@/lib/notifications'

/** E8 (docs/PLAN_GESTION_EQUIPE.md): per-user mute-by-type + quiet hours, shared desktop/web. */
export function NotificationPrefsCard() {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    window.api.notificationPrefsGet().then(setPrefs).catch(() => setPrefs({ mutedTypes: [], quietStart: null, quietEnd: null }))
  }, [])

  if (!prefs) return <Loader2 className="h-5 w-5 animate-spin text-hextech-text-dim" />

  const toggleType = (type: NotificationType) => {
    setPrefs((p) => p && ({
      ...p,
      mutedTypes: p.mutedTypes.includes(type) ? p.mutedTypes.filter((t2) => t2 !== type) : [...p.mutedTypes, type],
    }))
  }

  const save = async () => {
    setSaving(true)
    try {
      await window.api.notificationPrefsSet(prefs)
      toast({ title: t('notificationPrefs.saved', { defaultValue: 'Preferences saved' }), variant: 'gold' })
    } catch {
      toast({ title: 'Error', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Bell className="h-5 w-5 text-hextech-gold" />{t('notificationPrefs.title', { defaultValue: 'Notification preferences' })}
        </CardTitle>
        <CardDescription>{t('notificationPrefs.quietHoursDesc', { defaultValue: 'No notifications are created for you during this window (UTC).' })}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <h4 className="mb-2 text-sm font-medium text-hextech-text-bright">{t('notificationPrefs.muteByType', { defaultValue: 'Mute by type' })}</h4>
          <div className="flex flex-wrap gap-2">
            {NOTIFICATION_TYPES.map((type) => {
              const muted = prefs.mutedTypes.includes(type)
              return (
                <button
                  key={type}
                  onClick={() => toggleType(type)}
                  className={`rounded px-2 py-1 text-xs font-medium ${muted ? 'bg-hextech-text-dim/10 text-hextech-text-dim line-through' : 'bg-hextech-gold/10 text-hextech-gold'}`}
                >
                  {t(`notifications.types.${type}.title`)}
                </button>
              )
            })}
          </div>
        </div>
        <div>
          <h4 className="mb-2 text-sm font-medium text-hextech-text-bright">{t('notificationPrefs.quietHours', { defaultValue: 'Quiet hours' })}</h4>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1 text-sm text-hextech-text">
              {t('notificationPrefs.from', { defaultValue: 'From' })}
              <Input type="time" value={prefs.quietStart ?? ''} onChange={(e) => setPrefs((p) => p && ({ ...p, quietStart: e.target.value || null }))} className="w-28" />
            </label>
            <label className="flex items-center gap-1 text-sm text-hextech-text">
              {t('notificationPrefs.to', { defaultValue: 'To' })}
              <Input type="time" value={prefs.quietEnd ?? ''} onChange={(e) => setPrefs((p) => p && ({ ...p, quietEnd: e.target.value || null }))} className="w-28" />
            </label>
            {(prefs.quietStart || prefs.quietEnd) && (
              <Button size="sm" variant="ghost" onClick={() => setPrefs((p) => p && ({ ...p, quietStart: null, quietEnd: null }))}>
                {t('notificationPrefs.quietHoursDisabled', { defaultValue: 'Disabled' })}
              </Button>
            )}
          </div>
        </div>
        <Button size="sm" onClick={save} disabled={saving}>
          {saving && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}{t('notificationPrefs.save', { defaultValue: 'Save preferences' })}
        </Button>
      </CardContent>
    </Card>
  )
}
