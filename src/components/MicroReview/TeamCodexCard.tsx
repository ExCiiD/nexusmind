/**
 * Staff: the team rules added to the AscendCodex. They take precedence over
 * the built-in entries for every member of the group.
 *
 * The form has no dropdown. The target mistake and the fundamental are typed
 * with an inline completion; a row of family icons above each field lists the
 * suggestions on hover (SuggestField). A mistake that is not in the library
 * is accepted as typed: it becomes a personal tag of the coach and the rule is
 * stored under its slug (see mistakeSlug: a player who names the same mistake
 * in a micro-review gets the same slug, hence this rule).
 *
 * A rule can target several roles. The cloud table keeps one role per row
 * (and released versions read it that way), so a rule for three roles is
 * three rows with the same content: they are shown, and deleted, as one.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BookOpen, Brain, Compass, Crosshair, Eye, Hourglass, Layers, Loader2, Map as MapIcon, Skull, Sword, Trash2, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/useToast'
import { collabErrorKey, type Group } from '@/lib/collab'
import { UNAVAILABLE } from '@/lib/microReviewCloudCore'
import { FAMILIES, tagFamily, type MistakeFamily } from '@/lib/mistakeInsights'
import { foldLabel, mistakeSlug, slugAsLabel } from '@/lib/mistakeSlug'
import type { TeamCodexRule, TeamCodexRuleInput } from '@/lib/microReview/types'
import { PLAYED_ROLES, groupCodexRules, rolesToStore, type CodexRuleGroup, type PlayedRole } from '@/lib/teamCodexRules'
import { useLocalizedFundamentals } from '@/lib/constants/useFundamentals'
import { SuggestField, type SuggestGroup, type SuggestOption } from './SuggestField'
import { tagLabel } from './text'

type Phase = TeamCodexRuleInput['phase']

const PHASES: Phase[] = ['any', 'early', 'mid', 'late']

const MISTAKE_FAMILY_ICON: Record<MistakeFamily, SuggestGroup['icon']> = { deaths: Skull, vision: Eye, tempo: Hourglass, mechanics: Crosshair }
const FUNDAMENTAL_FAMILY_ICON: Record<string, SuggestGroup['icon']> = {
  general_champion_pool: Layers, general_overall: Compass, general_mental: Brain, micro: Crosshair,
  early_game_laning: Sword, mid_late_macro: MapIcon, teamfighting: Users,
}
/** A new personal mistake is filed under a library category; these are the families a category can land in. */
const NEW_MISTAKE_FAMILIES: Array<{ family: MistakeFamily; category: string }> = [
  { family: 'tempo', category: 'macro' },
  { family: 'vision', category: 'vision' },
  { family: 'mechanics', category: 'micro' },
]

const panel = 'panel-surface rounded-xl border border-hextech-border-dim p-5'
const fieldLabel = 'font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-hextech-text-dim'
const isUnavailable = (err: unknown) => (err as Error)?.message === UNAVAILABLE

interface LibraryTag { slug: string; label: string; category: string; isBuiltIn: boolean }

const emptyForm = {
  mistake: '', newMistakeFamily: 'tempo' as MistakeFamily, fundamental: '', roles: [] as PlayedRole[], phase: 'any' as Phase,
  headline: '', tacticalRule: '', drillObjective: '',
}

