import { useTranslation } from 'react-i18next'
import { Users } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import type { Group } from '@/lib/collab'
import { useActiveGroupStore } from '@/store/useActiveGroupStore'

/**
 * The group picker of the Coaching & Management and Stats collectives page
 * headers: one choice for every tab of both pages (useActiveGroupStore).
 * The list scrolls past a handful of groups.
 */
export function GroupSwitcher({ groups, active }: { groups: Group[]; active: Group | null }) {
  const { t } = useTranslation()
  const setGroupId = useActiveGroupStore((s) => s.setGroupId)
  if (!active) return null

  const label = (g: Group) => (
    <span className="flex min-w-0 items-center gap-2">
      <span className="truncate text-hextech-text-bright">{g.name}</span>
      <span className="shrink-0 rounded bg-hextech-gold/10 px-1.5 py-px font-mono text-[10px] text-hextech-gold">{t(`coaching.roles.${g.myRole}`)}</span>
    </span>
  )

  return (
    <div className="flex items-center gap-2">
      <span className="flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-hextech-text-dim">
        <Users className="h-3.5 w-3.5" />{t('coaching.switcher.label')}
      </span>
      {groups.length > 1 ? (
        <Select value={active.id} onValueChange={setGroupId}>
          <SelectTrigger className="h-9 w-64" aria-label={t('coaching.switcher.label')}>{label(active)}</SelectTrigger>
          <SelectContent className="max-h-80">
            {groups.map((g) => (
              <SelectItem key={g.id} value={g.id}>
                <span className="flex items-center gap-2">
                  {g.name}
                  <span className="text-[10px] text-hextech-text-dim">· {t(`coaching.kinds.${g.kind}`)} · {t(`coaching.roles.${g.myRole}`)}</span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <div className="flex h-9 max-w-64 items-center rounded-md border border-hextech-border-dim px-3 text-sm">{label(active)}</div>
      )}
    </div>
  )
}
