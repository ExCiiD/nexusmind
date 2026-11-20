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
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { CoachVerdictsLab } from '@/components/MicroReview/CoachVerdictsForGame'
import { AlertTriangle, Play, FlaskConical, Check, Loader2, Search, Crosshair, Tags } from 'lucide-react'
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip } from 'recharts'
import { Button } from '@/components/ui/button'
import { CodexCard } from '@/components/MicroReview/CodexCard'
import { usePrepareSession } from '@/components/MicroReview/usePrepareSession'
import { useTeamCodex } from '@/components/MicroReview/useTeamCodex'
import { codexFor, dominantPhase } from '@/lib/microReview/codex'
import { useUserStore } from '@/store/useUserStore'
import { cn } from '@/lib/utils'
import { championLabel } from '@/lib/statsInsights'
import { EmptyState, SkeletonKpiTiles } from '@/components/ui/data-state'
import {
  rankMistakes,
  phaseBreakdown,
  buildTrend,
  latestMoments,
  fmtClock,
  FAMILIES,
  FAMILY_COLOR,
  PHASES,
  type MistakeOccurrence,
  type MistakeFamily,
  type RankedMistake,
} from '@/lib/mistakeInsights'

type WindowDays = 7 | 14 | 30 | 90
const WINDOWS: WindowDays[] = [7, 14, 30, 90]
const ROLES = ['', 'TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'] as const
const panel = 'panel-surface rounded-2xl border border-hextech-border-dim/70 shadow-lg backdrop-blur-sm'

export function MistakeStatsPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [windowDays, setWindowDays] = useState<WindowDays>(30)
  const [role, setRole] = useState<string>('')
  const [champion, setChampion] = useState('')
  const [occ, setOcc] = useState<MistakeOccurrence[] | null>(null)
  const [family, setFamily] = useState<MistakeFamily | 'all'>('all')
  const [focus, setFocus] = useState<string | null>(null)
  const [experiment, setExperiment] = useState<'idle' | 'busy' | 'done' | 'error'>('idle')
  const mainRole = useUserStore((s) => s.user?.mainRole ?? '')

  useEffect(() => {
    let cancelled = false
    setOcc(null)
    window.api.getMistakeOccurrences({ days: windowDays, role: role || null, champion: champion.trim() || null })
      .then((rows) => { if (!cancelled) setOcc(rows) })
      .catch(() => { if (!cancelled) setOcc([]) })
    return () => { cancelled = true }
  }, [windowDays, role, champion])

  const ranking = useMemo(() => rankMistakes(occ ?? []), [occ])
  const visible = useMemo(() => (family === 'all' ? ranking : ranking.filter((r) => r.family === family)), [ranking, family])
  // Keep the inspector on a tag that exists in the current filter.
  const focused = visible.find((r) => r.slug === focus) ?? visible[0] ?? null
  useEffect(() => { setExperiment('idle') }, [focused?.slug])

  const trendSlugs = useMemo(() => {
    const top = visible.slice(0, 3).map((r) => r.slug)
    return focused && !top.includes(focused.slug) ? [focused.slug, ...top.slice(0, 2)] : top
  }, [visible, focused])
  const trend = useMemo(() => buildTrend(occ ?? [], trendSlugs), [occ, trendSlugs])

  const games = new Set((occ ?? []).map((o) => o.game.id)).size
  const allPhases = phaseBreakdown(occ ?? [])
  const worstPhase = PHASES.reduce((a, b) => (allPhases[b] > allPhases[a] ? b : a), 'early')

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
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label={t('mistakeLab.kpi.total')} value={String(occ.length)} sub={t('mistakeLab.kpi.games', { count: games })} />
            <Stat label={t('mistakeLab.kpi.perGame')} value={(occ.length / Math.max(games, 1)).toFixed(1)} sub={t('mistakeLab.kpi.perGameSub')} />
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
                {visible.length === 0 ? (
                  <p className="py-6 text-center text-xs text-hextech-text-dim">{t('mistakeLab.ranking.none')}</p>
                ) : (
                  <ol className="space-y-1">
                    {visible.map((r) => (
                      <li key={r.tagId}>
                        <RankRow row={r} max={visible[0].count} active={focused?.slug === r.slug} onClick={() => setFocus(r.slug)} />
                      </li>
                    ))}
                  </ol>
                )}
                <p className="mt-3 text-[11px] text-hextech-text-dim">{t('mistakeLab.ranking.legend')}</p>
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
                  occ={(occ ?? []).filter((o) => o.tag.slug === focused.slug)}
                  moments={latestMoments(occ ?? [], focused.slug)}
                  role={role || mainRole}
                  experiment={experiment}
                  onExperiment={startExperiment}
                  onReplay={(o) => navigate(`/record/${o.recordingId}?at=${o.gameTimeSec}`)}
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

