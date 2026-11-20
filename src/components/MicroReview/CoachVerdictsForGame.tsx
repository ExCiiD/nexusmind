import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Gavel } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCollab } from '@/hooks/useCollab'
import type { CloudMicroAnswer } from '@/lib/microReview/types'

const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`

/**
 * § 18.5 L3: in the Review of a game, the coach's verdicts on my micro-review answers of that game — one strip per
 * judged answer: « Verdict de Coach Sora : justifié / à corriger » and the comment. Nothing when there is none.
 */
export function CoachVerdictsForGame({ matchId }: { matchId: string }) {
  const { t } = useTranslation()
  const { nameOf } = useCollab()
  const [answers, setAnswers] = useState<CloudMicroAnswer[]>([])
  useEffect(() => {
    let alive = true
    window.api.microReviewCloudMyVerdicts?.()
      .then((list) => { if (alive) setAnswers(list.filter((a) => a.matchId === matchId && a.verdicts.length > 0)) })
      .catch(() => {})
    return () => { alive = false }
  }, [matchId])
  if (answers.length === 0) return null
  return (
    <ul className="mt-3 space-y-1.5" aria-label={t('coachVerdicts.title')}>
      {answers.flatMap((a) => a.verdicts.map((v) => {
        const justified = (v.correctedOutcome ?? a.outcome) === 'justified'
        return (
          <li key={v.id} className={cn('flex flex-wrap items-start gap-2 rounded-md border px-3 py-2 text-xs',
            v.status === 'validated' ? 'border-hextech-green/40 bg-hextech-green/10' : 'border-hextech-gold/40 bg-hextech-gold/10')}>
            <Gavel className="mt-0.5 h-3.5 w-3.5 shrink-0 text-hextech-gold" aria-hidden />
            <span className="font-mono text-hextech-text-dim">{clock(a.gameTimeSec)}</span>
            <span className="text-hextech-text-bright">
              {t('coachVerdicts.line', {
                name: v.coachId ? nameOf(v.coachId) : t('myTeam.yourCoach'),
                verdict: t(v.status === 'validated' ? (justified ? 'coachVerdicts.justified' : 'coachVerdicts.confirmed') : 'coachVerdicts.toFix'),
              })}
            </span>
            {v.note && <span className="basis-full pl-5 text-hextech-text">{v.note}</span>}
          </li>
        )
      }))}
    </ul>
  )
}

/**
 * § 18.5 L3 in the Mistake Lab: the coach's verdicts on my micro-review answers about the mistakes shown (their tags,
 * within the period), newest first. Nothing when there is none.
 */
export function CoachVerdictsLab({ tags, days, className }: {
  /** slug → label of the mistakes on screen (the focused one alone when one is picked). */
  tags: Map<string, string>
  days: number
  className?: string
}) {
  const { t } = useTranslation()
  const { nameOf } = useCollab()
  const [answers, setAnswers] = useState<CloudMicroAnswer[]>([])
  useEffect(() => {
    let alive = true
    window.api.microReviewCloudMyVerdicts?.().then((list) => { if (alive) setAnswers(list) }).catch(() => {})
    return () => { alive = false }
  }, [])
  const since = Date.now() - days * 86_400_000
  const rows = answers
    .filter((a) => a.tagSlug && tags.has(a.tagSlug))
    .flatMap((a) => a.verdicts.filter((v) => new Date(v.createdAt).getTime() > since).map((v) => ({ a, v })))
    .sort((x, y) => y.v.createdAt.localeCompare(x.v.createdAt))
  if (rows.length === 0) return null
  return (
    <section aria-label={t('coachVerdicts.title')} className={cn('space-y-2 rounded-2xl border border-hextech-border-dim/70 p-4', className)}>
      <h2 className="flex items-center gap-2 text-sm font-semibold text-hextech-text-bright"><Gavel className="h-4 w-4 text-hextech-gold" />{t('coachVerdicts.title')}</h2>
      <ul className="space-y-1.5">
        {rows.map(({ a, v }) => (
          <li key={v.id} className="text-xs">
            <span className="font-semibold text-hextech-text-bright">{tags.get(a.tagSlug!)}</span>
            <span className="text-hextech-text-dim"> · {a.champion} · {clock(a.gameTimeSec)} · </span>
            <span className={v.status === 'validated' ? 'text-hextech-green' : 'text-hextech-gold'}>
              {t('coachVerdicts.line', { name: v.coachId ? nameOf(v.coachId) : t('myTeam.yourCoach'), verdict: t(v.status === 'validated' ? 'coachVerdicts.confirmed' : 'coachVerdicts.toFix') })}
            </span>
            {v.note && <span className="block pl-2 text-hextech-text">{v.note}</span>}
          </li>
        ))}
      </ul>
    </section>
  )
}
