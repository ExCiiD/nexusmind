import { useEffect, useState } from 'react'
import { Download, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTranslation } from 'react-i18next'

type UpdateState = 'idle' | 'available' | 'downloading' | 'downloaded'

export function UpdateBanner() {
  const { t } = useTranslation()
  const [state, setState] = useState<UpdateState>('idle')
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    if (!window.api.onUpdateAvailable || !window.api.onUpdateDownloaded) return

    const onAvailable = () => setState('downloading')
    const onProgress = (percent: number) => {
      setProgress(percent)
      setState('downloading')
    }
    const onDownloaded = () => setState('downloaded')

    const offAvailable = window.api.onUpdateAvailable(onAvailable)
    const offProgress = window.api.onUpdateProgress?.(onProgress)
    const offDownloaded = window.api.onUpdateDownloaded(onDownloaded)
    return () => { offAvailable(); offProgress?.(); offDownloaded() }
  }, [])

  if (state === 'idle') return null

  const isDownloaded = state === 'downloaded'
  const isDownloading = state === 'downloading'

  return (
    <div className="fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-lg border border-hextech-gold/40 bg-hextech-bg/95 backdrop-blur px-4 py-3 shadow-lg max-w-sm animate-in slide-in-from-bottom-2">
      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${isDownloaded ? 'bg-hextech-green/15' : 'bg-hextech-gold/10'}`}>
        {isDownloaded
          ? <RefreshCw className="h-4 w-4 text-hextech-green" />
          : <Download className="h-4 w-4 text-hextech-gold animate-bounce" />
        }
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-hextech-text-bright">
          {isDownloaded ? t('update.readyTitle') : t('update.availableTitle')}
        </p>
        {isDownloading ? (
          <div className="mt-1.5 space-y-1">
            <div className="h-1.5 w-full rounded-full bg-hextech-gold/10 overflow-hidden">
              <div
                className="h-full rounded-full bg-hextech-gold transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-xs text-hextech-text-dim">{progress}%</p>
          </div>
        ) : (
          <p className="text-xs text-hextech-text-dim">
            {isDownloaded ? t('update.readyDesc') : t('update.availableDesc')}
          </p>
        )}
      </div>
      {isDownloaded && (
        <Button
          size="sm"
          className="h-7 text-xs shrink-0"
          onClick={() => window.api.installUpdate?.()}
        >
          {t('update.restart')}
        </Button>
      )}
    </div>
  )
}