export function TeamCodexCard({ staffGroups }: { staffGroups: Group[] }) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const categories = useLocalizedFundamentals()
  const groupId = staffGroups[0]?.id ?? ''
  const [rules, setRules] = useState<TeamCodexRule[] | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const [tags, setTags] = useState<LibraryTag[]>([])
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    if (!groupId) return
    try { setRules(await window.api.teamCodexList([groupId])); setUnavailable(false) } catch (err) {
      setRules([])
      if (isUnavailable(err)) setUnavailable(true)
    }
  }, [groupId])
  const loadTags = useCallback(() => { window.api.listMistakeTags().then((x) => setTags(x as LibraryTag[])).catch(() => {}) }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => { loadTags() }, [loadTags])

  // ── Suggestions ──
  const mistakeGroups = useMemo<SuggestGroup[]>(
    () => FAMILIES.map((f) => ({ id: f, label: t(`mistakeLab.family.${f}`), icon: MISTAKE_FAMILY_ICON[f] })),
    [t],
  )
  const mistakeOptions = useMemo<SuggestOption[]>(
    () => tags.map((tg) => ({ value: tg.slug, label: tagLabel(t, tg.isBuiltIn ? tg.slug : null, tg.label), group: tagFamily(tg.slug, tg.category) })),
    [tags, t],
  )
  const fundamentalGroups = useMemo<SuggestGroup[]>(
    () => categories.map((c) => ({ id: c.id, label: c.label, icon: FUNDAMENTAL_FAMILY_ICON[c.id] ?? Compass })),
    [categories],
  )
  const fundamentalOptions = useMemo<SuggestOption[]>(
    () => categories.flatMap((c) => c.fundamentals.map((f) => ({ value: f.id, label: f.label, group: c.id }))),
    [categories],
  )

  // ── What the typed text resolves to ──
  const typedMistake = form.mistake.trim()
  const knownMistake = useMemo(() => {
    const key = foldLabel(typedMistake)
    if (!key) return null
    return mistakeOptions.find((o) => foldLabel(o.label) === key)
      // The library label as stored (English for a built-in), or the slug itself.
      ?? mistakeOptions.find((o) => o.value === key.replace(/\s+/g, '-') || foldLabel(tags.find((tg) => tg.slug === o.value)?.label ?? '') === key)
      ?? null
  }, [typedMistake, mistakeOptions, tags])
  const newMistake = typedMistake.length >= 2 && !knownMistake
  const typedFundamental = form.fundamental.trim()
  const knownFundamental = useMemo(() => {
    const key = foldLabel(typedFundamental)
    return key ? fundamentalOptions.find((o) => foldLabel(o.label) === key || o.value === key) ?? null : null
  }, [typedFundamental, fundamentalOptions])

  const grouped = useMemo(() => groupCodexRules(rules ?? []), [rules])
  const labelOfMistake = (slug: string) => tagLabel(t, slug, tags.find((tg) => tg.slug === slug)?.label ?? slugAsLabel(slug))

  if (staffGroups.length === 0) return null
  const valid = (knownMistake || newMistake) && knownFundamental && form.headline.trim() && form.tacticalRule.trim() && form.drillObjective.trim()

  const add = async () => {
    if (!knownFundamental) return
    setSaving(true)
    try {
      let slug = knownMistake?.value
      if (!slug) {
        const category = NEW_MISTAKE_FAMILIES.find((x) => x.family === form.newMistakeFamily)?.category ?? 'macro'
        // The personal tag gives the coach the exact wording in their own library. Where the library
        // cannot be written (the web app), the rule is still stored under the same slug.
        try { slug = (await window.api.createMistakeTag({ label: typedMistake, category })).slug } catch { slug = mistakeSlug(typedMistake) }
      }
      for (const role of rolesToStore(form.roles)) {
        await window.api.teamCodexAdd({
          groupId, role, mistakeSlug: slug, phase: form.phase, fundamentalId: knownFundamental.value,
          headline: form.headline, tacticalRule: form.tacticalRule, drillObjective: form.drillObjective,
        })
      }
      setForm(emptyForm)
    } catch (err) {
      toast({ title: isUnavailable(err) ? t('coachMicro.unavailable') : t(collabErrorKey(err)), variant: 'destructive' })
    } finally {
      // Also after a failure: some roles of the rule may already be stored.
      await load()
      loadTags()
      setSaving(false)
    }
  }
  const remove = async (g: CodexRuleGroup) => {
    await Promise.all(g.ids.map((id) => window.api.teamCodexDelete(id).catch(() => {})))
    await load()
  }
  // Ticking the fifth role is "all roles": back to the empty selection, which is how "all" is stored.
  const toggleRole = (role: PlayedRole) => setForm((f) => {
    const next = f.roles.includes(role) ? f.roles.filter((r) => r !== role) : [...f.roles, role]
    return { ...f, roles: next.length === PLAYED_ROLES.length ? [] : next }
  })

  const chip = (on: boolean) => cn(
    'h-8 rounded border px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-hextech-gold',
    on ? 'border-hextech-gold bg-hextech-gold/15 text-hextech-gold-bright' : 'border-hextech-border-dim text-hextech-text hover:border-hextech-border hover:text-hextech-text-bright',
  )
  const allRoles = rolesToStore(form.roles)[0] === 'any'

  return (
    <section className={panel} data-testid="team-codex">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 text-base font-bold text-hextech-text-bright"><BookOpen className="h-4 w-4 text-hextech-cyan" />{t('coachMicro.codex.title')}</h3>
          <p className="mt-0.5 text-xs text-hextech-text">{t('coachMicro.codex.desc')}</p>
        </div>
      </div>
      {unavailable ? (
        <p className="mt-3 text-xs text-hextech-text-dim">{t('coachMicro.unavailable')}</p>
      ) : (
        <>
          <ul className="mt-3 space-y-2">
            {grouped.map((g) => (
              <li key={g.key} className="flex items-start gap-2 rounded-lg border border-hextech-border-dim p-2.5" data-testid="team-codex-rule">
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-hextech-cyan">
                    {labelOfMistake(g.rule.mistakeSlug)} · {g.roles.map((r) => t(`coachMicro.codex.role.${r}`)).join(', ')} · {t(`coachMicro.codex.phase.${g.rule.phase}`)}
                  </p>
                  <p className="text-sm font-semibold text-hextech-text-bright">{g.rule.headline}</p>
                  <p className="text-xs text-hextech-text">{g.rule.tacticalRule}</p>
                  <p className="mt-0.5 text-[11px] text-hextech-text-dim">{t('codex.drill')} : {g.rule.drillObjective}</p>
                </div>
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0" aria-label={t('coachMicro.codex.delete')} onClick={() => remove(g)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
            {rules?.length === 0 && <li className="text-xs text-hextech-text-dim">{t('coachMicro.codex.empty')}</li>}
          </ul>

          <div className="mt-4 grid grid-cols-1 gap-x-3 gap-y-2 sm:grid-cols-2" data-testid="team-codex-form">
            <div>
              <SuggestField
                testId="codex-mistake"
                label={t('coachMicro.codex.mistake')}
                placeholder={t('coachMicro.codex.mistakePlaceholder')}
                value={form.mistake}
                maxLength={60}
                onChange={(mistake) => setForm({ ...form, mistake })}
                groups={mistakeGroups}
                options={mistakeOptions}
                completionHint={(value) => t('coachMicro.codex.completion', { value })}
                suggestionsLabel={(family) => t('coachMicro.codex.suggestions', { family })}
                emptyGroupLabel={t('coachMicro.codex.noSuggestion')}
                hint={newMistake ? t('coachMicro.codex.newMistake') : undefined}
              />
              {newMistake && (
                <div className="mt-1 flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label={t('coachMicro.codex.newMistakeFamily')}>
                  <span className="text-[11px] text-hextech-text-dim">{t('coachMicro.codex.newMistakeFamily')}</span>
                  {NEW_MISTAKE_FAMILIES.map(({ family }) => (
                    <button key={family} type="button" role="radio" aria-checked={form.newMistakeFamily === family}
                      onClick={() => setForm({ ...form, newMistakeFamily: family })}
                      className={cn(chip(form.newMistakeFamily === family), 'h-6 px-2 text-[11px]')}>
                      {t(`mistakeLab.family.${family}`)}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <SuggestField
              testId="codex-fundamental"
              label={t('coachMicro.codex.fundamental')}
              placeholder={t('coachMicro.codex.fundamentalPlaceholder')}
              value={form.fundamental}
              onChange={(fundamental) => setForm({ ...form, fundamental })}
              groups={fundamentalGroups}
              options={fundamentalOptions}
              completionHint={(value) => t('coachMicro.codex.completion', { value })}
              suggestionsLabel={(family) => t('coachMicro.codex.suggestions', { family })}
              emptyGroupLabel={t('coachMicro.codex.noSuggestion')}
              invalid={typedFundamental.length >= 2 && !knownFundamental}
              hint={typedFundamental.length >= 2 && !knownFundamental ? <span className="text-hextech-red">{t('coachMicro.codex.unknownFundamental')}</span> : undefined}
            />

            <div>
              <p className={fieldLabel} id="codex-roles-label">{t('coachMicro.codex.rolesLabel')}</p>
              <div className="mt-1 flex flex-wrap gap-1.5" role="group" aria-labelledby="codex-roles-label">
                <button type="button" aria-pressed={allRoles} onClick={() => setForm({ ...form, roles: [] })} className={chip(allRoles)}>
                  {t('coachMicro.codex.role.any')}
                </button>
                {PLAYED_ROLES.map((r) => {
                  const on = !allRoles && form.roles.includes(r)
                  return (
                    <button key={r} type="button" aria-pressed={on} onClick={() => toggleRole(r)} className={chip(on)}>
                      {t(`coachMicro.codex.role.${r}`)}
                    </button>
                  )
                })}
              </div>
            </div>
            <div>
              <p className={fieldLabel} id="codex-phase-label">{t('coachMicro.codex.phaseLabel')}</p>
              <div className="mt-1 flex flex-wrap gap-1.5" role="radiogroup" aria-labelledby="codex-phase-label">
                {PHASES.map((p) => (
                  <button key={p} type="button" role="radio" aria-checked={form.phase === p} onClick={() => setForm({ ...form, phase: p })} className={chip(form.phase === p)}>
                    {t(`coachMicro.codex.phase.${p}`)}
                  </button>
                ))}
              </div>
            </div>

            <Input className="mt-1 sm:col-span-2" maxLength={140} value={form.headline} onChange={(e) => setForm({ ...form, headline: e.target.value })} placeholder={t('coachMicro.codex.headline')} aria-label={t('coachMicro.codex.headline')} />
            <Textarea className="text-xs sm:col-span-2" rows={2} maxLength={1000} value={form.tacticalRule} onChange={(e) => setForm({ ...form, tacticalRule: e.target.value })} placeholder={t('coachMicro.codex.rule')} aria-label={t('coachMicro.codex.rule')} />
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
