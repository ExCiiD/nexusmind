import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { FlaskConical, GraduationCap, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CoachCriterion, CoachExperiment } from './types'

const METRIC_DIGITS: Record<string, number> = { csPerMin: 1, visionPerMin: 2 }

/** "At most 1 death before 14 min", "No “Unused gold” mistake"… */
export function criterionText(t: TFunction, c: CoachCriterion, problemId?: string): string {
  if (c.kind === 'metric') {
    const dir = c.op === '<=' ? 'max' : 'min'
    const target = Number(c.target.toFixed(METRIC_DIGITS[c.metric] ?? 0))
    return t(`coach.criterion.${dir}.${c.metric}`, {
      target,
      defaultValue: t(`coach.criterion.${dir}.generic`, { metric: t(`assistant.metrics.${c.metric}`), target }),
    })
  }
  const tags = c.label ?? (problemId ? t(`coach.problems.${problemId}`) : c.tags.join(', '))
  return t('coach.criterion.noMistake', { tags })
}

/**
 * The running experiment (criterion + one dot per game of the window) or the
 * verdict of the one that just ended.
 */
export function ExperimentPanel({
  experiment,
  objectiveLabel,
  onAbandon,
}: {
  experiment: CoachExperiment
  objectiveLabel: (id: string) => string
  onAbandon?: () => void
}) {
  const { t } = useTranslation()
  const { progress } = experiment
  const left = Math.max(0, experiment.windowGames - progress.counted)
  const done = experiment.status === 'done' && experiment.verdict

  return (
    <div
      className={cn(
        'rounded-md border px-3 py-2 space-y-1.5',
        done && experiment.verdict === 'acquired' ? 'border-hextech-green/40 bg-hextech-green/5' : 'border-hextech-gold/30 bg-hextech-gold/5',
      )}
      data-testid="coach-experiment"
      data-status={experiment.status}
      data-verdict={experiment.verdict ?? undefined}
    >
      <div className="flex items-start gap-2">
        {experiment.graduated
          ? <GraduationCap className="h-4 w-4 mt-0.5 shrink-0 text-hextech-green" />
          : <FlaskConical className="h-4 w-4 mt-0.5 shrink-0 text-hextech-gold" />}
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-hextech-gold">
            {done ? t('coach.experiment.doneTitle') : t('coach.experiment.activeTitle')}
            {experiment.fundamentalId && <span className="normal-case tracking-normal text-hextech-text-dim"> · {objectiveLabel(experiment.fundamentalId)}</span>}
          </p>
          <p className="text-sm text-hextech-text-bright">{criterionText(t, experiment.criterion, experiment.problemId)}</p>
        </div>
        {!done && onAbandon && (
          <button
            type="button"
            className="rounded p-1 text-hextech-text-dim hover:bg-hextech-elevated hover:text-hextech-text"
            aria-label={t('coach.experiment.abandon')}
            title={t('coach.experiment.abandon')}
            onClick={onAbandon}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="flex items-center gap-1 pl-6" aria-hidden>
        {Array.from({ length: experiment.windowGames }, (_, i) => {
          const r = progress.results[i]
          return (
            <span
              key={i}
              className={cn('h-2 w-6 rounded-full', !r ? 'bg-hextech-elevated' : r.passed ? 'bg-hextech-green' : 'bg-[#E24C3A]/80')}
            />
          )
        })}
      </div>

      <p className="pl-6 text-[11px] text-hextech-text-dim">
        {done
          ? t(`coach.experiment.verdict.${experiment.verdict}`, {
              rate: Math.round((progress.passRate ?? 0) * 100),
              passes: progress.passes,
              counted: progress.counted,
            })
          : t('coach.experiment.progress', { passes: progress.passes, counted: progress.counted, left })}
        {!done && experiment.source === 'session' && <> {t('coach.experiment.fromSession')}</>}
      </p>
      {experiment.graduated && experiment.fundamentalId && (
        <p className="pl-6 text-[11px] text-hextech-green">
          {t('coach.experiment.graduated', { objective: objectiveLabel(experiment.fundamentalId) })}
          {experiment.nextObjectiveId && <> {t('coach.experiment.next', { objective: objectiveLabel(experiment.nextObjectiveId) })}</>}
        </p>
      )}
    </div>
  )
}
