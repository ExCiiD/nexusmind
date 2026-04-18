import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useShareSession, type ShareSessionData } from '@/hooks/useShareSession'
import { useDiscordWebhooks, type DiscordWebhook } from '@/hooks/useDiscordWebhooks'
import { useToast } from '@/hooks/useToast'
import { Button } from '@/components/ui/button'
import { Loader2, Send, X, Layers, FileText, Settings } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { cn } from '@/lib/utils'

type ShareMode = 'session' | 'with-reviews'

interface Props {
  data: ShareSessionData
  open: boolean
  onClose: () => void
}

export function ShareSessionDialog({ data, open, onClose }: Props) {
  const { t } = useTranslation()
  const { buildEmbeds, buildEmbedsSessionOnly } = useShareSession()
  const { webhooks, loading: loadingWebhooks } = useDiscordWebhooks()
  const { toast } = useToast()
  const navigate = useNavigate()

  const [mode, setMode] = useState<ShareMode>('session')
  const [selectedWebhookId, setSelectedWebhookId] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  if (!open) return null

  const selectedWebhook: DiscordWebhook | undefined =
    webhooks.find((w) => w.id === selectedWebhookId) ?? webhooks[0]

  const handleSend = async () => {
    if (!selectedWebhook) return
    setSending(true)
    try {
      const embeds = mode === 'session'
        ? buildEmbedsSessionOnly(data)
        : buildEmbeds(data)
      await window.api.sendToDiscord(embeds, selectedWebhook.url)
      toast({ title: t('session.shareDialog.sent', { name: selectedWebhook.name }), variant: 'gold' })
      onClose()
    } catch (err: any) {
      toast({ title: t('session.shareDialog.failed'), description: err?.message, variant: 'destructive' })
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md mx-4 rounded-xl border border-hextech-border bg-hextech-dark shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <div>
            <h2 className="font-display text-base font-bold text-hextech-gold-bright">
              {t('session.shareDialog.title')}
            </h2>
            <p className="text-xs text-hextech-text-dim mt-0.5">
              {t('session.shareDialog.subtitle')}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-hextech-text-dim hover:text-hextech-text transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 pb-5 space-y-4">
          {/* Mode picker */}
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-hextech-text-dim">
              {t('session.shareDialog.modeLabel')}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setMode('session')}
                className={cn(
                  'flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors',
                  mode === 'session'
                    ? 'border-hextech-gold/60 bg-hextech-gold/10'
                    : 'border-hextech-border-dim bg-hextech-elevated/40 hover:border-hextech-gold/30',
                )}
              >
                <div className="flex items-center gap-1.5">
                  <FileText className={cn('h-3.5 w-3.5', mode === 'session' ? 'text-hextech-gold' : 'text-hextech-text-dim')} />
                  <span className={cn('text-xs font-semibold', mode === 'session' ? 'text-hextech-gold-bright' : 'text-hextech-text')}>
                    {t('session.shareDialog.modeSession')}
                  </span>
                </div>
                <p className="text-[10px] text-hextech-text-dim leading-relaxed">
                  {t('session.shareDialog.modeSessionDesc')}
                </p>
              </button>

              <button
                onClick={() => setMode('with-reviews')}
                className={cn(
                  'flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors',
                  mode === 'with-reviews'
                    ? 'border-hextech-gold/60 bg-hextech-gold/10'
                    : 'border-hextech-border-dim bg-hextech-elevated/40 hover:border-hextech-gold/30',
                )}
              >
                <div className="flex items-center gap-1.5">
                  <Layers className={cn('h-3.5 w-3.5', mode === 'with-reviews' ? 'text-hextech-gold' : 'text-hextech-text-dim')} />
                  <span className={cn('text-xs font-semibold', mode === 'with-reviews' ? 'text-hextech-gold-bright' : 'text-hextech-text')}>
                    {t('session.shareDialog.modeWithReviews')}
                  </span>
                </div>
                <p className="text-[10px] text-hextech-text-dim leading-relaxed">
                  {t('session.shareDialog.modeWithReviewsDesc')}
                </p>
              </button>
            </div>
          </div>

          {/* Webhook picker */}
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-hextech-text-dim">
              {t('session.shareDialog.webhookLabel')}
            </p>

            {loadingWebhooks ? (
              <div className="flex items-center gap-2 text-xs text-hextech-text-dim py-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading…
              </div>
            ) : webhooks.length === 0 ? (
              <div className="rounded-lg border border-hextech-border-dim bg-hextech-elevated/40 p-3 flex items-start gap-2">
                <p className="text-xs text-hextech-text-dim flex-1">
                  {t('session.shareDialog.noWebhooks')}
                </p>
                <button
                  onClick={() => { onClose(); navigate('/settings') }}
                  className="shrink-0 text-hextech-gold text-xs hover:underline flex items-center gap-1"
                >
                  <Settings className="h-3 w-3" />Settings
                </button>
              </div>
            ) : (
              <div className="space-y-1.5">
                {webhooks.map((wh) => (
                  <button
                    key={wh.id}
                    onClick={() => setSelectedWebhookId(wh.id)}
                    className={cn(
                      'w-full flex items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-xs transition-colors',
                      (selectedWebhookId === wh.id || (!selectedWebhookId && wh === webhooks[0]))
                        ? 'border-hextech-gold/60 bg-hextech-gold/10 text-hextech-gold-bright'
                        : 'border-hextech-border-dim bg-hextech-elevated/40 text-hextech-text hover:border-hextech-gold/30',
                    )}
                  >
                    <div className="h-2 w-2 rounded-full bg-[#5865F2] shrink-0" />
                    <span className="font-medium truncate">{wh.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between pt-1">
            <Button variant="outline" size="sm" onClick={onClose} disabled={sending}>
              {t('session.shareDialog.cancel')}
            </Button>
            <Button
              size="sm"
              onClick={handleSend}
              disabled={sending || webhooks.length === 0}
              className="gap-1.5 bg-hextech-gold hover:bg-hextech-gold/90 text-hextech-dark font-semibold border-0"
            >
              {sending
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />{t('session.shareDialog.sending')}</>
                : <><Send className="h-3.5 w-3.5" />{t('session.shareDialog.send')}</>}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
