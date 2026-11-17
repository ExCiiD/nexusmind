/**
 * Coaching / Équipe side of the micro-review (docs/PLAN_MICRO_REVIEW.md):
 *   PlayerMicroReviewsCard  staff: a player's QCM answers per VOD timestamp,
 *                           validate or correct each diagnosis;
 *   MyMicroVerdictsCard     player: what the coach validated / corrected;
 *   TeamCodexCard           staff: team rules added to the AscendCodex.
 * Backed by supabase/migrations/20261117210000_micro_review_coach.sql; until
 * that migration is applied every card shows a "not enabled yet" note.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BookOpen, Check, Loader2, Pencil, ShieldCheck, Trash2, Timer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/useToast'
import { collabErrorKey, type Group } from '@/lib/collab'
import { fmtClock } from '@/lib/mistakeInsights'
import { UNAVAILABLE } from '@/lib/microReviewCloudCore'
import { PRE_ROLL_SEC } from './MicroReviewPanel'
import type { CloudMicroAnswer, TeamCodexRule, TeamCodexRuleInput } from '@/lib/microReview/types'
import { useLocalizedFundamentals } from '@/lib/constants/useFundamentals'
import { championLabel } from '@/lib/statsInsights'
import { summaryText, tagLabel } from './text'

const panel = 'panel-surface rounded-xl border border-hextech-border-dim p-5'
const kicker = 'font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-hextech-gold'
const isUnavailable = (err: unknown) => (err as Error)?.message === UNAVAILABLE

/** Diagnosis label of one answer ("Justifié" / tag). */
function useAnswerLabel() {
  const { t } = useTranslation()
  return useCallback((a: { outcome: string; tagSlug: string | null; reason: string | null }) => (
    a.outcome === 'justified'
      ? `${t('microReview.justifiedOutcome')}${a.reason ? ` — ${t(`microReview.reason.${a.reason}`, { tag: '' })}` : ''}`
      : tagLabel(t, a.tagSlug)
  ), [t])
}

function AnswerLine({ a }: { a: CloudMicroAnswer }) {
  const { t } = useTranslation()
  const label = useAnswerLabel()
  const s = a.summary ? summaryText(t, a.summary) : null
  const vod = a.videoTimeSec ?? Math.max(0, a.gameTimeSec - PRE_ROLL_SEC)
  return (
    <div className="min-w-0">
      <p className="text-xs text-hextech-text-bright">
        <span className="font-mono font-semibold text-hextech-gold">{fmtClock(a.gameTimeSec)}</span>
        <span className="ml-1.5 font-mono text-[10px] text-hextech-text-dim">{t('coachMicro.vodAt', { time: fmtClock(vod) })}</span>
        {s && <span className="text-hextech-text"> — {s.zone ? `${s.zone}, ` : ''}{s.line}</span>}
      </p>
      <p className="mt-0.5 text-xs">
        <span className={cn('font-medium', a.outcome === 'justified' ? 'text-hextech-green' : 'text-hextech-red')}>{label(a)}</span>
        {a.note && <span className="text-hextech-text-dim"> · “{a.note}”</span>}
      </p>
    </div>
  )
}

