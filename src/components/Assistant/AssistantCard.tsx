import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle, CheckCircle2, Coffee, Dumbbell, Info, ListChecks, PlayCircle, Sparkles,
  Target, ThumbsDown, ThumbsUp, TrendingDown, Swords,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useLocalizedFundamentals } from '@/lib/constants/useFundamentals'
import { cn } from '@/lib/utils'
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
  }, [moment, gameId, refreshKey])

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

        {report.insights.length === 0 && (
          <p className="text-sm text-hextech-text-dim">{t(`assistant.empty.${moment}`)}</p>
        )}

        {report.insights.map((insight) => {
          const Icon = TONE_ICON[insight.tone]
          return (
            <div key={insight.key} className="rounded-md bg-hextech-elevated/60 px-3 py-2 space-y-1.5" data-testid="assistant-insight" data-rule-id={insight.ruleId}>
              <div className="flex items-start gap-2">
                <Icon className={cn('h-4 w-4 mt-0.5 shrink-0', TONE_COLOR[insight.tone])} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-hextech-text-bright">{text(insight)}</p>
                  <p className="text-[11px] text-hextech-text-dim mt-0.5">{t(insight.why.key, insight.why.params)}</p>
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
          <button type="button" className={chip} onClick={() => navigate('/review')}>
            <ListChecks className="h-3 w-3 text-hextech-cyan" />
            {t('assistant.actions.review')}
          </button>
        </div>
      )
  }
}
