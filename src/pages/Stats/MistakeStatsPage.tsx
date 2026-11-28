/**
 * Mistake Lab (Stats → Erreurs) — rebuilt from the UI/UX audit of
 * 17/11/2026 ("audit_ui_ux_mistake_library.md"):
 *   - full-width 12-column bento instead of a narrow centred column;
 *   - one interactive ranking (count, share, win-rate cost, severity
 *     colour) instead of three charts repeating the same tags;
 *   - 4 families instead of a 26-pill tag cloud;
 *   - a trend that switches to per-game buckets on short histories;
 *   - game-phase matrix (early / mid / late) instead of a 2-column heatmap;
 *   - every mistake leads somewhere: rewatch the exact moment, or start a
 *     measured experiment on it.
 * Pure read-side except the explicit "work on it" button.
 */
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useScrollMemory } from '@/hooks/useScrollMemory'
import { LAB_ROLES, LAB_WINDOWS, parseLabParams, patchLabParams, type LabUrlState } from '@/lib/mistakeLabUrl'
import { useTranslation } from 'react-i18next'
import { CoachVerdictsLab } from '@/components/MicroReview/CoachVerdictsForGame'
import { AlertTriangle, Play, FlaskConical, Check, Loader2, Search, Crosshair, Tags, ChevronDown, Trash2 } from 'lucide-react'
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip } from 'recharts'
import { Button } from '@/components/ui/button'
import { CodexCard } from '@/components/MicroReview/CodexCard'
import { usePrepareSession } from '@/components/MicroReview/usePrepareSession'
import { useTeamCodex } from '@/components/MicroReview/useTeamCodex'
import { codexFor, dominantPhase } from '@/lib/microReview/codex'
import { useUserStore } from '@/store/useUserStore'
import { useToast } from '@/hooks/useToast'
import { cn } from '@/lib/utils'
import { championLabel } from '@/lib/statsInsights'
import { EmptyState, SkeletonKpiTiles } from '@/components/ui/data-state'
import { useCachedQuery } from '@/hooks/useCachedQuery'
import { mistakeOccurrencesKey } from '@/lib/pageQueries'
import { TierBar, TierChips, TierLegend, TierPill, barLabel, tierLine } from './MistakeTierParts'
import { mistakePlayFromSec } from '@/lib/microReview/playbackWindow'
import { localizeDetectedNote, type Translate } from '@/lib/detectedMistakeNote'
import {
  rankMistakes,
  phaseBreakdown,
  buildTrend,
  latestMoments,
  hasComparison,
  fmtClock,
  FAMILIES,
  FAMILY_COLOR,
  PHASES,
  hasTiers,
  inTierScope,
  sortRanking,
  tagFamily,
  tierCounts,
  type RankSort,
  type TierFilter,
  type MistakeOccurrence,
  type MistakeFamily,
  type RankedMistake,
} from '@/lib/mistakeInsights'

const WINDOWS = LAB_WINDOWS
const ROLES = LAB_ROLES
const panel = 'panel-surface rounded-2xl border border-hextech-border-dim/70 shadow-lg backdrop-blur-sm'

const NO_OCCURRENCES: MistakeOccurrence[] = []

