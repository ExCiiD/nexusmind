import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronUp, GraduationCap, ListChecks, Target } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ReassessmentBanner } from '@/components/Coaching/ReassessmentBanner'
import { DevPlanCard } from '@/components/Coaching/DevPlanCard'
import { AssignedObjectivesCard } from '@/components/Coaching/AssignedObjectivesCard'
import type { MySessionObjectives, MyVodActionItem } from '@/lib/myTeam'
import { useCollab } from '@/hooks/useCollab'
import type { DevPlan } from '@/lib/devPlan'
import { ExperimentPanel, criterionText } from '@/components/Assistant/ExperimentPanel'
import { useLocalizedFundamentals } from '@/lib/constants/useFundamentals'
import { cn } from '@/lib/utils'
import type { AssistantInsight, AssistantReport, CoachExperimentState } from '@/components/Assistant/types'

interface RelatedGame {
  id: string
  champion: string
  win: boolean
  endedAt: number
  reviewed: boolean
}

/**
 * "Mon plan" (docs/moteur/MOTEUR_REGLES.md §5 Interface): the focus and its
 * experiment, why it was picked, the next couple of priorities, the
 * verdict history and the fundamentals graduated so far. Everything here
 * is composed from endpoints the earlier lots already built — no new
 * diagnosis logic, just a dedicated place to see it all together.
 */
