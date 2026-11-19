import { useTranslation } from 'react-i18next'
import { AlertTriangle } from 'lucide-react'
import { useCollab } from '@/hooks/useCollab'

/**
 * #29: shown before an account is deleted. For each group I own, says what
 * happens to it: the owner role passes to another member (a coach, else a
 * manager, an analyst, the captain, then the longest-standing player), or the group is
 * deleted when nobody else is in it. Renders nothing when I own no group.
 */
export function OwnerHandoverNotice() {
  const { t } = useTranslation()
  const { groups } = useCollab()
  const owned = groups.filter((g) => g.myRole === 'owner')
  if (owned.length === 0) return null

  const handedOver = owned.filter((g) => g.members.length > 1)
  const deleted = owned.filter((g) => g.members.length <= 1)

  return (
    <div role="note" className="space-y-1.5 rounded-md border border-hextech-gold/40 bg-hextech-gold/5 px-3 py-2 text-xs text-hextech-text">
      <p className="flex items-center gap-1.5 font-medium text-hextech-gold-bright">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
        {t('cloud.ownerHandover.title', { count: owned.length })}
      </p>
      {handedOver.length > 0 && (
        <p>{t('cloud.ownerHandover.handedOver', { groups: handedOver.map((g) => g.name).join(', '), count: handedOver.length })}</p>
      )}
      {deleted.length > 0 && (
        <p className="text-hextech-red">{t('cloud.ownerHandover.deleted', { groups: deleted.map((g) => g.name).join(', '), count: deleted.length })}</p>
      )}
    </div>
  )
}
