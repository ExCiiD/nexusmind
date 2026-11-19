import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { History } from 'lucide-react'
import type { TeamMember } from '@/lib/ipc'
import { cn } from '@/lib/utils'

/**
 * #38: a member renamed by the Riot ID refresh keeps its old "Name#TAG" in
 * previousRiotId. The team screens show « anciennement X » until someone
 * acknowledges it with OK, which clears the field (updateTeamMember).
 */
export function RenamedNote({ member, onCleared, className }: {
  member: TeamMember
  /** Called once the field is cleared, to reload the team. */
  onCleared?: () => void
  className?: string
}) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const previous = member.previousRiotId
  if (!previous) return null

  const acknowledge = async () => {
    setBusy(true)
    try {
      await window.api.updateTeamMember(member.id, { previousRiotId: null })
      onCleared?.()
    } catch {
      // Offline: the note stays, OK can be pressed again.
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className={cn('inline-flex max-w-full items-center gap-1.5 rounded-md border border-amber-400/40 bg-amber-400/10 px-1.5 py-0.5 text-[11px] text-amber-200', className)}>
      <History className="h-3 w-3 shrink-0" aria-hidden />
      <span className="truncate">{t('team.renamed.formerly', { name: previous })}</span>
      <button
        type="button"
        onClick={() => { void acknowledge() }}
        disabled={busy}
        aria-label={t('team.renamed.okLabel', { name: previous })}
        className="shrink-0 rounded px-1 font-semibold text-amber-100 hover:bg-amber-400/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hextech-gold disabled:opacity-50"
      >
        {t('team.renamed.ok')}
      </button>
    </span>
  )
}

/** Text-only variant, for places already inside a button (card front, player tabs). */
export function RenamedHint({ member, className }: { member: TeamMember; className?: string }) {
  const { t } = useTranslation()
  if (!member.previousRiotId) return null
  return (
    <span className={cn('block truncate text-[10px] text-amber-200', className)}>
      {t('team.renamed.formerly', { name: member.previousRiotId })}
    </span>
  )
}
