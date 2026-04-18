import { useEffect, useState } from 'react'
import { Download, RefreshCw, AlertTriangle, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTranslation } from 'react-i18next'

type UpdateState = 'idle' | 'available' | 'downloading' | 'downloaded' | 'error'

export function UpdateBanner() {
  const { t } = useTranslation()
  const [state, setState] = useState<UpdateState>('idle')
  const [progress, setProgress] = useState(0)
  const [errorMessage, setErrorMessage] = useState<string>('')
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (!window.api.onUpdateAvailable || !window.api.onUpdateDownloaded) return

    const onAvailable = () => {
      setDismissed(false)
      setState('downloading')
    }
    const onProgress = (percent: number) => {
      setProgress(percent)
      setState('downloading')
    }
    const onDownloaded = () => {
      setDismissed(false)
      setState('downloaded')
    }
    const onError = (message: string) => {
      setErrorMessage(message)
      setState('error')
    }

    const offAvailable = window.api.onUpdateAvailable(onAvailable)
    const offProgress = window.api.onUpdateProgress?.(onProgress)
    const offDownloaded = window.api.onUpdateDownloaded(onDownloaded)
    const offError = window.api.onUpdateError?.(onError)
    return () => { offAvailable(); offProgress?.(); offDownloaded(); offError?.() }
  }, [])

  if (state === 'idle' || dismissed) return null

  const isDownloaded = state === 'downloaded'
  const isDownloading = state === 'downloading'
  const isError = state === 'error'

  const borderClass = isError ? 'border-red-500/50' : 'border-hextech-gold/40'
  const iconBgClass = isError
    ? 'bg-red-500/15'
    : isDownloaded
      ? 'bg-hextech-green/15'
      : 'bg-hextech-gold/10'

  return (
    <div className={`fixed bottom-4 right-4 z-50 flex items-start gap-3 rounded-lg border ${borderClass} bg-hextech-bg/95 backdrop-blur px-4 py-3 shadow-lg max-w-sm animate-in slide-in-from-bottom-2`}>
      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${iconBgClass}`}>
        {isError
          ? <AlertTriangle className="h-4 w-4 text-red-400" />
          : isDownloaded
            ? <RefreshCw className="h-4 w-4 text-hextech-green" />
            : <Download className="h-4 w-4 text-hextech-gold animate-bounce" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-hextech-text-bright">
          {isError
            ? t('update.errorTitle', 'Update failed')
            : isDownloaded
              ? t('update.readyTitle')
              : t('update.availableTitle')}
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
        ) : isError ? (
          <p className="mt-1 text-xs text-hextech-text-dim break-words">
            {errorMessage || t('update.errorDesc', 'Could not download the update. Please try again later or download manually from GitHub.')}
          </p>
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
      {isError && (
        <button
          aria-label="Dismiss update error"
          className="app-no-drag shrink-0 rounded p-1 text-hextech-text-dim hover:text-hextech-text-bright hover:bg-hextech-elevated"
          onClick={() => setDismissed(true)}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}
