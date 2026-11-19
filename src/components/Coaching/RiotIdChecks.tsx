import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Loader2, SearchX, UserMinus } from 'lucide-react'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import type { Group, GroupMember } from '@/lib/collab'
import { riotIdIssues } from '@/lib/riotIdChecksCore'

const nameOf = (m: GroupMember) => m.displayName || m.riotId || '—'

/**
 * #38, Management → Groupes (staff only): members whose Riot ID failed the server's check. Conflicts list every
 * member claiming the same Riot player, and the owner removes the wrong one; not_found members must fix their Riot
 * ID. Renders nothing when every member is verified, unchecked, or before the migration (no puuidStatus).
 */
export function RiotIdChecks({ group, myUserId, onRemove }: {
  group: Group
  myUserId: string | null
  /** Owner only: removes a member (then reloads). */
  onRemove?: (m: GroupMember) => Promise<void>
}) {
  const { t } = useTranslation()
  const [pending, setPending] = useState<GroupMember | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  const { conflicts, notFound } = riotIdIssues(group.members)
  if (conflicts.length === 0 && notFound.length === 0) return null

  const removeButton = (m: GroupMember) => onRemove && m.userId !== myUserId && m.role !== 'owner' && (
    <button
      type="button"
      onClick={() => setPending(m)}
      disabled={removing !== null}
      aria-label={t('coaching.groups.riotChecks.removeLabel', { name: nameOf(m) })}
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-hextech-text-dim hover:bg-red-500/10 hover:text-[#E24C3A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hextech-gold disabled:opacity-50"
    >
      {removing === m.userId ? <Loader2 className="h-3 w-3 animate-spin" /> : <UserMinus className="h-3 w-3" />}
      {t('coaching.groups.remove')}
    </button>
  )

  const row = (m: GroupMember) => (
    <li key={m.userId} className="flex flex-wrap items-center justify-between gap-2">
      <span className="min-w-0 truncate">
        <span className="text-hextech-text-bright">{nameOf(m)}</span>
        {m.riotId && m.riotId !== m.displayName && <span className="ml-1.5 font-mono text-xs text-hextech-text-dim">{m.riotId}</span>}
        {m.userId === myUserId && <span className="ml-1 text-xs text-hextech-text-dim">({t('coaching.comments.you')})</span>}
      </span>
      {removeButton(m)}
    </li>
  )

  return (
    <section aria-labelledby={`riot-checks-${group.id}`} className="space-y-3 rounded-lg border border-amber-400/40 bg-amber-400/5 p-3 text-sm">
      <h3 id={`riot-checks-${group.id}`} className="font-medium text-amber-200">{t('coaching.groups.riotChecks.title')}</h3>

      {conflicts.map((same, i) => (
        <div key={same[0].userId + i} className="space-y-1.5">
          <p className="flex items-start gap-1.5 text-xs text-amber-200">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            {t('coaching.groups.riotChecks.conflict', { count: same.length })}
          </p>
          <ul className="space-y-1 pl-5">{same.map(row)}</ul>
          <p className="pl-5 text-xs text-hextech-text-dim">
            {onRemove ? t('coaching.groups.riotChecks.conflictOwner') : t('coaching.groups.riotChecks.conflictStaff')}
          </p>
        </div>
      ))}

      {notFound.length > 0 && (
        <div className="space-y-1.5">
          <p className="flex items-start gap-1.5 text-xs text-amber-200">
            <SearchX className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            {t('coaching.groups.riotChecks.notFound', { count: notFound.length })}
          </p>
          <ul className="space-y-1 pl-5">{notFound.map(row)}</ul>
          <p className="pl-5 text-xs text-hextech-text-dim">{t('coaching.groups.riotChecks.notFoundHint')}</p>
        </div>
      )}

      <ConfirmDialog
        open={pending != null}
        onOpenChange={(open) => { if (!open) setPending(null) }}
        title={t('coaching.groups.remove')}
        confirmLabel={t('coaching.groups.remove')}
        description={pending ? t('coaching.groups.riotChecks.removeConfirm', { name: nameOf(pending) }) : undefined}
        onConfirm={() => {
          const m = pending
          if (!m || !onRemove) return
          setRemoving(m.userId)
          void onRemove(m).finally(() => setRemoving(null))
        }}
      />
    </section>
  )
}
