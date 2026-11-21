import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast } from '@/hooks/useToast'
import type { DiscordWebhook } from '@/lib/ipc'

/**
 * « Envoyer sur Discord » (Chief, 21/11): the clip's YouTube link to a webhook the player picks (the same webhooks as
 * ClipSharePanel). Never automatic: only on this button.
 */
export function DiscordLinkDialog({ url, title, onClose }: { url: string; title: string; onClose: () => void }) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [hooks, setHooks] = useState<DiscordWebhook[] | null>(null)
  const [picked, setPicked] = useState('')
  const [sending, setSending] = useState(false)
  useEffect(() => {
    window.api.listWebhooks().then((l) => { setHooks(l); setPicked(l[0]?.id ?? '') }).catch(() => setHooks([]))
  }, [])

  const send = async () => {
    const hook = hooks?.find((h) => h.id === picked)
    if (!hook) return
    setSending(true)
    try {
      await window.api.sendToDiscord([{ title, url, description: url }], hook.url)
      toast({ title: t('recording.clip.discordSent', { name: hook.name }), variant: 'gold' })
      onClose()
    } catch {
      toast({ title: t('recording.clip.discordFailed'), variant: 'destructive' })
    } finally {
      setSending(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-md" data-testid="discord-link-dialog">
        <DialogHeader>
          <DialogTitle>{t('recording.clip.discord')}</DialogTitle>
          <DialogDescription className="break-all font-mono text-xs">{url}</DialogDescription>
        </DialogHeader>
        {hooks === null ? (
          <Loader2 className="h-5 w-5 animate-spin text-hextech-gold" />
        ) : hooks.length === 0 ? (
          <p className="text-sm text-hextech-text-dim">{t('recording.clip.noWebhook')}</p>
        ) : (
          <div className="space-y-3">
            <select value={picked} onChange={(e) => setPicked(e.target.value)} aria-label={t('recording.clip.webhook')}
              className="w-full rounded-md border border-hextech-border-dim bg-hextech-elevated px-2 py-2 text-sm text-hextech-text">
              {hooks.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={onClose} disabled={sending}>{t('common.cancel')}</Button>
              <Button size="sm" onClick={() => void send()} disabled={!picked || sending}>
                {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t('recording.clip.discordSend')}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
