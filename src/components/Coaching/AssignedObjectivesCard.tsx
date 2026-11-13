import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Flag, X } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useLocalizedFundamentals } from '@/lib/constants/useFundamentals'
import { useCollab } from '@/hooks/useCollab'
import type { AssignedObjective } from '@/lib/collab'

/**
 * Player side: objectives a coach assigned. Optional `onUse` lets the session
 * page pre-select them for the next session.
 */
export function AssignedObjectivesCard({ onUse }: { onUse?: (objectiveIds: string[], note: string | null) => void }) {
  const { t, i18n } = useTranslation()
  const { available, groups, nameOf } = useCollab()
  const fundamentals = useLocalizedFundamentals()
  const [items, setItems] = useState<AssignedObjective[]>([])

  const load = useCallback(async () => {
    if (!available) return
    setItems(await window.api.collabListAssignments(undefined, true).catch(() => []))
  }, [available])

  useEffect(() => { load() }, [load])

  if (!available || groups.length === 0 || items.length === 0) return null

  const label = (id: string) => {
    for (const c of fundamentals) {
      const f = c.fundamentals.find((x) => x.id === id)
      if (f) return f.label
    }
    return id
  }

  const setStatus = async (a: AssignedObjective, status: 'done' | 'dismissed') => {
    await window.api.collabSetAssignmentStatus(a.id, status).catch(() => {})
    await load()
  }

  return (
    <Card className="border-hextech-gold/40">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Flag className="h-4 w-4 text-hextech-gold" />
          {t('coaching.assigned.title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {items.map((a) => (
          <div key={a.id} className="rounded-lg border border-hextech-border-dim p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              {a.objectiveIds.map((id) => (
                <span key={id} className="rounded bg-hextech-gold/10 px-2 py-0.5 text-hextech-gold">{label(id)}</span>
              ))}
              <span className="text-xs text-hextech-text-dim">
                {t('coaching.assigned.by', { name: nameOf(a.assignedBy) })}
                {a.dueDate && ` · ${t('coaching.assigned.due', { date: new Date(a.dueDate).toLocaleDateString(i18n.language) })}`}
              </span>
            </div>
            {a.note && <p className="mt-2 whitespace-pre-wrap text-hextech-text">{a.note}</p>}
            <div className="mt-2 flex flex-wrap gap-2">
              {onUse && (
                <Button size="sm" onClick={() => onUse(a.objectiveIds, a.note)}>{t('coaching.assigned.use')}</Button>
              )}
              <Button size="sm" variant="outline" className="gap-1" onClick={() => setStatus(a, 'done')}>
                <Check className="h-3.5 w-3.5" />{t('coaching.assigned.done')}
              </Button>
              <Button size="sm" variant="ghost" className="gap-1" onClick={() => setStatus(a, 'dismissed')}>
                <X className="h-3.5 w-3.5" />{t('coaching.assigned.dismiss')}
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
