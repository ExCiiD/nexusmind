import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, UserCheck } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast } from '@/hooks/useToast'
import { useUserStore } from '@/store/useUserStore'
import { invalidateCached } from '@/lib/queryCache'

type Option = 'selfReview' | 'selfTagMistakes'

/**
 * DECISIONS 21/11: two per-user options for players who trust their own judgement over the engine.
 * - « Je fais mes reviews moi-même »: no micro-review box, Review opens on the recording; nothing of the micro-review
 *   is recorded for this user.
 * - « Je tague mes erreurs moi-même »: the Mistake Lab shows only their own tags; no auto-detected mistake recorded.
 * Turning one on asks first: the personal progression will then rest only on their own judgement.
 */
export function SelfJudgementCard() {
  const { t } = useTranslation()
  const { toast } = useToast()
  const user = useUserStore((s) => s.user)
  const refreshUser = useUserStore((s) => s.refreshUser)
  const [asking, setAsking] = useState<Option | null>(null)
  const [saving, setSaving] = useState(false)

  const save = async (option: Option, value: boolean) => {
    setSaving(true)
    try {
      await window.api.updateUser({ [option]: value })
      await refreshUser()
      invalidateCached('games:')
    } catch {
      toast({ title: t('settings.selfJudgement.saveFailed'), variant: 'destructive' })
    } finally {
      setSaving(false)
      setAsking(null)
    }
  }
  const onToggle = (option: Option, value: boolean) => {
    if (value) setAsking(option) // the warning first
    else void save(option, false)
  }

  const row = (option: Option) => (
    <div className="flex items-start justify-between gap-4">
      <div>
        <label htmlFor={`self-${option}`} className="text-sm font-medium text-hextech-text-bright">{t(`settings.selfJudgement.${option}.title`)}</label>
        <p id={`self-${option}-desc`} className="mt-0.5 text-xs text-hextech-text-dim">{t(`settings.selfJudgement.${option}.desc`)}</p>
      </div>
      <Switch id={`self-${option}`} checked={!!user?.[option]} disabled={saving || !user} onCheckedChange={(v) => onToggle(option, v)}
        aria-describedby={`self-${option}-desc`} className="mt-0.5" />
    </div>
  )

  return (
    <Card data-testid="self-judgement-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><UserCheck className="h-5 w-5 text-hextech-gold" />{t('settings.selfJudgement.title')}</CardTitle>
        <CardDescription>{t('settings.selfJudgement.subtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {row('selfReview')}
        {row('selfTagMistakes')}
      </CardContent>
      <Dialog open={asking !== null} onOpenChange={(o) => { if (!o) setAsking(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-hextech-gold" />{t('settings.selfJudgement.warnTitle')}</DialogTitle>
            <DialogDescription>{asking && t(`settings.selfJudgement.${asking}.warn`)}</DialogDescription>
          </DialogHeader>
          <p className="text-sm text-hextech-text">{t('settings.selfJudgement.warnProgress')}</p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setAsking(null)} disabled={saving}>{t('common.cancel')}</Button>
            <Button onClick={() => asking && save(asking, true)} disabled={saving}>{t('settings.selfJudgement.confirm')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