export function MyPlanPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const fundamentals = useLocalizedFundamentals()
  const objectiveLabel = useCallback(
    (id: string) => fundamentals.flatMap((c) => c.fundamentals).find((f) => f.id === id)?.label ?? id,
    [fundamentals],
  )
  const [report, setReport] = useState<AssistantReport | null>(null)
  const [experiments, setExperiments] = useState<CoachExperimentState | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let alive = true
    Promise.all([window.api.getAssistantReport('weekly', null), window.api.coachExperiments()])
      .then(([r, e]) => { if (alive) { setReport(r); setExperiments(e) } })
      .catch(() => {})
      .finally(() => { if (alive) setLoaded(true) })
    return () => { alive = false }
  }, [])

  const text = useCallback((insight: AssistantInsight) => {
    const params: Record<string, string | number> = { ...insight.params }
    for (const [k, kind] of Object.entries(insight.paramKinds)) {
      if (kind === 'objective' && typeof params[k] === 'string') params[k] = objectiveLabel(params[k] as string)
    }
    return t(insight.messageKey, params)
  }, [t, objectiveLabel])

  if (!loaded) return null

  const insights = report?.insights ?? []
  const focus = insights.find((i) => i.focus) ?? null
  const others = insights.filter((i) => i !== focus)
  const experiment = experiments?.active ?? experiments?.recent ?? null

  return (
    <div className="space-y-4 animate-fade-in">
      <div>
        <h1 className="font-display text-2xl font-bold text-hextech-gold-bright">{t('plan.title')}</h1>
        <p className="text-sm text-hextech-text mt-0.5">{t('plan.subtitle')}</p>
      </div>

      <ReassessmentBanner />

      {/* 20/11 (docs/DECISIONS.md): the axes and notes my staff gave me, read here too. Nothing without a group or a plan. */}
      <StaffPlans />
      <CoachGoals />
      <VodActions />

      {!focus && others.length === 0 && (
        <Card><CardContent className="pt-6 text-sm text-hextech-text-dim">{t('plan.empty')}</CardContent></Card>
      )}

      {focus && (
        <Card className="border-hextech-gold/40 bg-gradient-to-b from-hextech-gold/5 to-hextech-gold/5" data-testid="plan-focus">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Target className="h-4 w-4 text-hextech-gold" />
              {t('plan.focusTitle')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <InsightBlock insight={focus} text={text} objectiveLabel={objectiveLabel} navigate={navigate} />
            {experiment && <ExperimentPanel experiment={experiment} objectiveLabel={objectiveLabel} />}
          </CardContent>
        </Card>
      )}

      {others.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t('plan.otherTitle')}</CardTitle>
            <CardDescription>{t('plan.otherDesc')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {others.map((i) => <InsightBlock key={i.key} insight={i} text={text} objectiveLabel={objectiveLabel} navigate={navigate} />)}
          </CardContent>
        </Card>
      )}

      {experiments && experiments.history.length > 0 && (
        <Card data-testid="plan-history">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <ListChecks className="h-4 w-4 text-hextech-cyan" />
              {t('plan.historyTitle')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-hextech-border-dim">
              {experiments.history.map((exp) => (
                <li key={exp.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="text-hextech-text-bright truncate">{criterionText(t, exp.criterion, exp.problemId)}</p>
                    <p className="text-[11px] text-hextech-text-dim">
                      {exp.fundamentalId ? objectiveLabel(exp.fundamentalId) : t(`coach.problems.${exp.problemId}`)}
                      {exp.endedAt && ` · ${new Date(exp.endedAt).toLocaleDateString()}`}
                    </p>
                  </div>
                  <span
                    className={cn(
                      'shrink-0 rounded px-2 py-0.5 text-[11px] font-medium',
                      exp.verdict === 'acquired' && 'bg-hextech-green/15 text-hextech-green',
                      exp.verdict === 'progressing' && 'bg-hextech-gold/15 text-hextech-gold',
                      exp.verdict === 'no_effect' && 'bg-hextech-text-dim/15 text-hextech-text-dim',
                    )}
                  >
                    {t(`plan.verdict.${exp.verdict}`)}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {experiments && experiments.graduated.length > 0 && (
        <Card data-testid="plan-graduated">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <GraduationCap className="h-4 w-4 text-hextech-green" />
              {t('plan.graduatedTitle')}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {experiments.graduated.map((fid) => (
              <span key={fid} className="rounded-full border border-hextech-green/40 bg-hextech-green/10 px-3 py-1 text-xs text-hextech-green">
                {objectiveLabel(fid)}
              </span>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function InsightBlock({
  insight,
  text,
  objectiveLabel,
  navigate,
}: {
  insight: AssistantInsight
  text: (i: AssistantInsight) => string
  objectiveLabel: (id: string) => string
  navigate: ReturnType<typeof useNavigate>
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [games, setGames] = useState<RelatedGame[] | null>(null)

  const toggle = async () => {
    const next = !open
    setOpen(next)
    if (next && games === null && insight.relatedGameIds.length > 0) {
      const rows = await window.api.coachGamesByIds?.(insight.relatedGameIds).catch(() => [])
      setGames(rows ?? [])
    }
  }

  return (
    <div className="rounded-md bg-hextech-elevated/60 px-3 py-2 space-y-1.5" data-testid="plan-insight" data-problem-id={insight.problemId}>
      <p className="text-sm text-hextech-text-bright">{text(insight)}</p>
      {insight.action?.type === 'objective' && (
        <p className="text-[11px] text-hextech-gold">{t('assistant.actions.objective', { objective: objectiveLabel(insight.action.objectiveId) })}</p>
      )}
      {insight.relatedGameIds.length > 0 && (
        <button type="button" className="flex items-center gap-1 text-[11px] text-hextech-cyan hover:underline" onClick={toggle} data-testid="plan-why-toggle">
          {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          {t('plan.why')}
        </button>
      )}
      {open && (
        <div className="flex flex-wrap gap-1.5 pt-1" data-testid="plan-why-games">
          {games === null && <span className="text-[11px] text-hextech-text-dim">{t('common.loading')}</span>}
          {games?.map((g) => (
            <button
              key={g.id}
              type="button"
              className="flex items-center gap-1 rounded border border-hextech-border px-2 py-0.5 text-[11px] text-hextech-text hover:border-hextech-gold/50 hover:text-hextech-gold-bright"
              onClick={() => navigate(g.reviewed ? `/history` : `/review?gameId=${g.id}`)}
            >
              <span className={g.win ? 'text-hextech-green' : 'text-[#E24C3A]'}>{g.win ? 'W' : 'L'}</span>
              {g.champion} · {new Date(g.endedAt).toLocaleDateString()}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * The development plans the staff gave me (Coaching › Joueurs, the Management dashboard's DevPlanCard), one per group
 * that has one: the axes, my progress on each, and the 1:1 notes. Shown only when a group has a plan for me.
 */
function StaffPlans() {
  const { t, i18n } = useTranslation()
  const { groups, myUserId, nameOf } = useCollab()
  const [withPlan, setWithPlan] = useState<string[]>([])
  const ids = groups.map((g) => g.id).join(',')

  useEffect(() => {
    if (!myUserId || !ids || !window.api.devPlanGetMine) { setWithPlan([]); return }
    let alive = true
    void Promise.all(ids.split(',').map((id) => window.api.devPlanGetMine(id).then((p) => (p ? id : null)).catch(() => null)))
      .then((found) => { if (alive) setWithPlan(found.filter((x): x is string => !!x)) })
    return () => { alive = false }
  }, [ids, myUserId])

  if (!myUserId || withPlan.length === 0) return null
  const date = (iso: string) => new Date(iso).toLocaleDateString(i18n.language, { day: 'numeric', month: 'long' })
  return (
    <section aria-label={t('plan.staff.title')} className="space-y-3">
      {withPlan.map((groupId) => {
        const group = groups.find((g) => g.id === groupId)
        return (
          <DevPlanCard
            key={groupId}
            groupId={groupId}
            playerId={myUserId}
            mode="player"
            meta={(plan: DevPlan) => {
              const last = [...plan.checkins].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
              const author = plan.createdByName || (plan.createdBy ? nameOf(plan.createdBy) : null)
              return [
                author ? t('plan.staff.givenBy', { name: author, group: group?.name ?? '—' }) : t('plan.staff.fromGroup', { group: group?.name ?? '—' }),
                t('plan.staff.updated', { date: date(plan.updatedAt) }),
                last?.createdBy ? t('plan.staff.lastNote', { name: nameOf(last.createdBy), date: date(last.createdAt) }) : null,
              ].filter(Boolean).join(' · ')
            }}
          />
        )
      })}
    </section>
  )
}

/** § 18.5 L2: the objectives my coach gave me — assigned ones, and mine for the coming team sessions. */
function CoachGoals() {
  const { t, i18n } = useTranslation()
  const fundamentals = useLocalizedFundamentals()
  const label = (id: string) => fundamentals.flatMap((c) => c.fundamentals).find((f) => f.id === id)?.label ?? id
  const [sessions, setSessions] = useState<MySessionObjectives[]>([])
  useEffect(() => {
    let alive = true
    window.api.mySessionObjectives?.().then((s) => { if (alive) setSessions(s) }).catch(() => {})
    return () => { alive = false }
  }, [])
  return (
    <section aria-label={t('plan.coachGoals')} className="space-y-3">
      <AssignedObjectivesCard />
      {sessions.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">{t('plan.coachGoals')}</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {sessions.map((s) => (
              <div key={s.sessionId} className="rounded-lg border border-hextech-border-dim p-3 text-sm">
                <p className="text-xs text-hextech-text-dim">
                  {s.title}{s.startsAt && ` · ${new Date(s.startsAt).toLocaleString(i18n.language, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`}
                </p>
                <p className="mt-0.5 font-semibold text-hextech-text-bright">{s.objectiveIds.map(label).join(' · ')}</p>
                {s.note && <p className="mt-0.5 text-hextech-text">{s.note}</p>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </section>
  )
}

/** § 18.5 L6: the actions of the VOD reviews I am assigned to, with « fait » and a link to the review. */
function VodActions() {
  const { t } = useTranslation()
  const [items, setItems] = useState<MyVodActionItem[]>([])
  const load = useCallback(() => {
    window.api.myVodActionItems?.().then(setItems).catch(() => setItems([]))
  }, [])
  useEffect(() => { load() }, [load])
  if (items.length === 0) return null
  const toggle = async (item: MyVodActionItem) => {
    setItems((list) => list.map((x) => (x.id === item.id ? { ...x, done: !x.done } : x)))
    await window.api.vodReviewSetActionItemDone(item.id, !item.done).catch(load)
  }
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">{t('plan.vodActions')}</CardTitle></CardHeader>
      <CardContent className="space-y-1.5">
        {items.map((x) => (
          <div key={x.id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={x.done} onChange={() => { void toggle(x) }} aria-label={t('plan.markActionDone', { text: x.text })} className="accent-hextech-gold" />
            <span className={cn('min-w-0 flex-1', x.done ? 'text-hextech-text-dim line-through' : 'text-hextech-text-bright')}>{x.text}</span>
            <Link to={`/coaching?tab=vod&vod=${encodeURIComponent(x.vodSessionId)}`} className="shrink-0 text-xs text-hextech-gold hover:underline">{x.vodTitle}</Link>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
