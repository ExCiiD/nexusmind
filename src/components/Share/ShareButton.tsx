import { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useShareReview, type ShareReviewData } from '@/hooks/useShareReview'
import { useDiscordWebhooks, type DiscordWebhook } from '@/hooks/useDiscordWebhooks'
import { useToast } from '@/hooks/useToast'
import { Share2, ChevronDown, Copy, Loader2, ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Props {
  data: ShareReviewData
  className?: string
}

export function ShareButton({ data, className }: Props) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const { buildEmbed, buildText } = useShareReview()
  const { webhooks } = useDiscordWebhooks()

  const [open, setOpen] = useState(false)
  const [sendingId, setSendingId] = useState<string | null>(null)
  const [copying, setCopying] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const hasWebhooks = webhooks.length > 0
  const isBusy = sendingId !== null || copying

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const sendToWebhook = async (wh: DiscordWebhook) => {
    setOpen(false)
    setSendingId(wh.id)
    try {
      const embed = buildEmbed(data)
      await window.api.sendToDiscord([embed], wh.url)
      toast({ title: t('share.button.sentTo', { name: wh.name }), variant: 'gold' })
    } catch (err: any) {
      toast({
        title: t('share.button.webhookFailed'),
        description: err.message,
        variant: 'destructive',
      })
      await window.api.copyReviewText(buildText(data)).catch(() => {})
    } finally {
      setSendingId(null)
    }
  }

  const handleCopy = async () => {
    setOpen(false)
    setCopying(true)
    try {
      await window.api.copyReviewText(buildText(data))
      toast({ title: t('share.button.copied'), description: t('share.button.pasteAnywhere'), variant: 'gold' })
    } catch {
      toast({ title: t('share.button.copyFailed'), variant: 'destructive' })
    } finally {
      setCopying(false)
    }
  }

  /** Quick-action on the main button click. */
  const handleMainClick = () => {
    if (!hasWebhooks) { handleCopy(); return }
    if (webhooks.length === 1) { sendToWebhook(webhooks[0]); return }
    // Multiple webhooks → open the picker dropdown
    setOpen((v) => !v)
  }

  const mainLabel = () => {
    if (sendingId) return t('share.button.sending')
    if (copying) return t('share.button.copying')
    if (!hasWebhooks) return t('share.button.copy')
    return t('share.button.share')
  }

  return (
    <div ref={ref} className={cn('relative inline-flex', className)}>
      {/* Main action button */}
      <button
        type="button"
        onClick={handleMainClick}
        disabled={isBusy}
        className="flex items-center gap-1.5 rounded-l-md border border-hextech-border-dim bg-hextech-elevated px-3 py-1.5 text-xs font-medium text-hextech-text hover:text-hextech-gold hover:border-hextech-gold/40 transition-colors disabled:opacity-50"
      >
        {isBusy
          ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          : <Share2 className="h-3.5 w-3.5" aria-hidden />}
        {mainLabel()}
      </button>

      {/* Dropdown toggle */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={isBusy}
        aria-label={t('share.button.moreOptions')}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center rounded-r-md border border-l-0 border-hextech-border-dim bg-hextech-elevated px-1.5 py-1.5 text-hextech-text-dim hover:text-hextech-text hover:border-hextech-gold/40 transition-colors disabled:opacity-50"
      >
        <ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} aria-hidden />
      </button>

      {/* Dropdown menu */}
      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-50 w-56 rounded-lg border border-hextech-border-dim bg-hextech-dark shadow-xl overflow-hidden">

          {/* Webhook entries */}
          {hasWebhooks ? (
            <>
              <div className="px-3 pt-2.5 pb-1">
                <p className="text-[9px] font-semibold uppercase tracking-wider text-hextech-text-dim/70">
                  {t('share.button.sendToDiscord')}
                </p>
              </div>
              {webhooks.map((wh) => (
                <button
                  type="button"
                  key={wh.id}
                  onClick={() => sendToWebhook(wh)}
                  disabled={sendingId === wh.id}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left transition-colors hover:bg-white/5 disabled:opacity-50"
                >
                  {sendingId === wh.id
                    ? <Loader2 className="h-3.5 w-3.5 text-[#5865F2] shrink-0 animate-spin" />
                    : <ExternalLink className="h-3.5 w-3.5 text-[#5865F2] shrink-0" />}
                  <span className="text-xs font-medium text-hextech-text-bright truncate">{wh.name}</span>
                </button>
              ))}
              <div className="h-px bg-hextech-border-dim/60 mx-2 my-1" />
            </>
          ) : (
            <div className="px-3 py-2.5">
              <p className="text-[10px] text-hextech-text-dim/70">
                {t('share.button.noWebhook')}{' '}
                <span className="text-hextech-gold/70">{t('share.button.addInSettings')}</span>
              </p>
            </div>
          )}

          {/* Copy as text */}
          <button
            type="button"
            onClick={handleCopy}
            className="w-full flex items-center gap-2.5 px-3 py-2 pb-2.5 text-sm text-left transition-colors hover:bg-white/5"
          >
            <Copy className="h-3.5 w-3.5 text-hextech-text-dim shrink-0" aria-hidden />
            <div>
              <p className="font-medium text-hextech-text-bright text-xs">{t('share.button.copyAsText')}</p>
              <p className="text-[10px] text-hextech-text-dim">{t('share.button.copyAsTextHint')}</p>
            </div>
          </button>
        </div>
      )}
    </div>
  )
}
