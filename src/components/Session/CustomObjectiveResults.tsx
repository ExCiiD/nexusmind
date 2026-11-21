import { useTranslation } from 'react-i18next'
import { GraduationCap } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { CustomObjective, CustomObjectiveResult, ObjectiveResult } from '@/lib/customObjectives'

const RESULTS: ObjectiveResult[] = ['yes', 'partial', 'no']
const ACTIVE: Record<ObjectiveResult, string> = {
  yes: 'border-hextech-green bg-hextech-green/15 text-hextech-green',
  partial: 'border-hextech-gold bg-hextech-gold/15 text-hextech-gold',
  no: 'border-hextech-red bg-hextech-red/15 text-hextech-red',
}

/** Review (20/11): for each written objective, respected yes / partly / no, and an optional note. */
export function CustomObjectiveResults({ objectives, value, onChange }: {
  objectives: CustomObjective[]
  value: CustomObjectiveResult[]
  onChange: (next: CustomObjectiveResult[]) => void
}) {
  const { t } = useTranslation()
  if (objectives.length === 0) return null
  const set = (objectiveId: string, patch: Partial<CustomObjectiveResult>) => {
    const cur = value.find((r) => r.objectiveId === objectiveId)
    const next = { objectiveId, result: cur?.result ?? 'yes', note: cur?.note ?? null, ...patch } as CustomObjectiveResult
    onChange([...value.filter((r) => r.objectiveId !== objectiveId), next])
  }
  return (
    <Card className="border-hextech-gold/30" data-testid="custom-objective-results">
      <CardContent className="space-y-4 p-4">
        <div className="text-sm font-medium text-hextech-gold-bright">{t('session.customObjectives.reviewTitle')}</div>
        {objectives.map((o) => {
          const r = value.find((x) => x.objectiveId === o.id)
          return (
            <div key={o.id} className="space-y-2">
              <p className="flex items-start gap-1.5 text-sm text-hextech-text-bright">
                {o.source === 'coach' && <GraduationCap className="mt-0.5 h-3.5 w-3.5 shrink-0 text-hextech-cyan" aria-label={t('session.customObjectives.fromCoach')} />}
                <span className="break-words">{o.text}</span>
              </p>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={o.text}>
                {RESULTS.map((res) => (
                  <button key={res} type="button" role="radio" aria-checked={r?.result === res} onClick={() => set(o.id, { result: res })}
                    className={cn('rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors',
                      r?.result === res ? ACTIVE[res] : 'border-hextech-border-dim text-hextech-text hover:border-hextech-gold/50')}>
                    {t(`session.customObjectives.result.${res}`)}
                  </button>
                ))}
              </div>
              {r && (
                <Input value={r.note ?? ''} onChange={(e) => set(o.id, { note: e.target.value || null })} maxLength={300}
                  placeholder={t('session.customObjectives.resultNote')} aria-label={t('session.customObjectives.resultNote')}
                  className="bg-hextech-elevated border-hextech-border-dim text-sm" />
              )}
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
