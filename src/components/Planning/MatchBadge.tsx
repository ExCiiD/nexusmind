import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import type { MatchSummary } from '@/lib/matchEvent'
import { matchBadgeText } from '@/lib/matchEventView'

/**
 * #49 (§ 13): the « vs X · BO3 » badge on a Scrim / Officiel card of the Planning grid, from CalendarEvent.match.
 * Truncated on narrow cards; the full text goes to the tooltip and the accessible label.
 */
export function MatchBadge({ match, className }: { match: MatchSummary; className?: string }) {
  const { t } = useTranslation()
  const text = matchBadgeText(match)
  if (!text) return null
  const full = match.opponentName
    ? t('planning.match.badgeLabel', { name: match.opponentName, format: match.boFormat ? match.boFormat.toUpperCase() : '' }).trim()
    : text
  return (
    <span title={full} aria-label={full}
      className={cn('inline-block max-w-full truncate rounded bg-hextech-black/60 px-1 py-px font-mono text-[9px] font-semibold uppercase leading-tight text-hextech-gold',
        match.status === 'cancelled' && 'line-through opacity-70', className)}>
      {text}
    </span>
  )
}
