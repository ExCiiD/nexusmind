import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle, CheckCircle2, Coffee, Dumbbell, FlaskConical, Info, ListChecks, PlayCircle, Sparkles,
  Target, ThumbsDown, ThumbsUp, TrendingDown, Swords,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useLocalizedFundamentals } from '@/lib/constants/useFundamentals'
import { cn } from '@/lib/utils'
import { ExperimentPanel } from './ExperimentPanel'
import type { AssistantAction, AssistantInsight, AssistantMoment, AssistantReport, AssistantTone } from './types'

interface AssistantCardProps {
  moment: AssistantMoment
  /** Post-game moment: the game the 3 points are about (defaults to the latest). */
  gameId?: string | null
  /** Change it to make the card reload (e.g. number of games in the session). */
  refreshKey?: string | number
  className?: string
}

const TONE_ICON: Record<AssistantTone, React.ComponentType<{ className?: string }>> = {
  positive: CheckCircle2,
  warning: AlertTriangle,
  negative: TrendingDown,
  neutral: Info,
}

const TONE_COLOR: Record<AssistantTone, string> = {
  positive: 'text-hextech-green',
  warning: 'text-hextech-gold',
  negative: 'text-[#FF4655]',
  neutral: 'text-hextech-cyan',
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

const INTEGER_METRICS = new Set(['deaths', 'laneScore', 'goldDiff14'])

/** Best/worst profile values, formatted per metric (integers for counts/scores, one decimal otherwise). */
function formatMetricValue(metric: string, value: number): string {
  return value.toFixed(INTEGER_METRICS.has(metric) ? 0 : 1)
}

/**
 * Rule-based assistant (Phase A): a few explained, ranked points for one
 * moment — post-game, session brief or weekly summary. Every point says why
 * it was raised and can be rated 👍/👎, which re-weights the rules locally.
 */
export function AssistantCard({ moment, gameId, refreshKey, className }: AssistantCardProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const fundamentals = useLocalizedFundamentals()
  const [report, setReport] = useState<AssistantReport | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [reload, setReload] = useState(0)
  const [starting, setStarting] = useState(false)

  const objectiveLabel = useCallback(
    (id: string) => fundamentals.flatMap((c) => c.fundamentals).find((f) => f.id === id)?.label ?? id,
    [fundamentals],
  )

  useEffect(() => {
    let alive = true
    window.api
      .getAssistantReport(moment, gameId ?? null)
      .then((r) => { if (alive) setReport(r) })
      .catch(() => { if (alive) setReport(null) })
      .finally(() => { if (alive) setLoaded(true) })
    return () => { alive = false }
  }, [moment, gameId, refreshKey, reload])

  const startExperiment = useCallback(async (insight: AssistantInsight) => {
    setStarting(true)
    try {
      await window.api.coachStartExperiment(insight.problemId, insight.tagSlug, insight.ruleId)
      setReload((n) => n + 1)
    } catch { /* not measurable any more: the card simply stays as it is */ } finally {
      setStarting(false)
    }
  }, [])

  const abandonExperiment = useCallback(async (experimentId: string) => {
    try { await window.api.coachAbandonExperiment(experimentId) } finally { setReload((n) => n + 1) }
  }, [])

  const vote = useCallback(
    async (insight: AssistantInsight, v: 1 | -1) => {
      const next = insight.vote === v ? 0 : v
      setReport((r) => r && {
        ...r,
        insights: r.insights.map((i) => (i.key === insight.key ? { ...i, vote: next === 0 ? null : next } : i)),
      })
      try {
        await window.api.sendAssistantFeedback(insight.key, insight.ruleId, moment, next)
      } catch { /* the vote is a hint; a failed write must not break the card */ }
    },
    [moment],
  )

  const text = useCallback(
    (insight: AssistantInsight) => {
      const params: Record<string, string | number> = { ...insight.params }
      for (const [k, kind] of Object.entries(insight.paramKinds)) {
        if (kind === 'objective' && typeof params[k] === 'string') params[k] = objectiveLabel(params[k] as string)
      }
      return t(insight.messageKey, params)
    },
    [t, objectiveLabel],
  )

  const drivers = useMemo(() => report?.drivers?.drivers.slice(0, 3) ?? [], [report])

  if (!loaded || !report) return null
  if (moment !== 'weekly' && report.insights.length === 0 && report.basisGames < 3) return null

  return (
    <Card className={cn('border-hextech-cyan/20 bg-hextech-blue/10', className)} data-testid={`assistant-card-${moment}`}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-hextech-cyan" />
          {t(`assistant.title.${moment}`)}
        </CardTitle>
        <p className="text-xs text-hextech-text-dim">{t(report.intro.key, report.intro.params)}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {moment === 'weekly' && report.summary && (
          <p className="text-sm text-hextech-text">
            {report.summary.games > 0
              ? t('assistant.weekly.summary', {
                  games: report.summary.games,
                  wins: report.summary.wins,
                  winrate: report.summary.winrate ?? 0,
                  reviewed: report.summary.reviewed,
                })
              : t('assistant.weekly.noGames')}
            {report.summary.previousGames > 0 && report.summary.winrate != null && report.summary.previousWinrate != null && (
              <span className="text-hextech-text-dim">
                {' '}{t('assistant.weekly.vsPrevious', { winrate: report.summary.previousWinrate })}
              </span>
            )}
          </p>
        )}

        {report.experiment && moment !== 'weekly' && (
          <ExperimentPanel
            experiment={report.experiment}
            objectiveLabel={objectiveLabel}
            onAbandon={() => abandonExperiment(report.experiment!.id)}
          />
        )}

        {report.insights.length === 0 && (
          <p className="text-sm text-hextech-text-dim">{t(`assistant.empty.${moment}`)}</p>
        )}

        {report.insights.map((insight) => {
          const Icon = TONE_ICON[insight.tone]
          return (
            <div
              key={insight.key}
              className={cn('rounded-md bg-hextech-elevated/60 px-3 py-2 space-y-1.5', insight.focus && 'ring-1 ring-hextech-gold/60')}
              data-testid="assistant-insight"
              data-rule-id={insight.ruleId}
              data-problem-id={insight.problemId}
              data-focus={insight.focus ? 'true' : undefined}
            >
              <div className="flex items-start gap-2">
                <Icon className={cn('h-4 w-4 mt-0.5 shrink-0', TONE_COLOR[insight.tone])} />
                <div className="min-w-0 flex-1">
                  {insight.focus && (
                    <span
                      className="mb-1 inline-block rounded bg-hextech-gold/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-hextech-gold"
                      title={t('assistant.focusHint')}
                    >
                      {t('assistant.focus')}
                    </span>
                  )}
                  <p className="text-sm text-hextech-text-bright">{text(insight)}</p>
                  <p className="text-[11px] text-hextech-text-dim mt-0.5">
                    {t(insight.why.key, insight.why.params)}
                    {insight.support > 0 && <> {t('assistant.support', { count: insight.support })}</>}
                  </p>
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  <button
                    type="button"
                    aria-label={t('assistant.feedback.helpful')}
                    title={t('assistant.feedback.helpful')}
                    onClick={() => vote(insight, 1)}
                    className={cn('rounded p-1 hover:bg-hextech-elevated', insight.vote === 1 ? 'text-hextech-green' : 'text-hextech-text-dim')}
                  >
                    <ThumbsUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label={t('assistant.feedback.notHelpful')}
                    title={t('assistant.feedback.notHelpful')}
                    onClick={() => vote(insight, -1)}
                    className={cn('rounded p-1 hover:bg-hextech-elevated', insight.vote === -1 ? 'text-[#FF4655]' : 'text-hextech-text-dim')}
                  >
                    <ThumbsDown className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              {insight.action && (
                <ActionRow action={insight.action} objectiveLabel={objectiveLabel} navigate={navigate} />
              )}
              {insight.focus && insight.canExperiment && moment !== 'weekly'
                && !(report.experiment?.status === 'active' && report.experiment.problemId === insight.problemId) && (
                <div className="pl-6">
                  <button
                    type="button"
                    disabled={starting}
                    data-testid="coach-start-experiment"
                    title={t('coach.experiment.startHint')}
                    className="inline-flex items-center gap-1 rounded border border-hextech-gold/50 bg-hextech-gold/10 px-2 py-0.5 text-[11px] text-hextech-gold-bright hover:bg-hextech-gold/20 disabled:opacity-50"
                    onClick={() => startExperiment(insight)}
                  >
                    <FlaskConical className="h-3 w-3" />
                    {t('coach.experiment.start', { n: 5 })}
                  </button>
                </div>
              )}
            </div>
          )
        })}

        {moment === 'weekly' && drivers.length > 0 && (
          <div className="space-y-1.5 pt-1">
            <p className="text-xs font-medium text-hextech-gold">{t('assistant.drivers.title')}</p>
            {drivers.map((d) => (
              <div key={d.metric} className="flex items-center gap-2">
                <span className="text-xs text-hextech-text w-40 truncate">{t(`assistant.metrics.${d.metric}`)}</span>
                <div className="h-1.5 flex-1 rounded bg-hextech-elevated overflow-hidden">
                  <div className="h-full bg-hextech-cyan" style={{ width: `${Math.round(d.importance * 100)}%` }} />
                </div>
                <span className="text-[11px] text-hextech-text-dim w-28 text-right">
                  {t(d.direction === 'higher' ? 'assistant.drivers.higher' : 'assistant.drivers.lower')}
                </span>
              </div>
            ))}
            <p className="text-[11px] text-hextech-text-dim">
              {t('assistant.drivers.explain', { n: report.drivers?.games ?? 0, objective: objectiveLabel(drivers[0].objectiveId) })}
            </p>
          </div>
        )}

        {moment === 'weekly' && report.bestWorst && report.bestWorst.indicators.length > 0 && (
          <div className="space-y-1.5 pt-1" data-testid="assistant-best-worst">
            <p className="text-xs font-medium text-hextech-gold">{t('assistant.bestWorst.title')}</p>
            {report.bestWorst.indicators.map((ind) => (
              <div key={ind.metric} className="flex items-center justify-between gap-2 text-xs">
                <span className="text-hextech-text w-32 shrink-0 truncate">{t(`assistant.metrics.${ind.metric}`)}</span>
                <span className="text-hextech-green">{formatMetricValue(ind.metric, ind.bestMean)}</span>
                <span className="text-hextech-text-dim">{t('assistant.bestWorst.vs')}</span>
                <span className="text-[#FF4655]">{formatMetricValue(ind.metric, ind.worstMean)}</span>
              </div>
            ))}
            <p className="text-[11px] text-hextech-text-dim">
              {t('assistant.bestWorst.explain', { best: report.bestWorst.bestGames, worst: report.bestWorst.worstGames })}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ActionRow({
  action,
  objectiveLabel,
  navigate,
}: {
  action: AssistantAction
  objectiveLabel: (id: string) => string
  navigate: ReturnType<typeof useNavigate>
}) {
  const { t } = useTranslation()
  const chip = 'inline-flex items-center gap-1 rounded border border-hextech-border px-2 py-0.5 text-[11px] text-hextech-text hover:text-hextech-gold-bright hover:border-hextech-gold/50'
  switch (action.type) {
    case 'objective':
      return (
        <div className="pl-6">
          <button type="button" className={chip} onClick={() => navigate('/session')}>
            <Target className="h-3 w-3 text-hextech-gold" />
            {t('assistant.actions.objective', { objective: objectiveLabel(action.objectiveId) })}
          </button>
        </div>
      )
    case 'rewatch':
      return (
        <div className="pl-6 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-hextech-text-dim">{t('assistant.actions.rewatch')}</span>
          {action.clips.map((c) => (
            <button
              key={`${c.gameId}-${c.gameTimeSec}`}
              type="button"
              className={cn(chip, !c.recordingId && 'opacity-60')}
              title={c.recordingId ? undefined : t('assistant.actions.noRecording')}
              onClick={() => navigate(c.recordingId ? `/record/${c.recordingId}?at=${c.gameTimeSec}` : `/lane-phase/${c.gameId}`)}
            >
              <PlayCircle className="h-3 w-3 text-hextech-cyan" />
              {c.champion} {formatTime(c.gameTimeSec)}
            </button>
          ))}
        </div>
      )
    case 'lanePhase':
      return (
        <div className="pl-6">
          <button type="button" className={chip} onClick={() => navigate(`/lane-phase/${action.gameId}`)}>
            <Swords className="h-3 w-3 text-hextech-cyan" />
            {t('assistant.actions.lanePhase')}
          </button>
        </div>
      )
    case 'break':
      return (
        <p className="pl-6 text-[11px] text-hextech-gold flex items-center gap-1">
          <Coffee className="h-3 w-3" />
          {t('assistant.actions.break', { minutes: action.minutes })}
        </p>
      )
    case 'drill':
      return (
        <p className="pl-6 text-[11px] text-hextech-text flex items-center gap-1">
          <Dumbbell className="h-3 w-3 text-hextech-cyan" />
          {t(`assistant.drills.${action.drillId}`)}
        </p>
      )
    case 'review':
      return (
        <div className="pl-6">
          <button type="button" className={chip} onClick={() => navigate(action.gameId ? `/review?gameId=${action.gameId}` : '/review')}>
            <ListChecks className="h-3 w-3 text-hextech-cyan" />
            {t('assistant.actions.review')}
          </button>
        </div>
      )
  }
}
