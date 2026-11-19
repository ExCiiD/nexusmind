import { useState } from 'react'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation()
  const { toast } = useToast()
  const { buildText } = useShareSession()

  const [dialogOpen, setDialogOpen] = useState(false)
  const [copying, setCopying] = useState(false)

  const handleCopy = async () => {
    setCopying(true)
    try {
      await window.api.copyReviewText(buildText(data))
      toast({ title: t('share.button.sessionCopied'), description: t('share.button.pasteAnywhere'), variant: 'gold' })
    } catch {
      toast({ title: t('share.button.copyFailed'), variant: 'destructive' })
    } finally {
      setCopying(false)
    }
  }

  return (
    <>
      <div className={cn('relative inline-flex', className)}>
        {/* Main share button — opens the dialog */}
        <button
          type="button"
          onClick={() => setDialogOpen(true)}
          disabled={copying}
          aria-haspopup="dialog"
          className="flex items-center gap-1.5 rounded-l-md border border-hextech-border-dim bg-hextech-elevated px-3 py-1.5 text-xs font-medium text-hextech-text hover:text-hextech-gold hover:border-hextech-gold/40 transition-colors disabled:opacity-50"
        >
          <Share2 className="h-3.5 w-3.5" aria-hidden />
          {t('share.button.share')}
        </button>

        {/* Copy-as-text fallback button */}
        <button
          type="button"
          onClick={handleCopy}
          disabled={copying}
          title={t('share.button.copyAsText')}
          aria-label={t('share.button.copyAsText')}
          className="flex items-center rounded-r-md border border-l-0 border-hextech-border-dim bg-hextech-elevated px-1.5 py-1.5 text-hextech-text-dim hover:text-hextech-text hover:border-hextech-gold/40 transition-colors disabled:opacity-50"
        >
          {copying
            ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            : <Copy className="h-3 w-3" aria-hidden />}
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
