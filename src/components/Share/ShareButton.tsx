import { useState, useRef, useEffect } from 'react'
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
      toast({ title: `📨 Sent to "${wh.name}"`, variant: 'gold' })
    } catch (err: any) {
      toast({
        title: 'Webhook failed — copied to clipboard instead',
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
      toast({ title: '📋 Copied to clipboard', description: 'Paste it anywhere — Discord, Notion, messages…', variant: 'gold' })
    } catch {
      toast({ title: 'Copy failed', variant: 'destructive' })
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
    if (sendingId) return 'Sending…'
    if (copying) return 'Copying…'
    if (!hasWebhooks) return 'Copy'
    if (webhooks.length === 1) return 'Share'
    return 'Share'
  }

  return (
    <div ref={ref} className={cn('relative inline-flex', className)}>
      {/* Main action button */}
      <button
        onClick={handleMainClick}
        disabled={isBusy}
        className="flex items-center gap-1.5 rounded-l-md border border-hextech-border-dim bg-hextech-elevated px-3 py-1.5 text-xs font-medium text-hextech-text hover:text-hextech-gold hover:border-hextech-gold/40 transition-colors disabled:opacity-50"
      >
        {isBusy
          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
          : <Share2 className="h-3.5 w-3.5" />}
        {mainLabel()}
      </button>

      {/* Dropdown toggle */}
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={isBusy}
        className="flex items-center rounded-r-md border border-l-0 border-hextech-border-dim bg-hextech-elevated px-1.5 py-1.5 text-hextech-text-dim hover:text-hextech-text hover:border-hextech-gold/40 transition-colors disabled:opacity-50"
      >
        <ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} />
      </button>

      {/* Dropdown menu */}
      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-50 w-56 rounded-lg border border-hextech-border-dim bg-hextech-dark shadow-xl overflow-hidden">

          {/* Webhook entries */}
          {hasWebhooks ? (
            <>
              <div className="px-3 pt-2.5 pb-1">
                <p className="text-[9px] font-semibold uppercase tracking-wider text-hextech-text-dim/70">
                  Send to Discord
                </p>
              </div>
              {webhooks.map((wh) => (
                <button
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
                No Discord webhook configured.{' '}
                <span className="text-hextech-gold/70">Add one in Settings.</span>
              </p>
            </div>
          )}

          {/* Copy as text */}
          <button
            onClick={handleCopy}
            className="w-full flex items-center gap-2.5 px-3 py-2 pb-2.5 text-sm text-left transition-colors hover:bg-white/5"
          >
            <Copy className="h-3.5 w-3.5 text-hextech-text-dim shrink-0" />
            <div>
              <p className="font-medium text-hextech-text-bright text-xs">Copy as text</p>
              <p className="text-[10px] text-hextech-text-dim">Markdown — paste anywhere</p>
            </div>
          </button>
        </div>
      )}
    </div>
  )
}
