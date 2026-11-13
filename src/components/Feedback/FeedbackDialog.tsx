import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bug, Lightbulb, Loader2, MessageSquarePlus, Send } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useToast } from '@/hooks/useToast'
import { cn } from '@/lib/utils'
import { collectDiagnostics, currentRoute } from '@/lib/diagnostics'
import type { FeedbackItem, FeedbackKind } from '@/lib/feedback'

/**
 * "Report a bug / Suggest a feature". Reports go to the developer's
 * Supabase table; the player sees their status here.
 */
export function FeedbackDialog({ open, onOpenChange, initialKind = 'bug' }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialKind?: FeedbackKind
}) {
  const { t, i18n } = useTranslation()
  const { toast } = useToast()
  const [kind, setKind] = useState<FeedbackKind>(initialKind)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [expected, setExpected] = useState('')
  const [attach, setAttach] = useState(true)
  const [busy, setBusy] = useState(false)
  const [history, setHistory] = useState<FeedbackItem[]>([])

  useEffect(() => {
    if (!open) return
    setKind(initialKind)
    window.api.feedbackList().then(setHistory).catch(() => setHistory([]))
  }, [open, initialKind])

  const valid = title.trim().length >= 3 && description.trim().length >= 10

  const send = async () => {
    setBusy(true)
    try {
      const item = await window.api.feedbackSend({
        kind,
        title,
        description,
        expected: kind === 'bug' ? expected : null,
        route: currentRoute(),
        diagnostics: kind === 'bug' && attach ? collectDiagnostics() : null,
      })
      setHistory((h) => [item, ...h])
      setTitle(''); setDescription(''); setExpected('')
      toast({ title: t('feedback.sent'), description: t('feedback.sentDesc'), variant: 'gold' })
      onOpenChange(false)
    } catch (err) {
      const msg = (err as Error)?.message ?? ''
      toast({
        title: msg.includes('FEEDBACK_RATE_LIMITED') ? t('feedback.rateLimited') : msg.includes('LOGIN_REQUIRED') ? t('coaching.errors.LOGIN_REQUIRED') : t('feedback.failed'),
        variant: 'destructive',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('feedback.title')}</DialogTitle>
          <DialogDescription>{t('feedback.desc')}</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-2">
          {([['bug', Bug, 'feedback.kinds.bug'], ['feature', Lightbulb, 'feedback.kinds.feature']] as const).map(([k, Icon, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={cn('flex items-center justify-center gap-2 rounded-lg border p-3 text-sm',
                kind === k ? 'border-hextech-gold bg-hextech-gold/10 text-hextech-gold' : 'border-hextech-border-dim hover:border-hextech-gold/40')}
            >
              <Icon className="h-4 w-4" />{t(label)}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="fb-title">{t('feedback.fields.title')}</Label>
            <Input id="fb-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={140}
              placeholder={t(kind === 'bug' ? 'feedback.placeholders.bugTitle' : 'feedback.placeholders.featureTitle')} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="fb-desc">{t(kind === 'bug' ? 'feedback.fields.whatHappened' : 'feedback.fields.idea')}</Label>
            <Textarea id="fb-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={5} maxLength={8000}
              placeholder={t(kind === 'bug' ? 'feedback.placeholders.bugSteps' : 'feedback.placeholders.featureWhy')} />
          </div>
          {kind === 'bug' && (
            <>
              <div className="space-y-1">
                <Label htmlFor="fb-expected">{t('feedback.fields.expected')}</Label>
                <Textarea id="fb-expected" value={expected} onChange={(e) => setExpected(e.target.value)} rows={2} maxLength={4000} />
              </div>
              <label className="flex items-start justify-between gap-3 text-sm">
                <span>
                  {t('feedback.attach')}
                  <span className="block text-xs text-hextech-text-dim">{t('feedback.attachHint')}</span>
                </span>
                <Switch checked={attach} onCheckedChange={setAttach} />
              </label>
            </>
          )}
          <Button className="w-full gap-2" disabled={!valid || busy} onClick={send}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}{t('feedback.send')}
          </Button>
        </div>

        {history.length > 0 && (
          <div className="space-y-2 border-t border-hextech-border-dim pt-3">
            <div className="text-xs font-medium text-hextech-text-bright">{t('feedback.history')}</div>
            <ul className="space-y-1 text-xs">
              {history.slice(0, 8).map((h) => (
                <li key={h.id} className="rounded bg-hextech-elevated/30 px-2 py-1.5">
                  <div className="flex items-center gap-2">
                    {h.kind === 'bug' ? <Bug className="h-3 w-3 shrink-0" /> : <Lightbulb className="h-3 w-3 shrink-0" />}
                    <span className="truncate">{h.title}</span>
                    <span className="ml-auto shrink-0 text-hextech-gold">{t(`feedback.status.${h.status}`)}</span>
                  </div>
                  {h.devNote && <p className="mt-1 text-hextech-text-dim">↳ {h.devNote}</p>}
                  <div className="text-[10px] text-hextech-text-dim">{new Date(h.createdAt).toLocaleDateString(i18n.language)}</div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Compact trigger used in the sidebars. */
export function FeedbackButton({ className }: { className?: string }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className={cn('flex items-center gap-1.5 text-xs text-hextech-text-dim hover:text-hextech-gold', className)}>
        <MessageSquarePlus className="h-3.5 w-3.5" />{t('feedback.button')}
      </button>
      <FeedbackDialog open={open} onOpenChange={setOpen} />
    </>
  )
}
