import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Send,
  Upload,
  Loader2,
  Check,
  Copy,
  ExternalLink,
  AlertCircle,
  Clock,
} from 'lucide-react'

interface Webhook {
  id: string
  name: string
  url: string
}

interface ClipSharePanelProps {
  filePath: string
  fileSize: number
  title?: string
  /** Called after a successful temp upload or direct Discord send */
  onShared?: (url?: string) => void
}

type ShareStrategy = 'discord_direct' | 'temp_upload'
type UploadState = 'idle' | 'uploading' | 'done' | 'error'

const MAX_DISCORD_BYTES = 8 * 1024 * 1024 // 8 MB

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function ClipSharePanel({ filePath, fileSize, title, onShared }: ClipSharePanelProps) {
  const strategy: ShareStrategy = fileSize <= MAX_DISCORD_BYTES ? 'discord_direct' : 'temp_upload'

  const [webhooks, setWebhooks] = useState<Webhook[]>([])
  const [selectedWebhook, setSelectedWebhook] = useState<string>('')
  const [expiryHours, setExpiryHours] = useState<1 | 12 | 24 | 72>(24)
  const [caption, setCaption] = useState(title ?? '')
  const [uploadState, setUploadState] = useState<UploadState>('idle')
  const [tempUrl, setTempUrl] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    window.api.listWebhooks().then((hooks: Webhook[]) => {
      setWebhooks(hooks)
      if (hooks.length > 0) setSelectedWebhook(hooks[0].url)
    }).catch(() => {})
  }, [])

  const handleShare = async () => {
    setUploadState('uploading')
    setErrorMsg(null)
    try {
      if (strategy === 'discord_direct') {
        if (!selectedWebhook) throw new Error('No webhook selected')
        await (window.api as any).sendFileToDiscord(filePath, selectedWebhook, caption || undefined)
        setUploadState('done')
        onShared?.()
      } else {
        // Upload to temp host first, then optionally send link to Discord
        const result = await (window.api as any).uploadToTemp(filePath, expiryHours)
        setTempUrl(result.url)
        setUploadState('done')

        // Send link to Discord if a webhook is selected
        if (selectedWebhook) {
          const embedContent = [
            caption ? `**${caption}**` : '',
            `Video: ${result.url}`,
            `Expires in ${expiryHours}h`,
          ].filter(Boolean).join('\n')

          await window.api.sendToDiscord(
            [{
              description: embedContent,
              color: 0xC89B3C,
              footer: { text: 'NexusMind Clip' },
              timestamp: new Date().toISOString(),
            }],
            selectedWebhook,
          )
        }
        onShared?.(result.url)
      }
    } catch (err: any) {
      setErrorMsg(translateError(err?.message ?? String(err)))
      setUploadState('error')
    }
  }

  const handleCopy = () => {
    if (tempUrl) {
      navigator.clipboard.writeText(tempUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div className="space-y-3">
      {/* Strategy badge + file size */}
      <div className="flex items-center gap-2">
        <Badge
          variant="outline"
          className={strategy === 'discord_direct'
            ? 'text-hextech-teal border-hextech-teal/30 text-[10px]'
            : 'text-orange-400 border-orange-400/30 text-[10px]'}
        >
          {strategy === 'discord_direct' ? '✓ Direct Discord upload' : '⤴ Temp host → Discord link'}
        </Badge>
        <span className="text-[10px] text-hextech-text-dim">{formatBytes(fileSize)}</span>
      </div>

      {/* Caption */}
      <label className="block space-y-1">
        <span className="text-[10px] text-hextech-text-dim">Caption (optional)</span>
        <input
          type="text"
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          placeholder="e.g. 'Sick teamfight'"
          maxLength={200}
          className="w-full rounded border border-hextech-border-dim bg-hextech-elevated px-2 py-1.5 text-xs text-hextech-text"
        />
      </label>

      {/* Expiry selector (temp upload only) */}
      {strategy === 'temp_upload' && (
        <div className="space-y-1">
          <p className="text-[10px] text-hextech-text-dim">Link expiry</p>
          <div className="flex gap-1.5">
            {([1, 12, 24, 72] as const).map((h) => (
              <button
                key={h}
                onClick={() => setExpiryHours(h)}
                className={`flex-1 rounded border px-2 py-1 text-[11px] font-medium transition-colors ${
                  expiryHours === h
                    ? 'border-hextech-gold bg-hextech-gold/10 text-hextech-gold-bright'
                    : 'border-hextech-border-dim text-hextech-text-dim hover:border-hextech-gold/40'
                }`}
              >
                {h}h
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Webhook selector */}
      {webhooks.length > 0 ? (
        <div className="space-y-1">
          <p className="text-[10px] text-hextech-text-dim">
            {strategy === 'discord_direct' ? 'Send to webhook' : 'Also notify webhook (optional)'}
          </p>
          <select
            value={selectedWebhook}
            onChange={(e) => setSelectedWebhook(e.target.value)}
            className="w-full rounded border border-hextech-border-dim bg-hextech-elevated px-2 py-1.5 text-xs text-hextech-text"
          >
            {strategy === 'temp_upload' && <option value="">— None —</option>}
            {webhooks.map((w) => (
              <option key={w.id} value={w.url}>{w.name}</option>
            ))}
          </select>
        </div>
      ) : strategy === 'discord_direct' ? (
        <p className="text-[10px] text-orange-400/80">
          No webhooks configured. Add one in Settings → Discord.
        </p>
      ) : null}

      {/* Error */}
      {uploadState === 'error' && errorMsg && (
        <div className="flex items-center gap-2 rounded-md bg-red-500/10 border border-red-500/30 px-2.5 py-2 text-xs text-red-400">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          {errorMsg}
        </div>
      )}

      {/* Success: temp link */}
      {uploadState === 'done' && tempUrl && (
        <div className="rounded-md border border-hextech-teal/30 bg-hextech-teal/5 px-2.5 py-2 space-y-1.5">
          <div className="flex items-center gap-2">
            <Clock className="h-3 w-3 text-hextech-teal shrink-0" />
            <p className="text-[10px] text-hextech-text-dim">Expires in {expiryHours}h</p>
          </div>
          <p className="text-xs text-hextech-teal truncate font-mono">{tempUrl}</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="flex-1 h-7 text-xs gap-1" onClick={handleCopy}>
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              {copied ? 'Copied!' : 'Copy link'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={() => window.open(tempUrl, '_blank')}
            >
              <ExternalLink className="h-3 w-3" />
            </Button>
          </div>
        </div>
      )}

      {/* Success: direct upload */}
      {uploadState === 'done' && !tempUrl && (
        <div className="flex items-center gap-2 rounded-md bg-green-500/10 border border-green-500/30 px-2.5 py-2 text-xs text-green-400">
          <Check className="h-3.5 w-3.5 shrink-0" />
          Sent to Discord!
        </div>
      )}

      {/* Action button */}
      {uploadState !== 'done' && (
        <Button
          className="w-full gap-2"
          size="sm"
          disabled={
            uploadState === 'uploading' ||
            (strategy === 'discord_direct' && !selectedWebhook)
          }
          onClick={handleShare}
        >
          {uploadState === 'uploading' ? (
            <><Loader2 className="h-4 w-4 animate-spin" />Uploading…</>
          ) : strategy === 'discord_direct' ? (
            <><Send className="h-4 w-4" />Send to Discord</>
          ) : (
            <><Upload className="h-4 w-4" />Upload & Share</>
          )}
        </Button>
      )}

      {/* Retry */}
      {uploadState === 'error' && (
        <Button variant="ghost" size="sm" className="w-full text-xs" onClick={() => setUploadState('idle')}>
          Retry
        </Button>
      )}
    </div>
  )
}

function translateError(msg: string): string {
  if (msg.includes('FILE_TOO_LARGE')) return 'File exceeds Discord 8 MB limit. Use the temp upload option.'
  if (msg.includes('FILE_NOT_FOUND')) return 'Video file not found on disk.'
  if (msg.includes('INVALID_WEBHOOK_URL')) return 'Invalid Discord webhook URL.'
  if (msg.includes('No webhook selected')) return 'Please select a Discord webhook first.'
  if (msg.includes('Litterbox')) return 'Temp upload failed. Check your internet connection and try again.'
  return msg.length > 120 ? `${msg.slice(0, 120)}…` : msg
}
