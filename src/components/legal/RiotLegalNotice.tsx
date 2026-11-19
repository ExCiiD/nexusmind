import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

/**
 * R7 (docs/DEMANDE_CLE_PROD.md): Riot's required legal notice, "readily visible to players". The official text stays
 * in English in both languages (same text as the site footer, site/public/index.html), hence lang="en".
 */
export const RIOT_LEGAL_NOTICE =
  'Ascend isn’t endorsed by Riot Games and doesn’t reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc.'

export function RiotLegalNotice({ className, withTitle = false }: { className?: string; withTitle?: boolean }) {
  const { t } = useTranslation()
  return (
    <div className={cn('text-[11px] leading-relaxed text-hextech-text-dim', className)}>
      {withTitle && <p className="mb-1 font-semibold text-hextech-text">{t('cloud.legal.riotNoticeTitle')}</p>}
      <p lang="en">{RIOT_LEGAL_NOTICE}</p>
    </div>
  )
}