export function PlayerMicroReviewsCard({ playerId, groupId }: { playerId: string; groupId: string }) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [rows, setRows] = useState<CloudMicroAnswer[] | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    try { setRows(await window.api.microReviewCloudPlayerAnswers(playerId)); setUnavailable(false) } catch (err) {
      setRows([])
      if (isUnavailable(err)) setUnavailable(true)
      else toast({ title: t(collabErrorKey(err)), variant: 'destructive' })
    }
  }, [playerId, t, toast])
  useEffect(() => { load() }, [load])

  const validate = async (a: CloudMicroAnswer) => {
    setBusy(a.id)
    try { await window.api.microReviewCloudSetVerdict({ answerId: a.id, groupId, status: 'validated' }); await load() } catch (err) {
      toast({ title: t(collabErrorKey(err)), variant: 'destructive' })
    } finally { setBusy(null) }
  }

  // Group by game (match id), newest first, moments in game order.
  const games = useMemo(() => {
    const by = new Map<string, CloudMicroAnswer[]>()
    for (const r of rows ?? []) {
      const k = r.matchId ?? r.localId
      by.set(k, [...(by.get(k) ?? []), r])
    }
    return [...by.entries()].map(([k, list]) => ({ key: k, list: list.sort((a, b) => a.gameTimeSec - b.gameTimeSec) }))
  }, [rows])

  return (
    <section className={panel} data-testid="coach-micro-reviews">
      <p className={kicker}>{t('coachMicro.kicker')}</p>
      <h3 className="mt-1 flex items-center gap-2 text-base font-bold text-hextech-text-bright"><Timer className="h-4 w-4 text-hextech-gold" />{t('coachMicro.title')}</h3>
      <p className="mt-0.5 text-xs text-hextech-text">{t('coachMicro.desc')}</p>
      {rows === null ? (
        <Loader2 className="mt-4 h-4 w-4 animate-spin text-hextech-text-dim" />
      ) : unavailable ? (
        <p className="mt-3 text-xs text-hextech-text-dim">{t('coachMicro.unavailable')}</p>
      ) : games.length === 0 ? (
        <p className="mt-3 text-xs text-hextech-text-dim">{t('coachMicro.empty')}</p>
      ) : (
        <div className="mt-3 space-y-3">
          {games.map((g) => (
            <div key={g.key} className="rounded-lg border border-hextech-border-dim">
              <div className="border-b border-hextech-border-dim/60 px-3 py-1.5 text-[11px] text-hextech-text-dim">
                {championLabel(g.list[0].champion)} · {g.list[0].role || '—'} · {new Date(g.list[0].createdAt).toLocaleDateString()}
              </div>
              <ul className="divide-y divide-hextech-border-dim/50">
                {g.list.map((a) => {
                  const v = a.verdicts[0]
                  return (
                    <li key={a.id} className="px-3 py-2">
                      <div className="flex items-start gap-3">
                        <AnswerLine a={a} />
                        <div className="ml-auto flex shrink-0 gap-1.5">
                          {v ? (
                            <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold', v.status === 'validated' ? 'bg-hextech-green/15 text-hextech-green' : 'bg-hextech-gold/15 text-hextech-gold-bright')}>
                              {v.status === 'validated' ? t('coachMicro.validated') : t('coachMicro.corrected', { tag: v.correctedOutcome === 'justified' ? t('microReview.justifiedOutcome') : tagLabel(t, v.correctedTag) })}
                            </span>
                          ) : (
                            <Button size="sm" variant="outline" className="h-7 gap-1 text-[11px]" disabled={busy === a.id} onClick={() => validate(a)}>
                              {busy === a.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}{t('coachMicro.validate')}
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" className="h-7 gap-1 text-[11px]" onClick={() => setEditing(editing === a.id ? null : a.id)}>
                            <Pencil className="h-3 w-3" />{t('coachMicro.correct')}
                          </Button>
                        </div>
                      </div>
                      {editing === a.id && <CorrectForm answer={a} groupId={groupId} onDone={async () => { setEditing(null); await load() }} />}
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function CorrectForm({ answer, groupId, onDone }: { answer: CloudMicroAnswer; groupId: string; onDone: () => void }) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [tags, setTags] = useState<Array<{ slug: string; label: string; isBuiltIn: boolean }>>([])
  const [choice, setChoice] = useState<string>(answer.outcome === 'justified' ? 'justified' : answer.tagSlug ?? '')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => { window.api.listMistakeTags().then((x) => setTags(x.filter((tg) => tg.isBuiltIn))).catch(() => {}) }, [])
  const save = async () => {
    setSaving(true)
    try {
      await window.api.microReviewCloudSetVerdict({
        answerId: answer.id, groupId, status: 'corrected',
        correctedOutcome: choice === 'justified' ? 'justified' : 'mistake',
        correctedTag: choice === 'justified' ? null : choice || null,
        note: note.trim() || null,
      })
      onDone()
    } catch (err) {
      toast({ title: t(collabErrorKey(err)), variant: 'destructive' })
    } finally { setSaving(false) }
  }
  return (
    <div className="mt-2 space-y-2 rounded-lg bg-hextech-black/20 p-2.5">
      <label className="block text-[11px] text-hextech-text-dim" htmlFor={`cm-${answer.id}`}>{t('coachMicro.correctTo')}</label>
      <select id={`cm-${answer.id}`} value={choice} onChange={(e) => setChoice(e.target.value)}
        className="h-8 w-full rounded-md border border-hextech-border-dim bg-hextech-elevated px-2 text-xs text-hextech-text-bright">
        <option value="justified">{t('microReview.justifiedOutcome')}</option>
        {tags.map((tg) => <option key={tg.slug} value={tg.slug}>{tagLabel(t, tg.slug, tg.label)}</option>)}
      </select>
      <Textarea rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('coachMicro.notePlaceholder')} className="text-xs" />
      <div className="flex justify-end"><Button size="sm" disabled={saving} onClick={save}>{saving && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}{t('coachMicro.save')}</Button></div>
    </div>
  )
}

/** Player side: the coach's verdicts on my micro-review answers. Hidden when there is nothing to show. */
export function MyMicroVerdictsCard() {
  const { t } = useTranslation()
  const [rows, setRows] = useState<CloudMicroAnswer[]>([])
  useEffect(() => { window.api.microReviewCloudMyVerdicts().then(setRows).catch(() => setRows([])) }, [])
  if (rows.length === 0) return null
  return (
    <section className={panel} data-testid="my-micro-verdicts">
      <h3 className="flex items-center gap-2 text-sm font-bold text-hextech-text-bright"><ShieldCheck className="h-4 w-4 text-hextech-gold" />{t('coachMicro.myTitle')}</h3>
      <ul className="mt-2 divide-y divide-hextech-border-dim/50">
        {rows.slice(0, 8).map((a) => {
          const v = a.verdicts[0]
          return (
            <li key={a.id} className="py-2">
              <AnswerLine a={a} />
              <p className="mt-0.5 text-[11px] text-hextech-text">
                {v.status === 'validated' ? t('coachMicro.validated') : t('coachMicro.corrected', { tag: v.correctedOutcome === 'justified' ? t('microReview.justifiedOutcome') : tagLabel(t, v.correctedTag) })}
                {v.note && <span className="text-hextech-text-dim"> · “{v.note}”</span>}
              </p>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

const ROLES: TeamCodexRuleInput['role'][] = ['any', 'TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY']
const PHASES: TeamCodexRuleInput['phase'][] = ['any', 'early', 'mid', 'late']

/** Staff: team rules that take precedence over the built-in Codex for every member. */
export function TeamCodexCard({ staffGroups }: { staffGroups: Group[] }) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const fundamentals = useLocalizedFundamentals().flatMap((c) => c.fundamentals)
  const [groupId, setGroupId] = useState(staffGroups[0]?.id ?? '')
  const [rules, setRules] = useState<TeamCodexRule[] | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const [tags, setTags] = useState<Array<{ slug: string; label: string; isBuiltIn: boolean }>>([])
  const empty = { role: 'any' as TeamCodexRuleInput['role'], mistakeSlug: '', phase: 'any' as TeamCodexRuleInput['phase'], fundamentalId: '', headline: '', tacticalRule: '', drillObjective: '' }
  const [form, setForm] = useState(empty)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    if (!groupId) return
    try { setRules(await window.api.teamCodexList([groupId])); setUnavailable(false) } catch (err) {
      setRules([])
      if (isUnavailable(err)) setUnavailable(true)
    }
  }, [groupId])
  useEffect(() => { load() }, [load])
  useEffect(() => { window.api.listMistakeTags().then((x) => setTags(x)).catch(() => {}) }, [])

  if (staffGroups.length === 0) return null
  const valid = form.mistakeSlug && form.fundamentalId && form.headline.trim() && form.tacticalRule.trim() && form.drillObjective.trim()
  const add = async () => {
    setSaving(true)
    try { await window.api.teamCodexAdd({ ...form, groupId }); setForm(empty); await load() } catch (err) {
      toast({ title: isUnavailable(err) ? t('coachMicro.unavailable') : t(collabErrorKey(err)), variant: 'destructive' })
    } finally { setSaving(false) }
  }
  const select = 'h-8 rounded-md border border-hextech-border-dim bg-hextech-elevated px-2 text-xs text-hextech-text-bright'

  return (
    <section className={panel} data-testid="team-codex">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 text-base font-bold text-hextech-text-bright"><BookOpen className="h-4 w-4 text-hextech-cyan" />{t('coachMicro.codex.title')}</h3>
          <p className="mt-0.5 text-xs text-hextech-text">{t('coachMicro.codex.desc')}</p>
        </div>
        {staffGroups.length > 1 && (
          <select value={groupId} onChange={(e) => setGroupId(e.target.value)} className={select} aria-label={t('coachMicro.codex.group')}>
            {staffGroups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        )}
      </div>
      {unavailable ? (
        <p className="mt-3 text-xs text-hextech-text-dim">{t('coachMicro.unavailable')}</p>
      ) : (
        <>
          <ul className="mt-3 space-y-2">
            {(rules ?? []).map((r) => (
              <li key={r.id} className="flex items-start gap-2 rounded-lg border border-hextech-border-dim p-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-hextech-cyan">{tagLabel(t, r.mistakeSlug)} · {t(`coachMicro.codex.role.${r.role}`)} · {t(`coachMicro.codex.phase.${r.phase}`)}</p>
                  <p className="text-sm font-semibold text-hextech-text-bright">{r.headline}</p>
                  <p className="text-xs text-hextech-text">{r.tacticalRule}</p>
                  <p className="mt-0.5 text-[11px] text-hextech-text-dim">{t('codex.drill')} : {r.drillObjective}</p>
                </div>
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0" aria-label={t('coachMicro.codex.delete')} onClick={async () => { await window.api.teamCodexDelete(r.id).catch(() => {}); await load() }}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
            {rules?.length === 0 && <li className="text-xs text-hextech-text-dim">{t('coachMicro.codex.empty')}</li>}
          </ul>
          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <select value={form.mistakeSlug} onChange={(e) => setForm({ ...form, mistakeSlug: e.target.value })} className={select} aria-label={t('coachMicro.codex.mistake')}>
              <option value="">{t('coachMicro.codex.mistake')}</option>
              {tags.map((tg) => <option key={tg.slug} value={tg.slug}>{tagLabel(t, tg.isBuiltIn ? tg.slug : null, tg.label)}</option>)}
            </select>
            <select value={form.fundamentalId} onChange={(e) => setForm({ ...form, fundamentalId: e.target.value })} className={select} aria-label={t('coachMicro.codex.fundamental')}>
              <option value="">{t('coachMicro.codex.fundamental')}</option>
              {fundamentals.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as TeamCodexRuleInput['role'] })} className={select} aria-label={t('coachMicro.codex.roleLabel')}>
              {ROLES.map((r) => <option key={r} value={r}>{t(`coachMicro.codex.role.${r}`)}</option>)}
            </select>
            <select value={form.phase} onChange={(e) => setForm({ ...form, phase: e.target.value as TeamCodexRuleInput['phase'] })} className={select} aria-label={t('coachMicro.codex.phaseLabel')}>
              {PHASES.map((p) => <option key={p} value={p}>{t(`coachMicro.codex.phase.${p}`)}</option>)}
            </select>
            <Input className="sm:col-span-2" maxLength={140} value={form.headline} onChange={(e) => setForm({ ...form, headline: e.target.value })} placeholder={t('coachMicro.codex.headline')} aria-label={t('coachMicro.codex.headline')} />
            <Textarea className="sm:col-span-2 text-xs" rows={2} maxLength={1000} value={form.tacticalRule} onChange={(e) => setForm({ ...form, tacticalRule: e.target.value })} placeholder={t('coachMicro.codex.rule')} aria-label={t('coachMicro.codex.rule')} />
            <Input className="sm:col-span-2" maxLength={300} value={form.drillObjective} onChange={(e) => setForm({ ...form, drillObjective: e.target.value })} placeholder={t('coachMicro.codex.drill')} aria-label={t('coachMicro.codex.drill')} />
          </div>
          <div className="mt-2 flex justify-end">
            <Button size="sm" disabled={!valid || saving} onClick={add}>{saving && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}{t('coachMicro.codex.add')}</Button>
          </div>
        </>
      )}
    </section>
  )
}