function RankRow({ row, max, active, onClick }: { row: RankedMistake; max: number; active: boolean; onClick: () => void }) {
  const { t } = useTranslation()
  const cost = row.winrateWith != null && row.winrateWithout != null ? row.winrateWith - row.winrateWithout : null
  return (
    <button onClick={onClick} aria-pressed={active}
      className={cn('grid w-full grid-cols-[minmax(0,11rem)_minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors',
        active ? 'bg-hextech-elevated ring-1 ring-hextech-gold/60' : 'hover:bg-hextech-elevated/60')}>
      <span className="flex min-w-0 items-center gap-2">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: row.color }} />
        <span className="truncate text-xs font-medium text-hextech-text-bright" title={row.label}>{row.label}</span>
      </span>
      <span className="flex min-w-0 items-center gap-2">
        <span className="h-3 rounded-sm" style={{ width: `${Math.max(4, (row.count / max) * 100)}%`, backgroundColor: row.color, opacity: active ? 1 : 0.75 }} />
        <span className="shrink-0 font-mono text-[11px] text-hextech-text-bright">{row.count}× <span className="text-hextech-text-dim">· {row.share}%</span></span>
      </span>
      <span className={cn('w-20 text-right font-mono text-[11px]', cost == null ? 'text-hextech-text-dim' : cost < 0 ? 'text-hextech-red' : 'text-hextech-green')}
        title={t('mistakeLab.ranking.costTitle')}>
        {cost == null ? '—' : `${cost > 0 ? '+' : ''}${cost} pts`}
      </span>
    </button>
  )
}

function Inspector({ row, occ, moments, role, experiment, onExperiment, onReplay }: {
  row: RankedMistake
  occ: MistakeOccurrence[]
  moments: MistakeOccurrence[]
  role: string
  experiment: 'idle' | 'busy' | 'done' | 'error'
  onExperiment: () => void
  onReplay: (o: MistakeOccurrence) => void
}) {
  const { t } = useTranslation()
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
          {t('mistakeLab.inspector.summary', { count: row.count, games: row.games, share: row.share })}
        </p>
        {row.winrateWith != null && row.winrateWithout != null && (
          <p className="mt-2 rounded-lg border border-hextech-border-dim bg-hextech-black/30 px-3 py-2 text-xs text-hextech-text-bright">
            {t('mistakeLab.inspector.cost', { with: row.winrateWith, without: row.winrateWithout })}
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
            <CodexCard entry={prescription} onPrepare={() => prepare(prescription)} />
          </div>
        ) : (
          <p className="mt-3 text-[11px] text-hextech-text-dim">{t('codex.none')}</p>
        )}
      </div>

      <div>
        <h3 className="font-mono mb-2 text-[11px] font-semibold uppercase tracking-wider text-hextech-text-dim">{t('mistakeLab.inspector.moments')}</h3>
        <ul className="divide-y divide-hextech-border-dim/50 rounded-lg border border-hextech-border-dim">
          {moments.map((o) => (
            <li key={o.id} className="flex items-center gap-3 px-3 py-2">
              <span className="font-mono text-xs font-semibold" style={{ color: row.color }}>{fmtClock(o.gameTimeSec)}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs text-hextech-text-bright">
                  {championLabel(o.game.champion)}{o.game.opponentChampion ? ` vs ${championLabel(o.game.opponentChampion)}` : ''}
                  <span className={cn('ml-1.5 text-[10px] font-semibold', o.game.win ? 'text-hextech-green' : 'text-hextech-red')}>{o.game.win ? t('mistakeLab.win') : t('mistakeLab.loss')}</span>
                </span>
                <span className="block truncate text-[10px] text-hextech-text-dim">{new Date(o.game.gameEndAt).toLocaleDateString()}{o.note ? ` · ${o.note}` : ''}</span>
              </span>
              {o.recordingId ? (
                <Button size="sm" variant="outline" className="h-8 shrink-0 gap-1 text-[11px]" onClick={() => onReplay(o)}>
                  <Play className="h-3 w-3" />{t('mistakeLab.inspector.replay')}
                </Button>
              ) : (
                <span className="shrink-0 text-[10px] text-hextech-text-dim">{t('mistakeLab.inspector.noVod')}</span>
              )}
            </li>
          ))}
        </ul>
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
