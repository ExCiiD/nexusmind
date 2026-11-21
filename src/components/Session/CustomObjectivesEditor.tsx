import { useTranslation } from 'react-i18next'
import { Plus, X, GraduationCap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MAX_CUSTOM_OBJECTIVES, MAX_OBJECTIVE_LENGTH, newObjectiveId, type CustomObjective } from '@/lib/customObjectives'

/**
 * « Mes objectifs » (user decision 20/11/2026): 1 to 5 objectives written by the player, or added from a coach's
 * assignment, next to the fundamentals. A session can start with these alone. Final layout after Graphic Design's
 * mockup.
 */
export function CustomObjectivesEditor({ value, onChange }: { value: CustomObjective[]; onChange: (next: CustomObjective[]) => void }) {
  const { t } = useTranslation()
  const set = (id: string, text: string) => onChange(value.map((o) => (o.id === id ? { ...o, text: text.slice(0, MAX_OBJECTIVE_LENGTH) } : o)))
  const remove = (id: string) => onChange(value.filter((o) => o.id !== id))
  const add = () => onChange([...value, { id: newObjectiveId(), text: '', source: 'player' }])

  return (
    <div className="space-y-2" data-testid="custom-objectives">
      <div>
        <p className="text-sm font-semibold text-hextech-text-bright">{t('session.customObjectives.title')}</p>
        <p className="text-xs text-hextech-text-dim">{t('session.customObjectives.hint')}</p>
      </div>
      {value.map((o, i) => (
        <div key={o.id} className="flex items-center gap-2">
          {o.source === 'coach' && (
            <span title={t('session.customObjectives.fromCoach')} className="shrink-0 text-hextech-cyan"><GraduationCap className="h-4 w-4" /></span>
          )}
          <Input value={o.text} onChange={(e) => set(o.id, e.target.value)} maxLength={MAX_OBJECTIVE_LENGTH}
            placeholder={i === 0 ? t('session.customObjectives.placeholder') : undefined}
            aria-label={t('session.customObjectives.itemLabel', { n: i + 1 })}
            className="bg-hextech-elevated border-hextech-border-dim text-sm" />
          <button type="button" onClick={() => remove(o.id)} aria-label={t('session.customObjectives.remove')}
            className="shrink-0 rounded p-1 text-hextech-text-dim hover:text-hextech-red">
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
      {value.length < MAX_CUSTOM_OBJECTIVES && (
        <Button type="button" variant="outline" size="sm" onClick={add} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />{t('session.customObjectives.add')}
        </Button>
      )}
    </div>
  )
}
