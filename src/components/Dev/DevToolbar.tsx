import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useSessionStore } from '@/store/useSessionStore'
import { Gamepad2, ChevronUp, ChevronDown, Loader2, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/useToast'
import { useTranslation } from 'react-i18next'

export function DevToolbar() {
  const { t } = useTranslation()
  const [isDevMode, setIsDevMode] = useState(false)
  const [open, setOpen] = useState(false)
  const [simulating, setSimulating] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const refreshSession = useSessionStore((s) => s.refreshSession)
  const { toast } = useToast()

  const PAGES = [
    { label: t('nav.dashboard'), path: '/' },
    { label: t('nav.session'), path: '/session' },
    { label: t('nav.review'), path: '/review' },
    { label: t('nav.analytics'), path: '/analytics' },
    { label: t('nav.history'), path: '/history' },
    { label: t('assessment.title'), path: '/assessment' },
  ]

  useEffect(() => {
    window.api.isDev().then(setIsDevMode).catch(() => {})
  }, [])

  if (!isDevMode) return null

  const handleSimulate = async () => {
    setSimulating(true)
    try {
      await window.api.simulateGame()
      await refreshSession()
      toast({ title: t('dev.toast.simTitle'), description: t('dev.toast.simDesc'), variant: 'gold' })
    } catch (err: any) {
      toast({ title: t('dev.toast.simError'), description: err.message, variant: 'destructive' })
    } finally {
      setSimulating(false)
    }
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2">
      {open && (
        <div className="w-64 rounded-lg border border-[#FF4655]/40 bg-hextech-dark shadow-xl overflow-hidden animate-fade-in">
          <div className="flex items-center gap-2 bg-[#FF4655]/10 px-3 py-2 border-b border-[#FF4655]/30">
            <Gamepad2 className="h-3.5 w-3.5 text-[#FF4655]" />
            <span className="text-xs font-bold text-[#FF4655] uppercase tracking-wider">{t('dev.title')}</span>
          </div>

          <div className="px-3 py-2 border-b border-hextech-border-dim">
            <p className="text-xs text-hextech-text-dim mb-1.5">{t('dev.quickNav')}</p>
            <div className="grid grid-cols-3 gap-1">
              {PAGES.map((page) => (
                <button
                  key={page.path}
                  onClick={() => navigate(page.path)}
                  className={cn(
                    'rounded px-2 py-1 text-xs transition-colors text-left',
                    location.pathname === page.path
                      ? 'bg-hextech-elevated text-hextech-gold-bright font-medium'
                      : 'text-hextech-text hover:bg-hextech-elevated/60',
                  )}
                >
                  {page.label}
                </button>
              ))}
            </div>
          </div>

          <div className="px-3 py-2 space-y-1.5">
            <p className="text-xs text-hextech-text-dim mb-1.5">{t('dev.actions')}</p>
            <button
              onClick={handleSimulate}
              disabled={simulating}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs text-hextech-text hover:bg-hextech-elevated/60 disabled:opacity-50 transition-colors"
            >
              {simulating
                ? <Loader2 className="h-3.5 w-3.5 animate-spin text-hextech-cyan" />
                : <Gamepad2 className="h-3.5 w-3.5 text-hextech-cyan" />
              }
              {t('dev.simulateGame')}
            </button>
            <button
              onClick={() => { refreshSession(); toast({ title: t('dev.toast.refreshed') }) }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs text-hextech-text hover:bg-hextech-elevated/60 transition-colors"
            >
              <RefreshCw className="h-3.5 w-3.5 text-hextech-green" />
              {t('dev.refreshSession')}
            </button>
          </div>
        </div>
      )}

      <button
        onClick={() => setOpen(!open)}
        className={cn(
          'flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold uppercase tracking-wider shadow-lg transition-all',
          'border border-[#FF4655]/50 bg-hextech-dark text-[#FF4655] hover:bg-[#FF4655]/10',
        )}
      >
        <Gamepad2 className="h-3.5 w-3.5" />
        {t('dev.badge')}
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
      </button>
    </div>
  )
}
