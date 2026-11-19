import { useTranslation } from 'react-i18next'
import { Film, User } from 'lucide-react'

interface Props {
  onCustom: () => void
  onExternal: () => void
}

export function ExternalReviewModeStep({ onCustom, onExternal }: Props) {
  const { t } = useTranslation()
  return (
    <div className="grid grid-cols-2 gap-3 pt-2">
      <button
        type="button"
        onClick={onCustom}
        className="flex flex-col items-center gap-3 rounded-xl border border-hextech-border-dim bg-hextech-elevated hover:border-hextech-gold/60 hover:bg-hextech-gold/5 transition-all p-5 text-left group"
      >
        <div className="rounded-full bg-hextech-gold/10 p-3 group-hover:bg-hextech-gold/20 transition-colors">
          <Film className="h-5 w-5 text-hextech-gold" aria-hidden />
        </div>
        <div>
          <p className="font-semibold text-hextech-text-bright text-sm">{t('externalReview.mode.custom')}</p>
          <p className="text-xs text-hextech-text-dim mt-1 leading-snug">
            {t('externalReview.mode.customDesc')}
          </p>
        </div>
      </button>

      <button
        type="button"
        onClick={onExternal}
        className="flex flex-col items-center gap-3 rounded-xl border border-hextech-border-dim bg-hextech-elevated hover:border-hextech-gold/60 hover:bg-hextech-gold/5 transition-all p-5 text-left group"
      >
        <div className="rounded-full bg-hextech-gold/10 p-3 group-hover:bg-hextech-gold/20 transition-colors">
          <User className="h-5 w-5 text-hextech-gold" aria-hidden />
        </div>
        <div>
          <p className="font-semibold text-hextech-text-bright text-sm">{t('externalReview.mode.player')}</p>
          <p className="text-xs text-hextech-text-dim mt-1 leading-snug">
            {t('externalReview.mode.playerDesc')}
          </p>
        </div>
      </button>
    </div>
  )
}
