import { useTranslation } from 'react-i18next'
import { Download } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useLatestRelease } from './useLatestRelease'

/** Download link to the newest Ascend for Windows installer. */
export function DownloadButton({ className, compact }: { className?: string; compact?: boolean }) {
  const { t } = useTranslation()
  const { url, version } = useLatestRelease()
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-md bg-hextech-gold/90 px-3 py-2 text-sm font-medium text-hextech-black hover:bg-hextech-gold',
        className,
      )}
    >
      <Download className="h-4 w-4" />
      {compact ? t('web.download.short') : t('web.download.full')}
      {version && !compact && <span className="text-xs opacity-70">v{version}</span>}
    </a>
  )
}