export function MistakeStatsPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  // The whole Lab state lives in the URL (period, role, champion, family, tier, sort, selected mistake, expanded list): « Rewatch » → back
  // restores it exactly. Updates replace the history entry, so the filters never pile up behind the back button.
  const [searchParams, setSearchParams] = useSearchParams()
  const lab = useMemo(() => parseLabParams(searchParams), [searchParams])
  const patch = (p: Partial<LabUrlState>) => setSearchParams((cur) => patchLabParams(cur, p), { replace: true })
  const { days: windowDays, role, champion, family, tier, sort, focus, showAll: momentsExpanded } = lab
  const setWindowDays = (days: LabUrlState['days']) => patch({ days })
  const setRole = (r: string) => patch({ role: r })
  const setChampion = (c: string) => patch({ champion: c })
  const setFamily = (f: MistakeFamily | 'all') => patch({ family: f })
  const setTier = (x: TierFilter) => patch({ tier: x })
  const setSort = (x: RankSort) => patch({ sort: x })
  // Another mistake picked: back to the short list of moments.
  const setFocus = (slug: string | null) => patch({ focus: slug, showAll: false })
  const [experiment, setExperiment] = useState<'idle' | 'busy' | 'done' | 'error'>('idle')
  const mainRole = useUserStore((s) => s.user?.mainRole ?? '')

  // Perf gain 3: one cache entry per filter; coming back shows the last one at once.
  const filter = { days: windowDays, role: role || null, champion: champion.trim() || null }
  const occQuery = useCachedQuery<MistakeOccurrence[]>(mistakeOccurrencesKey(filter), () => window.api.getMistakeOccurrences(filter))
  const occ: MistakeOccurrence[] | null = occQuery.data ?? (occQuery.error ? NO_OCCURRENCES : null)
  useScrollMemory(occ !== null)

  const tiersKnown = useMemo(() => hasTiers(occ ?? []), [occ])
  // Tier scope: « all tiers » leaves the trivial mistakes out, a picked tier keeps only that tier (the filters combine with the family).
  const activeTier: TierFilter = tiersKnown ? tier : 'all'
  const ranking = useMemo(() => rankMistakes(occ ?? [], activeTier), [occ, activeTier])
  const visible = useMemo(() => sortRanking(family === 'all' ? ranking : ranking.filter((r) => r.family === family), tiersKnown ? sort : 'frequency'), [ranking, family, sort, tiersKnown])
  const scopedOcc = useMemo(() => (occ ?? []).filter((o) => inTierScope(o, activeTier)), [occ, activeTier])
  const chipCounts = useMemo(() => tierCounts((occ ?? []).filter((o) => family === 'all' || tagFamily(o.tag.slug, o.tag.category) === family)), [occ, family])
  const fatalTotal = useMemo(() => (occ ?? []).filter((o) => o.tier === 'fatal').length, [occ])
  // Keep the inspector on a tag that exists in the current filter.
  const focused = visible.find((r) => r.slug === focus) ?? visible[0] ?? null
  useEffect(() => { setExperiment('idle') }, [focused?.slug])

  const trendSlugs = useMemo(() => {
    const top = visible.slice(0, 3).map((r) => r.slug)
    return focused && !top.includes(focused.slug) ? [focused.slug, ...top.slice(0, 2)] : top
  }, [visible, focused])
  const trend = useMemo(() => buildTrend(scopedOcc, trendSlugs), [scopedOcc, trendSlugs])

  const games = new Set((occ ?? []).map((o) => o.game.id)).size
  const allPhases = phaseBreakdown(occ ?? [])
  const worstPhase = PHASES.reduce((a, b) => (allPhases[b] > allPhases[a] ? b : a), 'early')

  const { toast } = useToast()
  // Same call as the Record's mistake list (deleteMistake): the mistake is gone from the game, the Lab reloads its figures.
  const deleteOccurrence = async (o: MistakeOccurrence) => {
    try {
      await window.api.deleteMistake(o.id)
      await occQuery.reload()
      toast({ title: t('mistakeLab.inspector.deleted') })
    } catch (err) {
      toast({ title: t('record.toast.mistakeDeleteFailed'), description: (err as Error)?.message ?? t('record.toast.unknownError'), variant: 'destructive' })
    }
  }

  const startExperiment = async () => {
    if (!focused) return
    setExperiment('busy')
    try {
      await window.api.coachStartTagExperiment(focused.slug)
      setExperiment('done')
    } catch {
      setExperiment('error')
    }
  }

  return (
    <div className="w-full space-y-4 py-2">
      {/* Title + compact toolbar on one line */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 font-display text-2xl font-extrabold text-hextech-text-bright">
            <AlertTriangle className="h-5 w-5 text-hextech-gold" /> {t('mistakeLab.title')}
          </h1>
          <p className="mt-0.5 text-sm text-hextech-text">{t('mistakeLab.subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-hextech-border-dim p-0.5" role="group" aria-label={t('mistakeLab.period')}>
            {WINDOWS.map((d) => (
              <button key={d} onClick={() => setWindowDays(d)} aria-pressed={windowDays === d}
                className={cn('rounded-md px-3 py-1.5 text-xs font-semibold transition-colors', windowDays === d ? 'bg-hextech-gold text-hextech-black' : 'text-hextech-text-bright hover:bg-hextech-elevated')}>
                {t('mistakeLab.days', { count: d })}
              </button>
            ))}
          </div>
          <label className="sr-only" htmlFor="ml-role">{t('mistakeLab.role')}</label>
          <select id="ml-role" value={role} onChange={(e) => setRole(e.target.value)}
            className="h-9 rounded-lg border border-hextech-border-dim bg-hextech-elevated px-2 text-xs text-hextech-text-bright">
            {ROLES.map((r) => <option key={r} value={r}>{t(`mistakeLab.roles.${r || 'any'}`)}</option>)}
          </select>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-hextech-text-dim" />
            <input value={champion} onChange={(e) => setChampion(e.target.value)} placeholder={t('mistakeLab.championPlaceholder')} aria-label={t('mistakeLab.champion')}
              className="h-9 w-48 rounded-lg border border-hextech-border-dim bg-hextech-elevated pl-7 pr-2 text-xs text-hextech-text-bright placeholder:text-hextech-text-dim" />
          </div>
        </div>
      </div>

      {/* § 18.5 L3: the coach's verdicts on the mistakes shown (the focused one alone when one is picked). */}
      {occ && occ.length > 0 && (
        <CoachVerdictsLab days={windowDays} tags={new Map(occ.filter((o) => !focus || o.tag.slug === focus).map((o) => [o.tag.slug, o.tag.label]))} />
      )}

      {occ === null ? (
        <SkeletonKpiTiles />
      ) : occ.length === 0 ? (
        <EmptyState icon={Tags} title={t('mistakeLab.empty')} description={t('mistakeLab.emptyHint')} />
      ) : (
        <>
          {/* Summary strip */}
          <div className={cn('grid grid-cols-2 gap-3', tiersKnown ? 'lg:grid-cols-5' : 'lg:grid-cols-4')}>
            <Stat label={t('mistakeLab.kpi.total')} value={String(occ.length)} sub={t('mistakeLab.kpi.games', { count: games })} />
            <Stat label={t('mistakeLab.kpi.perGame')} value={(occ.length / Math.max(games, 1)).toFixed(1)} sub={t('mistakeLab.kpi.perGameSub')} />
            {tiersKnown && <Stat label={t('mistakeLab.kpi.fatal')} value={String(fatalTotal)} sub={t('mistakeLab.kpi.fatalSub', { total: occ.length, perGame: (fatalTotal / Math.max(games, 1)).toFixed(1) })} />}
            <Stat label={t('mistakeLab.kpi.top')} value={ranking[0]?.label ?? '—'} sub={ranking[0] ? t('mistakeLab.kpi.topSub', { count: ranking[0].count, share: ranking[0].share }) : ''} color={ranking[0]?.color} small />
            <Stat label={t('mistakeLab.kpi.phase')} value={t(`mistakeLab.phase.${worstPhase}`)} sub={t('mistakeLab.kpi.phaseSub', { share: Math.round((allPhases[worstPhase] / occ.length) * 100) })} small />
          </div>

          <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-12">
            {/* Left: ranking + trend */}
            <div className="space-y-4 xl:col-span-7">
              <section className={cn(panel, 'p-4')}>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-bold text-hextech-text-bright">{t('mistakeLab.ranking.title')}</h2>
                  <div className="flex flex-wrap gap-1" role="tablist" aria-label={t('mistakeLab.families')}>
                    {(['all', ...FAMILIES] as const).map((f) => (
                      <button key={f} role="tab" aria-selected={family === f} onClick={() => setFamily(f)}
                        className={cn('flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
                          family === f ? 'border-hextech-gold bg-hextech-gold/15 text-hextech-gold-bright' : 'border-hextech-border-dim text-hextech-text hover:border-hextech-border')}>
                        {f !== 'all' && <span className="h-2 w-2 rounded-full" style={{ backgroundColor: FAMILY_COLOR[f] }} />}
                        {t(`mistakeLab.family.${f}`)}
                      </button>
                    ))}
                  </div>
                </div>
                {tiersKnown && (
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <TierChips value={activeTier} onChange={setTier} counts={chipCounts} showTrivial={chipCounts.trivial > 0 || activeTier === 'trivial'} />
                    <div className="flex items-center gap-1.5" role="group" aria-label={t('mistakeLab.sort.label')}>
                      <span className="font-mono text-[10px] uppercase tracking-wider text-hextech-text-dim">{t('mistakeLab.sort.label')}</span>
                      {(['frequency', 'severity'] as const).map((k) => (
                        <button key={k} type="button" aria-pressed={sort === k} onClick={() => setSort(k)}
                          className={cn('rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors', sort === k ? 'border-hextech-gold bg-hextech-gold/15 text-hextech-gold-bright' : 'border-hextech-border-dim text-hextech-text hover:border-hextech-border')}>
                          {t(`mistakeLab.sort.${k}`)}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {visible.length === 0 ? (
                  activeTier !== 'all' ? (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-hextech-border-dim bg-hextech-black/30 px-3 py-3 text-xs text-hextech-text-dim">
                      <span>{t(`mistakeLab.tier.emptyTier.${activeTier}`, { days: windowDays })}</span>
                      <Button size="sm" variant="outline" onClick={() => setTier('all')}>{t('mistakeLab.tier.seeAll')}</Button>
                    </div>
                  ) : <p className="py-6 text-center text-xs text-hextech-text-dim">{t('mistakeLab.ranking.none')}</p>
                ) : (
                  <ol className="space-y-1">
                    {visible.map((r) => (
                      <li key={r.tagId}>
                        <RankRow row={r} max={Math.max(...visible.map((x) => x.count))} active={focused?.slug === r.slug} onClick={() => setFocus(r.slug)} tiers={tiersKnown} tierPicked={activeTier !== 'all'} />
                      </li>
                    ))}
                  </ol>
                )}
                {tiersKnown && <div className="mt-3"><TierLegend showTrivial={chipCounts.trivial > 0 || activeTier === 'trivial'} /></div>}
                {tiersKnown && activeTier !== 'all' && (
                  <p className="mt-2 text-[11px] text-hextech-text-dim">{t('mistakeLab.tier.footPicked', { tier: ((x) => x.charAt(0).toUpperCase() + x.slice(1))(t(`mistakeLab.tier.plural.${activeTier}`, { count: 2 })), n: scopedOcc.length, total: occ.length, lower: t(`mistakeLab.tier.plural.${activeTier}`, { count: 2 }) })}</p>
                )}
                {tiersKnown && activeTier === 'all' && chipCounts.trivial > 0 && (
                  <p className="mt-2 text-[11px] text-hextech-text-dim">{t('mistakeLab.tier.trivialHidden', { count: chipCounts.trivial })}</p>
                )}
                <p className="mt-2 text-[11px] text-hextech-text-dim">{t('mistakeLab.ranking.legend')}</p>
              </section>

              <section className={cn(panel, 'p-4')}>
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-sm font-bold text-hextech-text-bright">{t('mistakeLab.trend.title')}</h2>
                  <span className="text-[11px] text-hextech-text-dim">{t(`mistakeLab.trend.mode.${trend.mode}`)}</span>
                </div>
                {trend.points.length < 2 ? (
                  <p className="py-8 text-center text-xs text-hextech-text-dim">{t('mistakeLab.trend.notEnough')}</p>
                ) : (
                  <>
                    <ResponsiveContainer width="100%" height={220}>
                      <LineChart data={trend.points.map((p) => ({ label: p.label, ...p.counts }))} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--hextech-border-dim)" />
                        <XAxis dataKey="label" tick={{ fill: 'var(--hextech-text)', fontSize: 11 }} />
                        <YAxis allowDecimals={false} tick={{ fill: 'var(--hextech-text)', fontSize: 11 }} />
                        <RTooltip contentStyle={{ background: 'var(--hextech-dark)', border: '1px solid var(--hextech-border-dim)', borderRadius: 8, fontSize: 12 }} />
                        {trendSlugs.map((slug, i) => {
                          const r = ranking.find((x) => x.slug === slug)
                          return <Line key={slug} type="linear" dataKey={slug} name={r?.label ?? slug} stroke={i === 0 ? r?.color : ['#C9C5BA', '#7C8794'][i - 1] ?? '#999'} strokeWidth={i === 0 ? 2.5 : 1.5} dot={{ r: 2.5 }} />
                        })}
                      </LineChart>
                    </ResponsiveContainer>
                    <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-hextech-text">
                      {trendSlugs.map((slug, i) => {
                        const r = ranking.find((x) => x.slug === slug)
                        return <span key={slug} className="flex items-center gap-1.5"><span className="h-0.5 w-4" style={{ backgroundColor: i === 0 ? r?.color : ['#C9C5BA', '#7C8794'][i - 1] }} />{r?.label}</span>
                      })}
                    </div>
                  </>
                )}
              </section>
            </div>

            {/* Right: inspector for the selected mistake */}
            <aside className={cn(panel, 'space-y-4 p-4 xl:sticky xl:top-2 xl:col-span-5')} aria-label={t('mistakeLab.inspector.title')}>
              {focused ? (
                <Inspector
                  row={focused}
                  occ={scopedOcc.filter((o) => o.tag.slug === focused.slug)}
                  moments={latestMoments(scopedOcc, focused.slug, Infinity)}
                  showAll={momentsExpanded}
                  onShowAll={(v) => patch({ showAll: v })}
                  tiers={tiersKnown}
                  tierPicked={activeTier}
                  onDelete={deleteOccurrence}
                  role={role || mainRole}
                  experiment={experiment}
                  onExperiment={startExperiment}
                  onReplay={(o) => navigate(`/record/${o.recordingId}?at=${mistakePlayFromSec({ gameTimeSec: o.gameTimeSec, tagSlug: o.tag.slug, autoDetected: o.autoDetected })}`)}
                />
              ) : (
                <p className="py-8 text-center text-xs text-hextech-text-dim">{t('mistakeLab.inspector.pick')}</p>
              )}
            </aside>
          </div>
        </>
      )}
    </div>
  )
}

function Stat({ label, value, sub, color, small }: { label: string; value: string; sub: string; color?: string; small?: boolean }) {
  return (
    <div className={cn(panel, 'rounded-xl p-3.5')}>
      <div className="text-[11px] font-medium text-hextech-text">{label}</div>
      <div className={cn('mt-1 truncate font-bold text-hextech-text-bright', small ? 'text-base' : 'font-mono text-2xl')} style={color ? { color } : undefined} title={value}>{value}</div>
      <div className="mt-0.5 truncate text-[11px] text-hextech-text-dim">{sub}</div>
    </div>
  )
}

function RankRow({ row, max, active, onClick, tiers, tierPicked }: { row: RankedMistake; max: number; active: boolean; onClick: () => void; tiers: boolean; tierPicked: boolean }) {
  const { t } = useTranslation()
  const cost = hasComparison(row) ? row.winrateWith! - row.winrateWithout! : null
  const fatal = row.tiers.fatal
  return (
    <button onClick={onClick} aria-pressed={active}
      className={cn('grid w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors', tiers ? 'grid-cols-[minmax(0,11rem)_minmax(0,1fr)_3.5rem_auto]' : 'grid-cols-[minmax(0,11rem)_minmax(0,1fr)_auto]',
        active ? 'bg-hextech-elevated ring-1 ring-hextech-gold/60' : 'hover:bg-hextech-elevated/60')}>
      <span className="flex min-w-0 items-center gap-2">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: row.color }} />
        <span className="truncate text-xs font-medium text-hextech-text-bright" title={row.label}>{row.label}</span>
      </span>
      <span className="flex min-w-0 items-center gap-2">
        {tiers
          ? <TierBar counts={row.tiers} color={row.color} width={(row.count / max) * 0.8} tooltip label={barLabel(row.count, row.tiers, t)} className="shrink-0" />
          : <span className="h-3 rounded-sm" style={{ width: `${Math.max(4, (row.count / max) * 100)}%`, backgroundColor: row.color, opacity: active ? 1 : 0.75 }} />}
        <span className="shrink-0 font-mono text-[11px] text-hextech-text-bright">{row.count}× <span className="text-hextech-text-dim">· {row.share}%</span></span>
      </span>
      {tiers && (
        <span className="text-right font-mono text-[11px] font-bold" style={{ color: row.color }} title={t('mistakeLab.tier.fatalCol')}>
          {!tierPicked && fatal > 0 ? <>{fatal} <span aria-hidden className="text-[9px] tracking-tight">●●●</span><span className="sr-only">{t('mistakeLab.tier.plural.fatal', { count: fatal })}</span></> : null}
        </span>
      )}
      <span className={cn('w-20 text-right font-mono text-[11px]', cost == null ? 'text-hextech-text-dim' : cost < 0 ? 'text-hextech-red' : 'text-hextech-green')}
        title={t('mistakeLab.ranking.costTitle')}>
        {cost == null ? '—' : `${cost > 0 ? '+' : ''}${cost} pts`}
      </span>
    </button>
  )
}

const MOMENTS_COLLAPSED = 3

function Inspector({ row, occ, moments, showAll, onShowAll, tiers, tierPicked, role, experiment, onExperiment, onReplay, onDelete }: {
  row: RankedMistake
  tiers: boolean
  tierPicked: TierFilter
  occ: MistakeOccurrence[]
  moments: MistakeOccurrence[]
  showAll: boolean
  onShowAll: (v: boolean) => void
  role: string
  experiment: 'idle' | 'busy' | 'done' | 'error'
  onExperiment: () => void
  onReplay: (o: MistakeOccurrence) => void
  onDelete: (o: MistakeOccurrence) => Promise<void>
}) {
  const { t } = useTranslation()
  const [confirming, setConfirming] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  // Another mistake picked: back to the short list.
  useEffect(() => { setConfirming(null) }, [row.slug])
  const shownMoments = showAll ? moments : moments.slice(0, MOMENTS_COLLAPSED)
  const phases = phaseBreakdown(occ)
  const total = Math.max(occ.length, 1)
  const prepare = usePrepareSession()
  const teamRules = useTeamCodex()
  const phase = dominantPhase(occ.map((o) => o.gameTimeSec))
  const prescription = codexFor(row.slug, role, phase, teamRules)
  const garbage = occ.filter((o) => o.garbageTime).length
  return (
    <>
      <div>
        <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: row.color }}>{t(`mistakeLab.family.${row.family}`)}</span>
        <h2 className="mt-0.5 text-lg font-bold text-hextech-text-bright">{row.label}</h2>
        <p className="mt-1 text-xs text-hextech-text">
          {tierPicked !== 'all'
            ? t('mistakeLab.tier.inspectorPicked', { tier: t(`mistakeLab.tier.plural.${tierPicked}`, { count: row.count }), count: row.count, games: row.games, gw: t('mistakeLab.tier.gamesWord', { count: row.games }), name: t(`mistakeLab.tier.chip.${tierPicked}`) })
            : t('mistakeLab.inspector.summary', { count: row.count, games: row.games, share: row.share })}
        </p>
        {tiers && (
          <div className="mt-2">
            <TierBar counts={row.tiers} color={row.color} height={12} label={barLabel(row.count, row.tiers, t)} />
            <p className="mt-1.5 font-mono text-[11px] text-hextech-text-dim">{tierLine(row.tiers, t as (k: string, o?: Record<string, unknown>) => string)}</p>
          </div>
        )}
        {row.winrateWith != null && (
          <p className="mt-2 rounded-lg border border-hextech-border-dim bg-hextech-black/30 px-3 py-2 text-xs text-hextech-text-bright">
            {hasComparison(row)
              ? t('mistakeLab.inspector.cost', { with: row.winrateWith, withGames: row.gamesWith, without: row.winrateWithout, withoutGames: row.gamesWithout })
              : t('mistakeLab.inspector.costFew', { with: row.winrateWith, withGames: row.gamesWith, withoutGames: row.gamesWithout })}
          </p>
        )}
      </div>

      <div>
        <h3 className="font-mono mb-2 text-[11px] font-semibold uppercase tracking-wider text-hextech-text-dim">{t('mistakeLab.inspector.when')}</h3>
        <div className="grid grid-cols-3 gap-2">
          {PHASES.map((p) => {
            const share = Math.round((phases[p] / total) * 100)
            return (
              <div key={p} className="rounded-lg border border-hextech-border-dim p-2.5">
                <div className="text-[11px] text-hextech-text">{t(`mistakeLab.phase.${p}`)}</div>
                <div className="text-[10px] text-hextech-text-dim">{t(`mistakeLab.phaseRange.${p}`)}</div>
                <div className="mt-1.5 font-mono text-lg font-bold text-hextech-text-bright">{phases[p]}</div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-hextech-elevated"><div className="h-full rounded-full" style={{ width: `${share}%`, backgroundColor: row.color }} /></div>
              </div>
            )
          })}
        </div>
        {garbage > 0 && <p className="mt-2 text-[11px] text-hextech-text-dim">{t('mistakeLab.inspector.garbage', { count: garbage })}</p>}
        {prescription ? (
          <div className="mt-3">
            {phase && <p className="mb-1.5 text-[11px] text-hextech-text">{t('codex.whenTitle', { phase: t(`mistakeLab.phase.${phase}`) })}</p>}
            <CodexCard entry={prescription} collapsible onPrepare={() => prepare(prescription)} />
          </div>
        ) : (
          <p className="mt-3 text-[11px] text-hextech-text-dim">{t('codex.none')}</p>
        )}
      </div>

      <div>
        <h3 className="font-mono mb-2 text-[11px] font-semibold uppercase tracking-wider text-hextech-text-dim">{t('mistakeLab.inspector.moments')}</h3>
        <ul className="divide-y divide-hextech-border-dim/50 rounded-lg border border-hextech-border-dim">
          {shownMoments.map((o) => (
            <li key={o.id} className="flex items-center gap-3 px-3 py-2">
              <span className="font-mono text-xs font-semibold" style={{ color: row.color }}>{fmtClock(o.gameTimeSec)}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs text-hextech-text-bright">
                  {championLabel(o.game.champion)}{o.game.opponentChampion ? ` vs ${championLabel(o.game.opponentChampion)}` : ''}
                  <span className={cn('ml-1.5 text-[10px] font-semibold', o.game.win ? 'text-hextech-green' : 'text-hextech-red')}>{o.game.win ? t('mistakeLab.win') : t('mistakeLab.loss')}</span>
                </span>
                <span className="block truncate text-[10px] text-hextech-text-dim">{new Date(o.game.gameEndAt).toLocaleDateString()}{o.note ? ` · ${localizeDetectedNote(o.note, t as Translate)}` : ''}</span>
                {tiers && <span className="mt-1 block"><TierPill o={o} color={row.color} /></span>}
              </span>
              {o.recordingId ? (
                <Button size="sm" variant="outline" className="h-8 shrink-0 gap-1 text-[11px]" onClick={() => onReplay(o)}>
                  <Play className="h-3 w-3" />{t('mistakeLab.inspector.replay')}
                </Button>
              ) : (
                <span className="shrink-0 text-[10px] text-hextech-text-dim">{t('mistakeLab.inspector.noVod')}</span>
              )}
              {confirming === o.id ? (
                <span className="flex shrink-0 items-center gap-1">
                  <Button size="sm" variant="destructive" className="h-8 text-[11px]" disabled={deleting === o.id}
                    onClick={async () => { setDeleting(o.id); try { await onDelete(o) } finally { setDeleting(null); setConfirming(null) } }}>
                    {deleting === o.id ? <Loader2 className="h-3 w-3 animate-spin" /> : t('mistakeLab.inspector.deleteConfirm')}
                  </Button>
                  <Button size="sm" variant="ghost" className="h-8 text-[11px]" onClick={() => setConfirming(null)}>{t('common.cancel')}</Button>
                </span>
              ) : (
                <button type="button" onClick={() => setConfirming(o.id)} title={t('mistakeLab.inspector.delete')} aria-label={t('mistakeLab.inspector.delete')}
                  className="shrink-0 rounded p-1.5 text-hextech-text-dim hover:bg-hextech-red/10 hover:text-hextech-red focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
        {moments.length > MOMENTS_COLLAPSED && (
          <Button type="button" size="sm" variant="outline" className="mt-2 w-full gap-1.5" aria-expanded={showAll} onClick={() => onShowAll(!showAll)}>
            <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', showAll && 'rotate-180')} aria-hidden />
            {showAll ? t('mistakeLab.inspector.showLess') : t('mistakeLab.inspector.showAll', { count: moments.length })}
          </Button>
        )}
      </div>

      <div className="rounded-lg border border-hextech-gold/30 bg-gradient-to-r from-hextech-gold/10 to-transparent p-3">
        <p className="flex items-start gap-2 text-xs text-hextech-text-bright"><Crosshair className="mt-0.5 h-3.5 w-3.5 shrink-0 text-hextech-gold" />{t('mistakeLab.inspector.actionHint')}</p>
        <Button size="sm" className="mt-2.5 w-full gap-1.5" onClick={onExperiment} disabled={experiment === 'busy' || experiment === 'done'}>
          {experiment === 'busy' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : experiment === 'done' ? <Check className="h-3.5 w-3.5" /> : <FlaskConical className="h-3.5 w-3.5" />}
          {t(`mistakeLab.inspector.action.${experiment}`)}
        </Button>
      </div>
    </>
  )
}

export default MistakeStatsPage
