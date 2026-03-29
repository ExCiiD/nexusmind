import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import {
  Loader2,
  TrendingUp,
  TrendingDown,
  Crown,
  Coins,
  Swords,
  Target,
  Eye,
  Zap,
  RefreshCw,
  ArrowLeft,
  Filter,
  ChevronDown,
} from 'lucide-react'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
  Legend,
} from 'recharts'

type ActiveTab = 'averages' | 'progression'

export function StatsAveragesPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [averages, setAverages] = useState<any>(null)
  const [snapshots, setSnapshots] = useState<any[]>([])
  const [computing, setComputing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<ActiveTab>('averages')
  const [avgChartSeries, setAvgChartSeries] = useState<string[]>(DEFAULT_SERIES)

  useEffect(() => {
    window.api.getStatsSnapshots().then((data) => {
      setSnapshots(data)
      if (data.length > 0) {
        setAverages(data[data.length - 1].stats)
      }
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const handleCompute = async () => {
    setComputing(true)
    try {
      const result = await window.api.computeStatsAverages()
      if (result) {
        setAverages(result.averages)
        const updated = await window.api.getStatsSnapshots()
        setSnapshots(updated)
      }
    } catch (err) {
      console.error(err)
    } finally {
      setComputing(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 gap-3 text-hextech-text-dim">
        <Loader2 className="h-5 w-5 animate-spin" />
        {t('detailedStats.loading')}
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate('/stats')} className="gap-1 text-hextech-text-dim">
            <ArrowLeft className="h-4 w-4" />
            {t('detailedStats.back')}
          </Button>
          <div>
            <h1 className="font-display text-2xl font-bold text-hextech-gold-bright">
              {t('statsAvg.title')}
            </h1>
            <p className="text-sm text-hextech-text mt-1">{t('statsAvg.subtitle')}</p>
          </div>
        </div>
        <Button onClick={handleCompute} disabled={computing} variant="outline" className="gap-2">
          {computing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {t('statsAvg.compute')}
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-hextech-border-dim">
        {(['averages', 'progression'] as ActiveTab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === tab
                ? 'border-hextech-gold text-hextech-gold-bright'
                : 'border-transparent text-hextech-text-dim hover:text-hextech-text'
            }`}
          >
            {t(`statsAvg.tabs.${tab}`)}
          </button>
        ))}
      </div>

      {/* Averages Tab */}
      {activeTab === 'averages' && (
        <>
          {!averages && (
            <Card>
              <CardContent className="py-16 text-center text-hextech-text-dim">
                {t('statsAvg.empty')}
              </CardContent>
            </Card>
          )}

          {averages && (
            <>
              {/* Summary banner */}
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
                <MiniStat label={t('statsAvg.winRate')} value={`${averages.meta.winRate}%`} />
                <MiniStat label="KDA" value={`${averages.meta.avgKills}/${averages.meta.avgDeaths}/${averages.meta.avgAssists}`} />
                <MiniStat label={t('statsAvg.csMin')} value={averages.economy.csPerMin} />
                <MiniStat label={t('statsAvg.gpm')} value={averages.economy.goldPerMin} />
                <MiniStat label={t('statsAvg.dpm')} value={averages.combat.damagePerMin} />
                <MiniStat label={t('statsAvg.kp')} value={`${averages.combat.killParticipation}%`} />
                <MiniStat label={t('statsAvg.vsMin')} value={averages.vision.visionScorePerMin} />
              </div>

              {/* Category breakdowns */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <AvgCard icon={Crown} color="text-hextech-gold" title={t('detailedStats.laning.title')} rows={[
                  { label: t('detailedStats.laning.gold15'), value: averages.laning.gold15 },
                  { label: t('detailedStats.laning.xp15'), value: averages.laning.xp15 },
                  { label: t('detailedStats.laning.xpPerMin15'), value: averages.laning.xpPerMin15 },
                  { label: t('detailedStats.laning.cs15'), value: averages.laning.cs15 },
                  { label: t('detailedStats.laning.dmg15'), value: averages.laning.damage15 },
                  { label: t('detailedStats.laning.dpm15'), value: averages.laning.damagePerMin15 },
                  { label: `${t('detailedStats.laning.gold15')} diff`, value: averages.laning.goldDiff15, diff: true },
                  { label: `${t('detailedStats.laning.xp15')} diff`, value: averages.laning.xpDiff15, diff: true },
                  { label: `${t('detailedStats.laning.cs15')} diff`, value: averages.laning.csDiff15, diff: true },
                  { label: `${t('detailedStats.laning.dmg15')} diff`, value: averages.laning.damageDiff15, diff: true },
                  { label: t('detailedStats.laning.turretPlates15'), value: averages.laning.turretPlates15 },
                  { label: t('detailedStats.laning.firstBlood'), value: `${averages.laning.firstBloodRate}%` },
                ]} />
                <AvgCard icon={Coins} color="text-hextech-gold" title={t('detailedStats.economy.title')} rows={[
                  { label: t('detailedStats.economy.xp'), value: averages.economy.xp },
                  { label: t('detailedStats.economy.xpPerMin'), value: averages.economy.xpPerMin },
                  { label: t('detailedStats.economy.gpm'), value: averages.economy.goldPerMin },
                  { label: t('detailedStats.economy.cspm'), value: averages.economy.csPerMin },
                  { label: t('detailedStats.economy.teamGold'), value: `${averages.economy.teamGoldPercent}%` },
                  { label: t('detailedStats.economy.maxCsAdv'), value: averages.economy.maxCsAdvantage },
                ]} />
                <AvgCard icon={Swords} color="text-[#FF4655]" title={t('detailedStats.combat.title')} rows={[
                  { label: t('detailedStats.combat.totalDamage'), value: averages.meta.avgDuration ? Math.round(averages.combat.damagePerMin * (averages.meta.avgDuration / 60)) : null },
                  { label: t('detailedStats.combat.kp'), value: `${averages.combat.killParticipation}%` },
                  { label: t('detailedStats.combat.dpm'), value: averages.combat.damagePerMin },
                  { label: t('detailedStats.combat.teamDmg'), value: `${averages.combat.teamDamagePercent}%` },
                  { label: t('detailedStats.combat.soloKills'), value: averages.combat.soloKills },
                  { label: t('detailedStats.combat.dmgTaken'), value: averages.combat.damageTaken },
                ]} />
                <AvgCard icon={Target} color="text-hextech-cyan" title={t('detailedStats.objectives.title')} rows={[
                  { label: t('detailedStats.objectives.dmgEpic'), value: averages.objectives.damageToEpicMonsters },
                  { label: t('detailedStats.objectives.epicDmgPercent'), value: averages.objectives.teamEpicMonsterDmgPercent != null ? `${averages.objectives.teamEpicMonsterDmgPercent}%` : null },
                  { label: t('detailedStats.objectives.dmgBuild'), value: averages.objectives.damageToBuildings },
                  { label: t('detailedStats.objectives.turretPlates'), value: averages.objectives.turretPlates },
                  { label: t('detailedStats.objectives.inhibitors'), value: averages.objectives.inhibitorTakedowns },
                  { label: t('detailedStats.objectives.stolen'), value: averages.objectives.objectivesStolen },
                  { label: t('detailedStats.objectives.firstTower'), value: `${averages.objectives.firstTowerRate}%` },
                ]} />
                <AvgCard icon={Eye} color="text-hextech-teal" title={t('detailedStats.vision.title')} rows={[
                  { label: t('detailedStats.vision.vsPerMin'), value: averages.vision.visionScorePerMin },
                  { label: t('detailedStats.vision.controlWards'), value: averages.vision.controlWardsPurchased },
                  { label: t('detailedStats.vision.wardsPlaced'), value: averages.vision.wardsPlaced },
                  { label: t('detailedStats.vision.wardsDestroyed'), value: averages.vision.wardsDestroyed },
                ]} />
                <AvgCard icon={Zap} color="text-hextech-gold-bright" title={t('detailedStats.behavioral.title')} rows={[
                  { label: t('detailedStats.behavioral.skillshots'), value: averages.behavioral.skillshotsDodged },
                  { label: t('detailedStats.behavioral.killsNearTurret'), value: averages.behavioral.killsNearEnemyTurret },
                  { label: t('detailedStats.behavioral.outnumbered'), value: averages.behavioral.outnumberedKills },
                  { label: t('detailedStats.behavioral.enemyJungle'), value: averages.behavioral.takedownsInEnemyJungle },
                ]} />
              </div>

              {/* Progression graph */}
              {snapshots.length >= 2 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <TrendingUp className="h-4 w-4 text-hextech-cyan" />
                      {t('statsAvg.progression')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <SeriesFilterBar selected={avgChartSeries} onChange={setAvgChartSeries} />
                    <ProgressionLineChart snapshots={snapshots} selectedSeries={avgChartSeries} />
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </>
      )}

      {/* Progression Tab */}
      {activeTab === 'progression' && (
        <ProgressionTab snapshots={snapshots} />
      )}
    </div>
  )
}

/* ─── Sub-components ─── */

function MiniStat({ label, value }: { label: string; value: any }) {
  return (
    <div className="rounded-lg bg-hextech-elevated border border-hextech-border-dim p-3 text-center">
      <div className="text-lg font-bold text-hextech-gold-bright">{value ?? '—'}</div>
      <div className="text-[10px] text-hextech-text-dim">{label}</div>
    </div>
  )
}

function AvgCard({ icon: Icon, color, title, rows }: {
  icon: any; color: string; title: string;
  rows: Array<{ label: string; value: any; diff?: boolean }>
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className={`flex items-center gap-2 text-base ${color}`}>
          <Icon className="h-4 w-4" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-0 divide-y divide-hextech-border-dim/50">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between py-1.5">
            <span className="text-xs text-hextech-text">{row.label}</span>
            <span className={`text-sm font-semibold ${
              row.diff && row.value !== null
                ? (row.value > 0 ? 'text-hextech-green' : row.value < 0 ? 'text-[#FF4655]' : 'text-hextech-text-bright')
                : 'text-hextech-text-bright'
            }`}>
              {row.value !== null && row.value !== undefined
                ? (row.diff && row.value > 0 ? `+${typeof row.value === 'number' ? row.value.toLocaleString() : row.value}` : typeof row.value === 'number' ? row.value.toLocaleString() : row.value)
                : '—'}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

/* ─── Line chart series config ─── */

interface LineSeries {
  key: string
  label: string
  category: string
  color: string
  get: (snap: any) => number | null
}

const LINE_SERIES: LineSeries[] = [
  { key: 'winRate',    label: 'Win Rate %',    category: 'general',    color: '#27AE60', get: (s) => s.stats.meta.winRate },
  { key: 'xpPerMin',   label: 'XP/min',        category: 'economy',    color: '#F08C2B', get: (s) => s.stats.economy.xpPerMin },
  { key: 'csPerMin',   label: 'CS/min',        category: 'economy',    color: '#C8AA6E', get: (s) => s.stats.economy.csPerMin },
  { key: 'goldPerMin', label: 'Gold/min',      category: 'economy',    color: '#F4C874', get: (s) => s.stats.economy.goldPerMin },
  { key: 'kp',         label: 'Kill Part. %',  category: 'combat',     color: '#0AC8B9', get: (s) => s.stats.combat.killParticipation },
  { key: 'dpm',        label: 'DMG/min',       category: 'combat',     color: '#9D48E0', get: (s) => s.stats.combat.damagePerMin },
  { key: 'teamDmg',    label: '% Team DMG',    category: 'combat',     color: '#FF4655', get: (s) => s.stats.combat.teamDamagePercent },
  { key: 'damage15',   label: 'DMG @15',       category: 'laning',     color: '#D65DB1', get: (s) => s.stats.laning.damage15 },
  { key: 'dpm15',      label: 'DMG/min @15',   category: 'laning',     color: '#FF6F91', get: (s) => s.stats.laning.damagePerMin15 },
  { key: 'xpPerMin15', label: 'XP/min @15',    category: 'laning',     color: '#F08C2B', get: (s) => s.stats.laning.xpPerMin15 },
  { key: 'goldDiff15', label: 'Gold Diff @15', category: 'laning',     color: '#576CCE', get: (s) => s.stats.laning.goldDiff15 },
  { key: 'xpDiff15',   label: 'XP Diff @15',   category: 'laning',     color: '#7D5FFF', get: (s) => s.stats.laning.xpDiff15 },
  { key: 'csDiff15',   label: 'CS Diff @15',   category: 'laning',     color: '#E0C874', get: (s) => s.stats.laning.csDiff15 },
  { key: 'plates15',   label: 'Plates @15',    category: 'laning',     color: '#C86DD7', get: (s) => s.stats.laning.turretPlates15 },
  { key: 'vsPerMin',   label: 'VS/min',         category: 'vision',    color: '#005A82', get: (s) => s.stats.vision.visionScorePerMin },
  { key: 'epicMonsterDmg', label: 'Epic Monster DMG', category: 'objectives', color: '#0ACE83', get: (s) => s.stats.objectives.damageToEpicMonsters },
  { key: 'epicMonsterDmgPct', label: 'Epic Monster DMG %', category: 'objectives', color: '#23D5AB', get: (s) => s.stats.objectives.teamEpicMonsterDmgPercent },
]

const LINE_CATEGORIES = ['general', 'economy', 'combat', 'laning', 'vision', 'objectives'] as const

const DEFAULT_SERIES = ['csPerMin', 'kp', 'winRate', 'vsPerMin']

function SeriesFilterBar({
  selected,
  onChange,
}: {
  selected: string[]
  onChange: (next: string[]) => void
}) {
  const { t } = useTranslation()

  const allKeys = LINE_SERIES.map((s) => s.key)
  const isAll = selected.length === allKeys.length

  const toggleAll = () => onChange(isAll ? DEFAULT_SERIES : [...allKeys])

  const toggleCategory = (cat: string) => {
    const catKeys = LINE_SERIES.filter((s) => s.category === cat).map((s) => s.key)
    const allActive = catKeys.every((k) => selected.includes(k))
    if (allActive) {
      onChange(selected.filter((k) => !catKeys.includes(k)))
    } else {
      onChange([...new Set([...selected, ...catKeys])])
    }
  }

  const toggleSeries = (key: string) => {
    if (selected.includes(key)) {
      onChange(selected.filter((k) => k !== key))
    } else {
      onChange([...selected, key])
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <Filter className="h-3.5 w-3.5 text-hextech-text-dim shrink-0" />
        <button
          onClick={toggleAll}
          className={cn(
            'rounded-full border px-3 py-0.5 text-[10px] font-medium transition-colors',
            isAll
              ? 'border-hextech-gold bg-hextech-gold/10 text-hextech-gold-bright'
              : 'border-hextech-border-dim text-hextech-text-dim hover:border-hextech-border',
          )}
        >
          {t('analytics.objectiveFilter.all')}
        </button>
        {LINE_CATEGORIES.map((cat) => {
          const catKeys = LINE_SERIES.filter((s) => s.category === cat).map((s) => s.key)
          const allActive = catKeys.every((k) => selected.includes(k))
          return (
            <button
              key={cat}
              onClick={() => toggleCategory(cat)}
              className={cn(
                'rounded-full border px-3 py-0.5 text-[10px] font-medium transition-colors capitalize',
                allActive
                  ? 'border-hextech-gold bg-hextech-gold/10 text-hextech-gold-bright'
                  : 'border-hextech-border-dim text-hextech-text-dim hover:border-hextech-border',
              )}
            >
              {cat}
            </button>
          )
        })}
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        {LINE_SERIES.map((s) => (
          <button
            key={s.key}
            onClick={() => toggleSeries(s.key)}
            className={cn(
              'rounded-full border px-2.5 py-0.5 text-[10px] font-medium transition-colors',
              selected.includes(s.key)
                ? 'border-hextech-gold/60 text-hextech-text-bright'
                : 'border-hextech-border-dim text-hextech-text-dim hover:border-hextech-border',
            )}
            style={selected.includes(s.key) ? { borderColor: s.color, backgroundColor: `${s.color}15` } : undefined}
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function ProgressionLineChart({
  snapshots,
  selectedSeries,
}: {
  snapshots: any[]
  selectedSeries: string[]
}) {
  const activeSeries = LINE_SERIES.filter((s) => selectedSeries.includes(s.key))

  const data = snapshots.map((snap, i) => {
    const date = new Date(snap.lastGameAt)
    const row: Record<string, any> = {
      name: `#${i + 1}`,
      date: date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
    }
    for (const s of LINE_SERIES) {
      row[s.key] = s.get(snap)
    }
    return row
  })

  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1E2328" />
        <XAxis dataKey="date" tick={{ fill: '#A09B8C', fontSize: 11 }} />
        <YAxis tick={{ fill: '#A09B8C', fontSize: 11 }} />
        <RTooltip
          contentStyle={{ backgroundColor: '#1E2328', border: '1px solid #3C3C41', borderRadius: 8 }}
          labelStyle={{ color: '#F0E6D2' }}
        />
        <Legend />
        {activeSeries.map((s) => (
          <Line key={s.key} type="monotone" dataKey={s.key} stroke={s.color} name={s.label} strokeWidth={2} dot={{ r: 3 }} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}

/* ─── Progression Tab: snapshot-by-snapshot comparison ─── */

interface StatRow {
  label: string
  path: (s: any) => number | null
  higherIsBetter?: boolean
  format?: (v: number) => string
}

const STAT_ROWS: StatRow[] = [
  { label: 'Win Rate %', path: (s) => s.meta.winRate, higherIsBetter: true, format: (v) => `${v}%` },
  { label: 'KDA (kills)', path: (s) => s.meta.avgKills, higherIsBetter: true },
  { label: 'KDA (deaths)', path: (s) => s.meta.avgDeaths, higherIsBetter: false },
  { label: 'KDA (assists)', path: (s) => s.meta.avgAssists, higherIsBetter: true },
  { label: 'XP/min', path: (s) => s.economy.xpPerMin, higherIsBetter: true },
  { label: 'CS/min', path: (s) => s.economy.csPerMin, higherIsBetter: true },
  { label: 'Gold/min', path: (s) => s.economy.goldPerMin, higherIsBetter: true },
  { label: 'DMG @15', path: (s) => s.laning.damage15, higherIsBetter: true },
  { label: 'DMG/min @15', path: (s) => s.laning.damagePerMin15, higherIsBetter: true },
  { label: 'XP/min @15', path: (s) => s.laning.xpPerMin15, higherIsBetter: true },
  { label: 'Gold Diff @15', path: (s) => s.laning.goldDiff15, higherIsBetter: true },
  { label: 'XP Diff @15', path: (s) => s.laning.xpDiff15, higherIsBetter: true },
  { label: 'CS Diff @15', path: (s) => s.laning.csDiff15, higherIsBetter: true },
  { label: 'DMG Diff @15', path: (s) => s.laning.damageDiff15, higherIsBetter: true },
  { label: 'Turret Plates @15', path: (s) => s.laning.turretPlates15, higherIsBetter: true },
  { label: 'Turret Plates Total', path: (s) => s.objectives.turretPlates, higherIsBetter: true },
  { label: 'Kill Part. %', path: (s) => s.combat.killParticipation, higherIsBetter: true, format: (v) => `${v}%` },
  { label: 'DMG/min', path: (s) => s.combat.damagePerMin, higherIsBetter: true },
  { label: 'Epic Monster DMG', path: (s) => s.objectives.damageToEpicMonsters, higherIsBetter: true },
  { label: 'Epic Monster DMG %', path: (s) => s.objectives.teamEpicMonsterDmgPercent, higherIsBetter: true, format: (v) => `${v}%` },
  { label: 'Building DMG', path: (s) => s.objectives.damageToBuildings, higherIsBetter: true },
  { label: 'Inhibitors', path: (s) => s.objectives.inhibitorTakedowns, higherIsBetter: true },
  { label: '% Team DMG', path: (s) => s.combat.teamDamagePercent, higherIsBetter: true, format: (v) => `${v}%` },
  { label: 'Solo Kills', path: (s) => s.combat.soloKills, higherIsBetter: true },
  { label: 'Vision Score/min', path: (s) => s.vision.visionScorePerMin, higherIsBetter: true },
  { label: 'Control Wards', path: (s) => s.vision.controlWardsPurchased, higherIsBetter: true },
  { label: 'Wards Placed', path: (s) => s.vision.wardsPlaced, higherIsBetter: true },
  { label: 'Wards Destroyed', path: (s) => s.vision.wardsDestroyed, higherIsBetter: true },
  { label: 'Skillshots Dodged', path: (s) => s.behavioral.skillshotsDodged, higherIsBetter: true },
]

const SNAPSHOTS_PAGE = 10

function ProgressionTab({ snapshots }: { snapshots: any[] }) {
  const { t } = useTranslation()
  const [visibleCount, setVisibleCount] = useState(SNAPSHOTS_PAGE)
  const [baseIdx, setBaseIdx] = useState(snapshots.length >= 2 ? snapshots.length - 2 : 0)
  const [targetIdx, setTargetIdx] = useState(snapshots.length - 1)
  const [chartSeries, setChartSeries] = useState<string[]>(DEFAULT_SERIES)

  if (snapshots.length < 2) {
    return (
      <Card>
        <CardContent className="py-16 text-center text-hextech-text-dim">
          {t('statsAvg.noProgressionData')}
        </CardContent>
      </Card>
    )
  }

  const visibleStart = Math.max(0, snapshots.length - visibleCount)
  const visibleSnapshots = snapshots.slice(visibleStart)
  const hasMore = visibleStart > 0

  const base = snapshots[baseIdx]
  const target = snapshots[targetIdx]

  const snapBtn = (idx: number, role: 'base' | 'target') => {
    const s = snapshots[idx]
    const isActive = role === 'base' ? idx === baseIdx : idx === targetIdx
    return (
      <button
        key={s.id}
        onClick={() => role === 'base' ? setBaseIdx(idx) : setTargetIdx(idx)}
        className={cn(
          'px-2.5 py-0.5 rounded-full text-[10px] border transition-colors',
          isActive
            ? role === 'base'
              ? 'border-hextech-cyan bg-hextech-cyan/10 text-hextech-cyan'
              : 'border-hextech-gold bg-hextech-gold/10 text-hextech-gold-bright'
            : 'border-hextech-border-dim text-hextech-text-dim hover:border-hextech-border hover:text-hextech-text',
        )}
      >
        #{idx + 1}
        <span className="ml-1 opacity-60">
          {new Date(s.lastGameAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
        </span>
      </button>
    )
  }

  return (
    <div className="space-y-4">
      {/* Baseline selector */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-hextech-cyan font-medium shrink-0 w-24">{t('statsAvg.progTable.compareFrom')}:</span>
          {visibleSnapshots.map((_, i) => snapBtn(visibleStart + i, 'base'))}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-hextech-gold font-medium shrink-0 w-24">{t('statsAvg.progTable.compareTo')}:</span>
          {visibleSnapshots.map((_, i) => snapBtn(visibleStart + i, 'target'))}
        </div>
        {hasMore && (
          <Button
            variant="ghost"
            size="sm"
            className="text-xs gap-1 text-hextech-text-dim"
            onClick={() => setVisibleCount((c) => c + SNAPSHOTS_PAGE)}
          >
            <ChevronDown className="h-3 w-3" />
            {t('statsAvg.progTable.loadMore')}
          </Button>
        )}
      </div>

      {/* Comparison header */}
      <div className="grid grid-cols-4 gap-2 text-xs font-medium text-hextech-text-dim px-3 py-2 bg-hextech-elevated rounded-lg">
        <span>{t('statsAvg.progTable.stat')}</span>
        <span className="text-right text-hextech-cyan">{t('statsAvg.progTable.snapshot', { n: baseIdx + 1 })}</span>
        <span className="text-right text-hextech-gold">{t('statsAvg.progTable.snapshot', { n: targetIdx + 1 })}</span>
        <span className="text-right">{t('statsAvg.progTable.diff')}</span>
      </div>

      {/* Stat rows */}
      <Card>
        <CardContent className="p-0 divide-y divide-hextech-border-dim/50">
          {STAT_ROWS.map((row) => {
            const baseVal = row.path(base.stats)
            const targetVal = row.path(target.stats)
            const diff = baseVal != null && targetVal != null ? targetVal - baseVal : null
            const fmt = row.format ?? ((v: number) => typeof v === 'number' ? v.toLocaleString() : String(v))
            const isPositive = diff !== null && (row.higherIsBetter ? diff > 0 : diff < 0)
            const isNegative = diff !== null && (row.higherIsBetter ? diff < 0 : diff > 0)

            return (
              <div key={row.label} className="grid grid-cols-4 gap-2 px-4 py-2 text-sm items-center hover:bg-hextech-elevated/50 transition-colors">
                <span className="text-xs text-hextech-text">{row.label}</span>
                <span className="text-right text-xs text-hextech-text-dim">
                  {baseVal != null ? fmt(baseVal) : '—'}
                </span>
                <span className="text-right text-xs font-medium text-hextech-text-bright">
                  {targetVal != null ? fmt(targetVal) : '—'}
                </span>
                <span className={cn(
                  'text-right text-xs font-semibold flex items-center justify-end gap-1',
                  isPositive ? 'text-hextech-green' : isNegative ? 'text-[#FF4655]' : 'text-hextech-text-dim',
                )}>
                  {diff !== null ? (
                    <>
                      {isPositive ? <TrendingUp className="h-3 w-3" /> : isNegative ? <TrendingDown className="h-3 w-3" /> : null}
                      {diff > 0 ? '+' : ''}{diff.toFixed(1)}
                    </>
                  ) : '—'}
                </span>
              </div>
            )
          })}
        </CardContent>
      </Card>

      {/* Line chart overview */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="h-4 w-4 text-hextech-cyan" />
            {t('statsAvg.progression')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <SeriesFilterBar selected={chartSeries} onChange={setChartSeries} />
          <ProgressionLineChart snapshots={snapshots} selectedSeries={chartSeries} />
        </CardContent>
      </Card>
    </div>
  )
}
