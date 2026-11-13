/**
 * Lane Phase Comparator — single-game page.
 *
 * Shows a side-by-side breakdown of the laning phase (0–14 min) for the
 * player vs their direct lane opponent: CS diff, gold diff, xp diff,
 * solo kills/deaths and plates. Powered by `stats:get-lane-phase`, which
 * caches a small JSON report on the Game row so subsequent opens are
 * instant.
 *
 * Entry points: button on the RecordPlayerPage MetaBar.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft, RefreshCw, Loader2, Crown, Coins, Star, Swords, Shield,
  Crosshair, Flame, Building2,
} from 'lucide-react'
import {
  ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, ReferenceLine,
  CartesianGrid, Tooltip as RTooltip,
} from 'recharts'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useChampionIconUrl } from '@/hooks/useChampionIconUrl'
import type { LanePhaseReport, LanePhaseDiag, LanePhaseGrade } from '@/lib/ipc'
import { cn } from '@/lib/utils'

// ── Grade color mapping ─────────────────────────────────────────────────────
const GRADE_COLORS: Record<LanePhaseGrade, { text: string; bg: string; border: string }> = {
  'S':  { text: 'text-hextech-gold-bright', bg: 'bg-hextech-gold/15',  border: 'border-hextech-gold' },
  'A+': { text: 'text-hextech-teal',        bg: 'bg-hextech-teal/15',  border: 'border-hextech-teal' },
  'A':  { text: 'text-hextech-cyan',        bg: 'bg-hextech-cyan/15',  border: 'border-hextech-cyan' },
  'B+': { text: 'text-emerald-400',         bg: 'bg-emerald-500/15',   border: 'border-emerald-500/60' },
  'B':  { text: 'text-emerald-500',         bg: 'bg-emerald-500/10',   border: 'border-emerald-500/40' },
  'C':  { text: 'text-amber-400',           bg: 'bg-amber-500/15',     border: 'border-amber-500/60' },
  'D':  { text: 'text-orange-400',          bg: 'bg-orange-500/15',    border: 'border-orange-500/60' },
  'F':  { text: 'text-[#E24C3A]',           bg: 'bg-[#E24C3A]/15',     border: 'border-[#E24C3A]/60' },
}

const ROLE_LABELS: Record<string, string> = {
  TOP: 'Top', JUNGLE: 'Jungle', MIDDLE: 'Mid', BOTTOM: 'ADC', UTILITY: 'Support',
}

function fmtSigned(n: number, suffix = ''): string {
  return `${n > 0 ? '+' : ''}${n}${suffix}`
}

/** Compact number: 1234 → "1.2k", 850 → "850". Keeps the sign on negatives. */
function fmtK(n: number): string {
  return Math.abs(n) >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${Math.round(n)}`
}

function fmtSignedK(n: number): string {
  return `${n > 0 ? '+' : ''}${fmtK(n)}`
}

function pct(frac: number): string {
  return `${Math.round((frac || 0) * 100)}%`
}

function diagMessage(diag: LanePhaseDiag): string {
  switch (diag.reason) {
    case 'no-game':              return 'Game record not found — this lane phase report cannot be generated.'
    case 'no-match-id':          return 'No Riot match ID linked to this game. Try linking the recording first.'
    case 'no-user':              return 'No active user.'
    case 'timeline-fetch-failed':return 'Riot timeline fetch failed: ' + (diag.message ?? 'unknown error')
    case 'match-fetch-failed':   return 'Riot match fetch failed: ' + (diag.message ?? 'unknown error')
    case 'empty-timeline':       return diag.message ?? 'Cached match data is empty.'
    case 'no-player':            return 'Could not find the player in the match participants — the champion stored on this game may be wrong.'
    case 'no-opponent':          return 'Could not identify a direct lane opponent (Arena / customs / role swap).'
    case 'no-frames':            return 'Timeline has no frame data — too short to analyse.'
    case 'bad-data':             return 'Riot data could not be parsed: ' + (diag.message ?? 'unknown format')
    default:                     return diag.message ?? 'Unknown error.'
  }
}

export function LanePhasePage() {
  const { gameId } = useParams<{ gameId: string }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [report, setReport] = useState<LanePhaseReport | null>(null)
  const [diag, setDiag] = useState<LanePhaseDiag | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    if (!gameId) return
    setLoading(true)
    window.api.getLanePhase(gameId)
      .then((res) => { setReport(res.report); setDiag(res.diag) })
      .catch((err) => setDiag({ reason: 'bad-data', message: String(err) }))
      .finally(() => setLoading(false))
  }, [gameId])

  async function handleRefresh() {
    if (!gameId) return
    setRefreshing(true)
    try {
      const res = await window.api.refreshLanePhase(gameId)
      setReport(res.report)
      setDiag(res.diag)
    } finally {
      setRefreshing(false)
    }
  }

  // Jump to a moment in the replay player. We need the recordingId: prefer
  // the `?rec=` param the MetaBar passes, else look it up from the gameId.
  const jumpToReplay = useCallback(async (gameTimeSec: number) => {
    let recId = searchParams.get('rec')
    if (!recId && gameId) {
      try {
        const all = await window.api.listGamesWithRecordings()
        recId = (all as any[]).find((r: any) => r.gameId === gameId)?.recordingId ?? null
      } catch { /* ignore — fall through to no-op */ }
    }
    if (recId) navigate(`/record/${recId}?at=${Math.max(0, Math.round(gameTimeSec))}`)
  }, [searchParams, gameId, navigate])

  const playerIcon = useChampionIconUrl(report?.player.championName ?? null)
  const oppIcon = useChampionIconUrl(report?.opponent.championName ?? null)

  return (
    <div className="space-y-4 p-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="gap-1.5">
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <h1 className="text-xl font-semibold text-hextech-text-bright">Lane Phase Comparator</h1>
        <div className="flex-1" />
        {gameId && (
          <Button variant="outline" size="sm" disabled={refreshing} onClick={handleRefresh} className="gap-1.5">
            {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Refresh
          </Button>
        )}
      </div>

      {loading && (
        <Card>
          <CardContent className="flex items-center gap-3 py-12 justify-center text-hextech-text-dim">
            <Loader2 className="h-5 w-5 animate-spin" />
            Crunching the Riot timeline…
          </CardContent>
        </Card>
      )}

      {!loading && (!report || diag?.reason !== 'ok') && diag && (
        <Card className="border-[#E24C3A]/40">
          <CardContent className="py-6 text-sm text-[#E24C3A]">
            <p className="font-medium mb-1">No lane phase report available</p>
            <p className="text-xs text-[#E24C3A]/80">{diagMessage(diag)}</p>
            {diag.frameCount !== undefined && (
              <p className="text-xs text-hextech-text-dim mt-2">Timeline frames available: {diag.frameCount}</p>
            )}
          </CardContent>
        </Card>
      )}

      {!loading && report && (
        <>
          <LanePhaseHeader report={report} playerIcon={playerIcon} oppIcon={oppIcon} />
          <DiffChartsGrid report={report} onSeek={jumpToReplay} />
          <SoloAndPlatesStrip report={report} onSeek={jumpToReplay} />
        </>
      )}
    </div>
  )
}

// ── Header card with grade + matchup + KPI tiles ───────────────────────────

function LanePhaseHeader({ report, playerIcon, oppIcon }: { report: LanePhaseReport; playerIcon: string | null; oppIcon: string | null }) {
  const sc = report.scoreComponents
  const colors = GRADE_COLORS[report.grade]
  const role = ROLE_LABELS[report.player.teamPosition] ?? report.player.teamPosition ?? 'Lane'

  return (
    <Card>
      <CardContent className="py-4 px-5">
        <div className="flex items-center gap-4 flex-wrap">
          {/* Matchup */}
          <div className="flex items-center gap-3">
            {playerIcon && <img src={playerIcon} alt={report.player.championName} className="h-12 w-12 rounded-md border-2 border-hextech-teal/60" />}
            <div className="flex flex-col min-w-0">
              <p className="text-sm font-semibold text-hextech-text-bright">{report.player.championName}</p>
              <p className="text-[10px] text-hextech-text-dim uppercase tracking-wider">{role}</p>
            </div>
            <span className="text-hextech-text-dim text-sm mx-1">vs</span>
            {oppIcon && <img src={oppIcon} alt={report.opponent.championName} className="h-12 w-12 rounded-md border-2 border-[#E24C3A]/60" />}
            <div className="flex flex-col min-w-0">
              <p className="text-sm font-semibold text-hextech-text-bright">{report.opponent.championName}</p>
              <p className="text-[10px] text-hextech-text-dim uppercase tracking-wider">opponent</p>
            </div>
          </div>

          <div className="flex-1" />

          {/* Grade pill */}
          <div className={cn('flex flex-col items-center justify-center px-5 py-2 rounded-lg border-2', colors.border, colors.bg)}>
            <span className="text-[10px] uppercase tracking-wider text-hextech-text-dim leading-none mb-1">Lane Grade</span>
            <span className={cn('text-4xl font-black leading-none', colors.text)}>{report.grade}</span>
            <span className="text-[10px] text-hextech-text-dim mt-1">score {Math.round(sc.numericScore)}/100</span>
          </div>
        </div>

        {/* KPI tiles — first row: signed diffs, second row: player/opponent pairs */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4">
          <KpiTile icon={<Crown className="h-3.5 w-3.5" />}  label="CS @14"     value={fmtSigned(sc.csAt14)}     positive={sc.csAt14 > 0} negative={sc.csAt14 < 0} />
          <KpiTile icon={<Coins className="h-3.5 w-3.5" />}  label="Gold @14"   value={fmtSigned(sc.goldAt14)}   positive={sc.goldAt14 > 0} negative={sc.goldAt14 < 0} />
          <KpiTile icon={<Star className="h-3.5 w-3.5" />}   label="XP @14"     value={fmtSigned(sc.xpAt14)}     positive={sc.xpAt14 > 0} negative={sc.xpAt14 < 0} />
          <KpiTile icon={<Flame className="h-3.5 w-3.5" />}  label="DMG @14"    value={fmtSignedK(sc.dmgAt14?.diff ?? 0)} positive={(sc.dmgAt14?.diff ?? 0) > 0} negative={(sc.dmgAt14?.diff ?? 0) < 0}
            title={`Damage to champions @14 — you ${fmtK(sc.dmgAt14?.player ?? 0)} vs opponent ${fmtK(sc.dmgAt14?.opponent ?? 0)}`} />
          <KpiTile icon={<Swords className="h-3.5 w-3.5" />} label="Solo K/D"   value={`${sc.soloKD.k} / ${sc.soloKD.d}`} positive={sc.soloKD.k > sc.soloKD.d} negative={sc.soloKD.d > sc.soloKD.k} />
          <KpiTile icon={<Shield className="h-3.5 w-3.5" />} label="Plates"     value={`${sc.plates.taken} / ${sc.plates.lost}`} positive={sc.plates.taken > sc.plates.lost} negative={sc.plates.lost > sc.plates.taken} />
          <KpiTile icon={<Crosshair className="h-3.5 w-3.5" />} label="KP @14"  value={`${pct(sc.kp?.player ?? 0)} / ${pct(sc.kp?.opponent ?? 0)}`} positive={(sc.kp?.player ?? 0) > (sc.kp?.opponent ?? 0)} negative={(sc.kp?.player ?? 0) < (sc.kp?.opponent ?? 0)}
            title="Kill participation during the laning phase (0–14 min): your kills+assists / your team's kills, vs the opponent's" />
          <KpiTile icon={<Building2 className="h-3.5 w-3.5" />} label="Obj. dmg" value={`${fmtK(sc.objDmg?.player ?? 0)} / ${fmtK(sc.objDmg?.opponent ?? 0)}`} positive={(sc.objDmg?.player ?? 0) > (sc.objDmg?.opponent ?? 0)} negative={(sc.objDmg?.player ?? 0) < (sc.objDmg?.opponent ?? 0)}
            title="Damage dealt to objectives (turrets, dragons, baron…) over the full game — you vs the lane opponent" />
        </div>
      </CardContent>
    </Card>
  )
}

function KpiTile({ icon, label, value, positive, negative, title }: { icon: React.ReactNode; label: string; value: string; positive?: boolean; negative?: boolean; title?: string }) {
  return (
    <div title={title} className={cn(
      'flex flex-col gap-0.5 rounded-md border px-3 py-2',
      positive ? 'border-emerald-500/40 bg-emerald-500/5'
      : negative ? 'border-[#E24C3A]/40 bg-[#E24C3A]/5'
      : 'border-hextech-border-dim bg-hextech-elevated',
    )}>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-hextech-text-dim">
        {icon}
        {label}
      </div>
      <div className={cn(
        'text-base font-semibold tabular-nums',
        positive ? 'text-emerald-300' : negative ? 'text-[#FF8694]' : 'text-hextech-text-bright',
      )}>
        {value}
      </div>
    </div>
  )
}

// ── Three diff line charts (CS, Gold, XP) ──────────────────────────────────

function DiffChartsGrid({ report, onSeek }: { report: LanePhaseReport; onSeek: (gameTimeSec: number) => void }) {
  const chartData = useMemo(
    () => report.framesByMinute.map((f) => ({
      minute: f.minute,
      csDiff: f.cs.diff,
      goldDiff: f.gold.diff,
      xpDiff: f.xp.diff,
      dmgDiff: f.damageDealt?.diff ?? 0,
    })),
    [report.framesByMinute],
  )

  if (chartData.length === 0) {
    return (
      <Card>
        <CardContent className="py-6 text-center text-hextech-text-dim text-sm">
          No timeline frames in the laning phase window.
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-hextech-text-dim/80 px-1">
        Tip: click any point on a curve to jump to that minute in the replay.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <DiffChart data={chartData} dataKey="csDiff"   title="CS difference"   unit=""    onSeek={onSeek} />
        <DiffChart data={chartData} dataKey="goldDiff" title="Gold difference" unit="g"   onSeek={onSeek} />
        <DiffChart data={chartData} dataKey="xpDiff"   title="XP difference"   unit=" xp" onSeek={onSeek} />
        <DiffChart data={chartData} dataKey="dmgDiff"  title="Damage to champions" unit="" onSeek={onSeek} />
      </div>
    </div>
  )
}

function DiffChart({ data, dataKey, title, unit, onSeek }: { data: any[]; dataKey: string; title: string; unit: string; onSeek: (gameTimeSec: number) => void }) {
  // Recharts surfaces the hovered/clicked X value as `activeLabel` (= the
  // minute). Convert to game-time seconds and hand off to the deep-link.
  const handleChartClick = (state: any) => {
    const min = state?.activeLabel
    if (min != null && Number.isFinite(Number(min))) onSeek(Number(min) * 60)
  }
  return (
    <Card>
      <CardHeader className="py-3">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0 pb-3 px-2">
        <ResponsiveContainer width="100%" height={200}>
          <ComposedChart data={data} onClick={handleChartClick} style={{ cursor: 'pointer' }}>
            <defs>
              <linearGradient id={`g-${dataKey}-pos`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor="#10b981" stopOpacity={0.4} />
                <stop offset="100%" stopColor="#10b981" stopOpacity={0.0} />
              </linearGradient>
              <linearGradient id={`g-${dataKey}-neg`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor="#E24C3A" stopOpacity={0.0} />
                <stop offset="100%" stopColor="#E24C3A" stopOpacity={0.4} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#2A1D11" />
            <XAxis dataKey="minute" tick={{ fill: '#B5A68C', fontSize: 10 }} tickFormatter={(v) => `${v}m`} />
            <YAxis tick={{ fill: '#B5A68C', fontSize: 10 }} tickFormatter={(v) => `${v > 0 ? '+' : ''}${v}`} />
            <ReferenceLine y={0} stroke="#6b5c44" />
            <RTooltip
              contentStyle={{ background: '#0a0e13', border: '1px solid #2A1D11', borderRadius: 6, fontSize: 11 }}
              labelStyle={{ color: '#D4A24C' }}
              formatter={(v: any) => [`${v > 0 ? '+' : ''}${v}${unit}`, 'diff']}
              labelFormatter={(v) => `min ${v}`}
            />
            {/* Two overlapping areas — one shows positive gradient (above 0),
                the other negative. Both use `dataKey` but their stops are
                arranged so they only paint on their respective side. */}
            <Area type="monotone" dataKey={dataKey} stroke="none" fill={`url(#g-${dataKey}-pos)`} />
            <Area type="monotone" dataKey={dataKey} stroke="none" fill={`url(#g-${dataKey}-neg)`} />
            <Line type="monotone" dataKey={dataKey} stroke="#D4A24C" strokeWidth={2} dot={{ r: 2, fill: '#D4A24C' }} />
          </ComposedChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}

// ── Plates + Solo K/D timeline strip ───────────────────────────────────────

function SoloAndPlatesStrip({ report, onSeek }: { report: LanePhaseReport; onSeek: (gameTimeSec: number) => void }) {
  // Combine into a single list with type info, capped at the same 0-14 window.
  type Item = { kind: 'plate-taken' | 'plate-lost' | 'solo-kill' | 'solo-death'; minute: number }
  const items: Item[] = [
    ...report.plates.map((p): Item => ({ kind: p.takenByPlayer ? 'plate-taken' : 'plate-lost', minute: p.minute })),
    ...report.soloEvents.map((s): Item => ({ kind: s.type === 'kill' ? 'solo-kill' : 'solo-death', minute: s.minute })),
  ].sort((a, b) => a.minute - b.minute)

  return (
    <Card>
      <CardHeader className="py-3">
        <CardTitle className="text-sm">Plates &amp; solo trades</CardTitle>
      </CardHeader>
      <CardContent className="pt-0 pb-4">
        {items.length === 0 ? (
          <p className="text-xs text-hextech-text-dim py-2">
            No plates taken/lost or solo trades between you and your opponent during the laning phase.
          </p>
        ) : (
          <>
            <div className="relative h-14 mt-2 mb-1 mx-2">
              {/* Axis */}
              <div className="absolute inset-x-0 top-1/2 h-px bg-hextech-border-dim" />
              {/* Minute ticks */}
              {Array.from({ length: 8 }, (_, i) => i * 2).map((m) => (
                <div key={m} className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 text-[9px] text-hextech-text-dim/70" style={{ left: `${(m / 14) * 100}%` }}>
                  <div className="h-1.5 w-px bg-hextech-text-dim/40 mb-0.5 mx-auto" />
                  {m}m
                </div>
              ))}
              {/* Markers */}
              {items.map((it, i) => {
                const left = `${Math.min(Math.max((it.minute / 14) * 100, 0), 100)}%`
                const props = MARKER_PROPS[it.kind]
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => onSeek(it.minute * 60)}
                    className={cn('absolute top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center h-5 w-5 rounded-full border cursor-pointer hover:scale-125 transition-transform', props.cls)}
                    style={{ left }}
                    title={`${props.title} @ ${it.minute}m — click to jump to the replay`}
                  >
                    <span className="text-[9px] font-bold">{props.label}</span>
                  </button>
                )
              })}
            </div>
            <div className="flex items-center gap-3 flex-wrap text-[10px] text-hextech-text-dim mt-2 px-2">
              <Legend swatch="bg-emerald-500/40 border-emerald-500" label="Solo kill" />
              <Legend swatch="bg-[#E24C3A]/40 border-[#E24C3A]" label="Solo death" />
              <Legend swatch="bg-hextech-teal/40 border-hextech-teal" label="Plate taken" />
              <Legend swatch="bg-orange-500/40 border-orange-500" label="Plate lost" />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

const MARKER_PROPS: Record<string, { cls: string; label: string; title: string }> = {
  'solo-kill':  { cls: 'bg-emerald-500/40 border-emerald-400 text-emerald-100',  label: 'K', title: 'Solo kill' },
  'solo-death': { cls: 'bg-[#E24C3A]/40 border-[#E24C3A] text-red-100',          label: 'D', title: 'Solo death' },
  'plate-taken':{ cls: 'bg-hextech-teal/40 border-hextech-teal text-cyan-100',   label: 'P', title: 'Plate taken' },
  'plate-lost': { cls: 'bg-orange-500/40 border-orange-400 text-orange-100',     label: 'P', title: 'Plate lost' },
}

function Legend({ swatch, label }: { swatch: string; label: string }) {
  return (
    <div className="flex items-center gap-1">
      <span className={cn('inline-block h-3 w-3 rounded-full border', swatch)} />
      {label}
    </div>
  )
}

// Re-export as default for lazy imports if needed later.
export default LanePhasePage
