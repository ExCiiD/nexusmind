import { useTranslation } from 'react-i18next'
import { GraduationCap, Target } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CustomObjective, CustomObjectiveResult } from '@/lib/customObjectives'

const RESULT_STYLE = { yes: 'text-hextech-green', partial: 'text-hextech-gold', no: 'text-hextech-red' } as const

/** A session's written objectives (20/11), read-only: active session, History, team sessions; with results when given. */
export function CustomObjectivesList({ objectives, results, className }: { objectives: CustomObjective[]; results?: CustomObjectiveResult[]; className?: string }) {
  const { t } = useTranslation()
  if (objectives.length === 0) return null
  return (
    <ul className={cn('space-y-1', className)} data-testid="custom-objectives-list">
      {objectives.map((o) => {
        const r = results?.find((x) => x.objectiveId === o.id)
        return (
          <li key={o.id} className="flex items-start gap-2 text-sm text-hextech-text">
            {o.source === 'coach'
              ? <GraduationCap className="mt-0.5 h-3.5 w-3.5 shrink-0 text-hextech-cyan" aria-label={t('session.customObjectives.fromCoach')} />
              : <Target className="mt-0.5 h-3.5 w-3.5 shrink-0 text-hextech-gold" aria-hidden />}
            <span className="min-w-0 flex-1 break-words">
              {o.text}
              {r && <span className={cn('ml-2 text-xs font-semibold', RESULT_STYLE[r.result])}>{t(`session.customObjectives.result.${r.result}`)}</span>}
              {r?.note && <span className="block text-xs text-hextech-text-dim">{r.note}</span>}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
