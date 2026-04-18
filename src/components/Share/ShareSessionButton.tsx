import { useState } from 'react'
import { useShareSession, type ShareSessionData } from '@/hooks/useShareSession'
import { useToast } from '@/hooks/useToast'
import { Share2, Copy, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ShareSessionDialog } from './ShareSessionDialog'

interface Props {
  data: ShareSessionData
  className?: string
}

export function ShareSessionButton({ data, className }: Props) {
  const { toast } = useToast()
  const { buildText } = useShareSession()

  const [dialogOpen, setDialogOpen] = useState(false)
  const [copying, setCopying] = useState(false)

  const handleCopy = async () => {
    setCopying(true)
    try {
      await window.api.copyReviewText(buildText(data))
      toast({ title: '📋 Session copied to clipboard', description: 'Paste it anywhere — Discord, Notion, messages…', variant: 'gold' })
    } catch {
      toast({ title: 'Copy failed', variant: 'destructive' })
    } finally {
      setCopying(false)
    }
  }

  return (
    <>
      <div className={cn('relative inline-flex', className)}>
        {/* Main share button — opens the dialog */}
        <button
          onClick={() => setDialogOpen(true)}
          disabled={copying}
          className="flex items-center gap-1.5 rounded-l-md border border-hextech-border-dim bg-hextech-elevated px-3 py-1.5 text-xs font-medium text-hextech-text hover:text-hextech-gold hover:border-hextech-gold/40 transition-colors disabled:opacity-50"
        >
          <Share2 className="h-3.5 w-3.5" />
          Share
        </button>

        {/* Copy-as-text fallback button */}
        <button
          onClick={handleCopy}
          disabled={copying}
          title="Copy as text"
          className="flex items-center rounded-r-md border border-l-0 border-hextech-border-dim bg-hextech-elevated px-1.5 py-1.5 text-hextech-text-dim hover:text-hextech-text hover:border-hextech-gold/40 transition-colors disabled:opacity-50"
        >
          {copying
            ? <Loader2 className="h-3 w-3 animate-spin" />
            : <Copy className="h-3 w-3" />}
        </button>
      </div>

      <ShareSessionDialog
        data={data}
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
      />
    </>
  )
}
