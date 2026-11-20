import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Check, ChevronRight, Users, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCollab } from '@/hooks/useCollab'
import { useLocalizedFundamentals } from '@/lib/constants/useFundamentals'
import type { DevPlan } from '@/lib/devPlan'
import type { MyNextEvent } from '@/lib/myTeam'

const VERDICT_DAYS = 14

/**
 * « Mon équipe » on the Dashboard (docs/DESIGN_STATE.md § 18.5): what the team gives the player, in one compact card —
 * the next event with my two presence buttons (L5), my coach's plan in one line (L1), then three counters: my coach's
 * goals (L2), the coach's recent verdicts on my micro-reviews (L3), my tasks (L4). No card without a group.
 */
export function MyTeamCard({ className }: { className?: string }) {
  const { t, i18n } = useTranslation()
  const { groups, nameOf } = useCollab()
  const fundamentals = useLocalizedFundamentals()
  const label = (id: string) => fundamentals.flatMap((c) => c.fundamentals).find((f) => f.id === id)?.label ?? id
  const [next, setNext] = useState<MyNextEvent | null>(null)
  const [plan, setPlan] = useState<DevPlan | null>(null)
  const [goals, setGoals] = useState(0)
  const [verdicts, setVerdicts] = useState(0)
  const [tasks, setTasks] = useState(0)
  const ids = groups.map((g) => g.id).join(',')

  const load = useCallback(async () => {
    if (!ids) return
    const api = window.api
    const [n, assigned, session, answers, open, plans] = await Promise.all([
      api.myNextEvent?.().catch(() => null) ?? null,
      api.collabListAssignments?.(undefined, true).catch(() => []) ?? [],
      api.mySessionObjectives?.().catch(() => []) ?? [],
      api.microReviewCloudMyVerdicts?.().catch(() => []) ?? [],
      api.myOpenTasks?.().catch(() => []) ?? [],
      Promise.all(ids.split(',').map((id) => api.devPlanGetMine?.(id).catch(() => null) ?? null)),
    ])
    setNext(n)
    setGoals((assigned?.length ?? 0) + (session?.length ?? 0))
    const since = Date.now() - VERDICT_DAYS * 86_400_000
    setVerdicts((answers ?? []).filter((a) => a.verdicts.some((v) => new Date(v.createdAt).getTime() > since)).length)
    setTasks(open?.length ?? 0)
    setPlan(plans.find((p): p is DevPlan => !!p) ?? null)
  }, [ids])
  useEffect(() => { void load() }, [load])

  if (!ids) return null
  const respond = async (status: 'confirmed' | 'declined') => {
    if (!next) return
    setNext({ ...next, myResponse: status })
    await window.api.calendarRespond(next.eventId, status).catch(() => { void load() })
  }
  const axis = plan?.axes.find((a) => a.status === 'active')
  const author = plan?.createdByName || (plan?.createdBy ? nameOf(plan.createdBy) : null)
  const rows = [
    goals > 0 && { to: '/plan', text: t('myTeam.goals', { count: goals }) },
    verdicts > 0 && { to: '/review', text: t('myTeam.verdicts', { count: verdicts }) },
    tasks > 0 && { to: '/management', text: t('myTeam.tasks', { count: tasks }) },
  ].filter(Boolean) as Array<{ to: string; text: string }>

  return (
    <section aria-label={t('myTeam.title')} className={cn('space-y-3 rounded-lg border border-hextech-border-dim bg-hextech-dark/50 p-4', className)}>
      <h2 className="flex items-center gap-2 text-sm font-semibold text-hextech-text-bright"><Users className="h-4 w-4 text-hextech-gold" />{t('myTeam.title')}</h2>
      {next && (
        <div className="space-y-1.5 rounded-md border border-hextech-gold/40 bg-hextech-gold/5 p-2.5">
          <p className="text-xs text-hextech-text">
            <span className="font-semibold uppercase tracking-wider text-hextech-gold">{t('mySpace.next')}</span>{' · '}
            <span className="font-medium text-hextech-text-bright">{next.title}</span>{' · '}
            {new Date(next.startsAt).toLocaleString(i18n.language, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}
            {next.prepReady && <span className="ml-1.5 rounded bg-hextech-green/15 px-1 font-mono text-[9px] font-bold uppercase text-hextech-green">{t('sessionPrep.ready')}</span>}
          </p>
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-hextech-text-dim">{t('myTeam.willYouCome')}</span>
            <button type="button" onClick={() => { void respond('confirmed') }} aria-pressed={next.myResponse === 'confirmed'}
              className={cn('inline-flex items-center gap-1 rounded px-2 py-0.5', next.myResponse === 'confirmed' ? 'bg-hextech-green/25 text-hextech-green' : 'text-hextech-text hover:bg-hextech-elevated')}>
              <Check className="h-3 w-3" />{t('planning.match.iWillBeThere')}
            </button>
            <button type="button" onClick={() => { void respond('declined') }} aria-pressed={next.myResponse === 'declined'}
              className={cn('inline-flex items-center gap-1 rounded px-2 py-0.5', next.myResponse === 'declined' ? 'bg-hextech-red/25 text-hextech-red' : 'text-hextech-text hover:bg-hextech-elevated')}>
              <X className="h-3 w-3" />{t('planning.match.iCannot')}
            </button>
          </div>
        </div>
      )}
      {plan && axis && (
        <Link to="/plan" className="flex items-center justify-between gap-2 text-xs text-hextech-text hover:text-hextech-gold">
          <span className="truncate">
            {t('myTeam.plan', { name: author ?? t('myTeam.yourCoach'), axis: label(axis.fundamentalId) })}
            {plan.periodEnd && ` · ${t('myTeam.until', { date: new Date(`${plan.periodEnd}T12:00:00`).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short' }) })}`}
          </span>
          <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
        </Link>
      )}
      {rows.map((r) => (
        <Link key={r.to} to={r.to} className="flex items-center justify-between gap-2 text-xs text-hextech-text hover:text-hextech-gold">
          <span>{r.text}</span><ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
        </Link>
      ))}
      {!next && !plan && rows.length === 0 && <p className="text-xs text-hextech-text-dim">{t('myTeam.quiet')}</p>}
    </section>
  )
}
