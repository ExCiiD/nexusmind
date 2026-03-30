import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useTranslation } from 'react-i18next'
import { cn, formatKDA, formatGameTime } from '@/lib/utils'
import type { DetailedGameStats } from '@/lib/ipc'
import {
  ArrowLeft,
  Loader2,
  Swords,
  Coins,
  Eye,
  Target,
  Zap,
  TrendingUp,
  TrendingDown,
  Minus,
  Crown,
  HelpCircle,
  User,
  GitCompare,
} from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip'

function formatStatNumber(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return digits > 0 ? value.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits }) : Math.round(value).toLocaleString()
}

export function DetailedStatsPage() {
  const { t } = useTranslation()
  const { matchId } = useParams<{ matchId: string }>()
  const navigate = useNavigate()
  const [stats, setStats] = useState<DetailedGameStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [compareOpponent, setCompareOpponent] = useState(false)

  useEffect(() => {
    if (!matchId) return
    setLoading(true)
    setError(null)
    window.api
      .getDetailedStats(matchId)
      .then((data) => {
        setStats(data)
        setLoading(false)
      })
      .catch((err) => {
        setError(err.message ?? 'Failed to fetch stats')
        setLoading(false)
      })
  }, [matchId])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 gap-3 text-hextech-text-dim animate-fade-in">
        <Loader2 className="h-5 w-5 animate-spin" />
        {t('detailedStats.loading')}
      </div>
    )
  }

  if (error || !stats) {
    return (
      <div className="space-y-6 animate-fade-in">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          {t('detailedStats.back')}
        </Button>
        <Card>
          <CardContent className="py-16 text-center text-[#FF4655]">
            {error ?? t('detailedStats.noData')}
          </CardContent>
        </Card>
      </div>
    )
  }

  const m = stats.meta
  const hasOpponent = stats.opponent !== null

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          {t('detailedStats.back')}
        </Button>
        {hasOpponent && (
          <Button
            variant={compareOpponent ? 'default' : 'outline'}
            size="sm"
            className={cn(
              'ml-auto gap-2 transition-colors',
              compareOpponent
                ? 'bg-hextech-gold/20 border-hextech-gold/50 text-hextech-gold hover:bg-hextech-gold/30'
                : 'border-hextech-border-dim text-hextech-text-dim hover:border-hextech-gold/40 hover:text-hextech-gold',
            )}
            onClick={() => setCompareOpponent((v) => !v)}
          >
            <GitCompare className="h-4 w-4" />
            Compare to opponent
            {compareOpponent && m.opponentChampion && (
              <span className="font-normal opacity-80">({m.opponentChampion})</span>
            )}
          </Button>
        )}
      </div>

      {/* Game header */}
      <div className={cn(
        'rounded-lg border p-4',
        m.win ? 'border-hextech-green/30 bg-hextech-green/5' : 'border-[#FF4655]/30 bg-[#FF4655]/5',
      )}>
        <div className="flex items-center gap-4 flex-wrap">
          <Badge variant={m.win ? 'success' : 'destructive'} className="text-sm px-3 py-1">
            {m.win ? t('detailedStats.victory') : t('detailedStats.defeat')}
          </Badge>
          <span className="text-lg font-bold text-hextech-text-bright">{m.champion}</span>
          {m.opponentChampion && (
            <span className="text-sm text-hextech-text-dim">{t('history.matchup', { champion: m.opponentChampion })}</span>
          )}
          <span className="text-sm text-hextech-text-dim">{m.role}</span>
          {m.accountName && (
            <Badge variant="outline" className="border-hextech-border-dim text-hextech-text-dim text-[10px] gap-1">
              <User className="h-2.5 w-2.5" />
              {m.accountName}
            </Badge>
          )}
          <div className="ml-auto flex items-center gap-4 text-sm text-hextech-text">
            <span className="flex items-center gap-1">
              <Swords className="h-4 w-4" />
              {formatKDA(m.kills, m.deaths, m.assists)}
            </span>
            <span>{m.cs} CS</span>
            <span>{formatGameTime(m.duration)}</span>
            <span className="text-hextech-text-dim">
              {new Date(m.gameEndAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
          </div>
        </div>
      </div>

      {/* Color legend for diffs */}
      <DiffLegendBanner compareActive={compareOpponent} opponentChampion={m.opponentChampion} />

      {/* Stat categories in a 2-column grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <LaningCard stats={stats} compareOpponent={compareOpponent} />
        <EconomyCard stats={stats} compareOpponent={compareOpponent} />
        <CombatCard stats={stats} compareOpponent={compareOpponent} />
        <ObjectivesCard stats={stats} compareOpponent={compareOpponent} />
        <VisionCard stats={stats} compareOpponent={compareOpponent} />
        <BehavioralCard stats={stats} compareOpponent={compareOpponent} />
      </div>
    </div>
  )
}

function DiffLegendBanner({ compareActive, opponentChampion }: { compareActive: boolean; opponentChampion: string | null }) {
  const { t } = useTranslation()
  return (
    <TooltipProvider>
      <div className="flex items-center gap-4 flex-wrap">
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-2 text-xs text-hextech-text-dim cursor-help w-fit">
              <HelpCircle className="h-3.5 w-3.5" />
              <span className="flex items-center gap-2">
                <span className="text-hextech-green font-semibold">+</span>
                <span>/</span>
                <span className="text-[#FF4655] font-semibold">−</span>
                {t('detailedStats.diffLegend.title')}
              </span>
            </div>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-xs space-y-1.5 p-3">
            <p className="font-semibold text-xs text-hextech-text-bright">{t('detailedStats.diffLegend.title')}</p>
            <p className="text-xs text-hextech-green">{t('detailedStats.diffLegend.positive')}</p>
            <p className="text-xs text-[#FF4655]">{t('detailedStats.diffLegend.negative')}</p>
            <p className="text-xs text-hextech-text-dim">{t('detailedStats.diffLegend.note')}</p>
          </TooltipContent>
        </Tooltip>
        {compareActive && opponentChampion && (
          <div className="flex items-center gap-1.5 text-xs text-hextech-gold">
            <GitCompare className="h-3.5 w-3.5" />
            <span>You</span>
            <span className="text-hextech-text-dim">vs</span>
            <span>{opponentChampion}</span>
          </div>
        )}
      </div>
    </TooltipProvider>
  )
}

/* ─── Helper components ─── */

function DiffIndicator({ value }: { value: number | null }) {
  if (value === null) return <Minus className="h-3 w-3 text-hextech-text-dim" />
  if (value > 0) return <TrendingUp className="h-3 w-3 text-hextech-green" />
  if (value < 0) return <TrendingDown className="h-3 w-3 text-[#FF4655]" />
  return <Minus className="h-3 w-3 text-hextech-text-dim" />
}

function DiffValue({ value, suffix = '' }: { value: number | null; suffix?: string }) {
  if (value === null) return <span className="text-hextech-text-dim">—</span>
  const color = value > 0 ? 'text-hextech-green' : value < 0 ? 'text-[#FF4655]' : 'text-hextech-text'
  return <span className={color}>{value > 0 ? '+' : ''}{value}{suffix}</span>
}

function StatRow({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-xs text-hextech-text">{label}</span>
      <div className="flex items-center gap-2 text-sm font-semibold text-hextech-text-bright">
        {value}
        {sub && <span className="text-xs font-normal text-hextech-text-dim">{sub}</span>}
      </div>
    </div>
  )
}

function NullableStatRow({ label, value, suffix = '' }: { label: string; value: number | null; suffix?: string }) {
  return (
    <StatRow
      label={label}
      value={value !== null ? `${value}${suffix}` : <span className="text-hextech-text-dim">—</span>}
    />
  )
}

/** Row that shows player value and optionally opponent value with a diff indicator. */
function CompareRow({
  label,
  playerValue,
  opponentValue,
  showCompare,
  higherIsBetter = true,
  suffix = '',
  digits = 0,
}: {
  label: string
  playerValue: number | null
  opponentValue: number | null | undefined
  showCompare: boolean
  higherIsBetter?: boolean
  suffix?: string
  digits?: number
}) {
  const fmt = (v: number | null) =>
    v === null || v === undefined
      ? '—'
      : digits > 0
        ? `${v.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}${suffix}`
        : `${Math.round(v).toLocaleString()}${suffix}`

  if (!showCompare || opponentValue === null || opponentValue === undefined) {
    return (
      <StatRow
        label={label}
        value={fmt(playerValue)}
      />
    )
  }

  const diff = playerValue !== null ? playerValue - opponentValue : null
  const isAhead = diff !== null && diff !== 0 ? (higherIsBetter ? diff > 0 : diff < 0) : null
  const diffColor = isAhead === true ? 'text-hextech-green' : isAhead === false ? 'text-[#FF4655]' : 'text-hextech-text-dim'

  return (
    <div className="flex items-center justify-between py-1.5 gap-2">
      <span className="text-xs text-hextech-text shrink-0">{label}</span>
      <div className="flex items-center gap-2 text-sm font-semibold min-w-0">
        <span className="text-hextech-text-bright">{fmt(playerValue)}</span>
        <span className="text-hextech-text-dim text-xs font-normal">vs</span>
        <span className="text-hextech-text-dim">{fmt(opponentValue)}</span>
        {diff !== null && diff !== 0 && (
          <span className={cn('text-xs font-medium', diffColor)}>
            ({diff > 0 ? '+' : ''}{digits > 0 ? diff.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits }) : Math.round(diff).toLocaleString()}{suffix})
          </span>
        )}
      </div>
    </div>
  )
}

/* ─── Category Cards ─── */

function LaningCard({ stats, compareOpponent }: { stats: DetailedGameStats; compareOpponent: boolean }) {
  const { t } = useTranslation()
  const l = stats.laning
  const opp = stats.opponent
  const show = compareOpponent
  const gameWasShort = stats.meta.duration < 900

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Crown className="h-4 w-4 text-hextech-gold" />
          {t('detailedStats.laning.title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-0 divide-y divide-hextech-border-dim/50">
        {gameWasShort ? (
          <p className="text-xs text-hextech-text-dim py-3 text-center">{t('detailedStats.laning.shortGame')}</p>
        ) : (
          <>
            <CompareRow label={t('detailedStats.laning.gold15')} playerValue={l.gold15} opponentValue={opp?.gold15 ?? null} showCompare={show} />
            <CompareRow label={t('detailedStats.laning.xp15')} playerValue={l.xp15} opponentValue={opp?.xp15 ?? null} showCompare={show} />
            <CompareRow label={t('detailedStats.laning.cs15')} playerValue={l.cs15} opponentValue={opp?.cs15 ?? null} showCompare={show} />
            <CompareRow label={t('detailedStats.laning.dmg15')} playerValue={l.damage15} opponentValue={opp?.damage15 ?? null} showCompare={show} />
            <CompareRow label={t('detailedStats.laning.xpPerMin15')} playerValue={l.xpPerMin15} opponentValue={opp?.xpPerMin15 ?? null} showCompare={show} digits={1} />
            <CompareRow label={t('detailedStats.laning.dpm15')} playerValue={l.damagePerMin15} opponentValue={opp?.damagePerMin15 ?? null} showCompare={show} digits={1} />
            <CompareRow label={t('detailedStats.laning.turretPlates15')} playerValue={l.turretPlates15} opponentValue={opp?.turretPlates15 ?? null} showCompare={show} />
          </>
        )}
        {show && opp ? (
          <div className="flex items-center justify-between py-1.5">
            <span className="text-xs text-hextech-text">{t('detailedStats.laning.firstBlood')}</span>
            <div className="flex items-center gap-3 text-xs font-semibold">
              <Badge variant={l.firstBloodParticipation ? 'success' : 'outline'} className="text-[10px] h-5">{l.firstBloodParticipation ? t('detailedStats.yes') : t('detailedStats.no')}</Badge>
              <span className="text-hextech-text-dim">vs</span>
              <Badge variant={opp.firstBloodParticipation ? 'success' : 'outline'} className="text-[10px] h-5 text-hextech-text-dim">{opp.firstBloodParticipation ? t('detailedStats.yes') : t('detailedStats.no')}</Badge>
            </div>
          </div>
        ) : (
          <StatRow label={t('detailedStats.laning.firstBlood')} value={
            l.firstBloodParticipation
              ? <Badge variant="success" className="text-[10px] h-5">{t('detailedStats.yes')}</Badge>
              : <Badge variant="outline" className="text-[10px] h-5 text-hextech-text-dim">{t('detailedStats.no')}</Badge>
          } />
        )}
      </CardContent>
    </Card>
  )
}

function EconomyCard({ stats, compareOpponent }: { stats: DetailedGameStats; compareOpponent: boolean }) {
  const { t } = useTranslation()
  const e = stats.economy
  const opp = stats.opponent
  const show = compareOpponent
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Coins className="h-4 w-4 text-hextech-gold" />
          {t('detailedStats.economy.title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-0 divide-y divide-hextech-border-dim/50">
        <CompareRow label={t('detailedStats.economy.gpm')} playerValue={e.goldPerMin} opponentValue={opp?.goldPerMin ?? null} showCompare={show} />
        <CompareRow label={t('detailedStats.economy.cspm')} playerValue={e.csPerMin !== null ? Number(e.csPerMin) : null} opponentValue={opp?.csPerMin ?? null} showCompare={show} digits={1} />
        <CompareRow label="Total CS" playerValue={e.laneCS + e.jungleCS} opponentValue={opp?.cs ?? null} showCompare={show} />
        <CompareRow label={t('detailedStats.economy.xp')} playerValue={e.xp} opponentValue={null} showCompare={false} />
        <CompareRow label={t('detailedStats.economy.xpPerMin')} playerValue={e.xpPerMin} opponentValue={null} showCompare={false} digits={1} />
        <StatRow label={t('detailedStats.economy.teamGold')} value={e.teamGoldPercent != null ? `${e.teamGoldPercent}%` : '—'} />
        {show && opp ? (
          <div className="flex items-center justify-between py-1.5">
            <span className="text-xs text-hextech-text">{t('detailedStats.economy.csSplit')}</span>
            <div className="flex items-center gap-2 text-sm font-semibold">
              <span className="text-hextech-text-bright">{e.laneCS}/{e.jungleCS}</span>
              <span className="text-hextech-text-dim text-xs">vs</span>
              <span className="text-hextech-text-dim">{opp.laneCS}/{opp.jungleCS}</span>
            </div>
          </div>
        ) : (
          <StatRow label={t('detailedStats.economy.csSplit')} value={`${e.laneCS} / ${e.jungleCS}`} sub={t('detailedStats.economy.laneJungle')} />
        )}
        <NullableStatRow label={t('detailedStats.economy.maxCsAdv')} value={e.maxCsAdvantage} />
      </CardContent>
    </Card>
  )
}

function CombatCard({ stats, compareOpponent }: { stats: DetailedGameStats; compareOpponent: boolean }) {
  const { t } = useTranslation()
  const c = stats.combat
  const opp = stats.opponent
  const show = compareOpponent
  const gameDurationMin = stats.meta.duration / 60
  const playerTotalDamage = c.damagePerMin != null ? Math.round(c.damagePerMin * gameDurationMin) : null

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Swords className="h-4 w-4 text-[#FF4655]" />
          {t('detailedStats.combat.title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-0 divide-y divide-hextech-border-dim/50">
        <CompareRow label={t('detailedStats.combat.totalDamage')} playerValue={playerTotalDamage} opponentValue={opp?.totalDamage ?? null} showCompare={show} />
        <CompareRow label={t('detailedStats.combat.kp')} playerValue={c.killParticipation} opponentValue={opp?.killParticipation ?? null} showCompare={show} digits={1} suffix="%" />
        <CompareRow label={t('detailedStats.combat.dpm')} playerValue={c.damagePerMin} opponentValue={opp?.damagePerMin ?? null} showCompare={show} />
        <StatRow label={t('detailedStats.combat.teamDmg')} value={c.teamDamagePercent != null ? `${c.teamDamagePercent}%` : '—'} />
        <CompareRow label={t('detailedStats.combat.dmgPerGold')} playerValue={c.damagePerGold} opponentValue={opp?.damagePerGold ?? null} showCompare={show} digits={2} />
        <CompareRow label={t('detailedStats.combat.soloKills')} playerValue={c.soloKills} opponentValue={opp?.soloKills ?? null} showCompare={show} />
        <CompareRow label={t('detailedStats.combat.dmgTaken')} playerValue={c.damageTaken} opponentValue={opp?.damageTaken ?? null} showCompare={show} higherIsBetter={false} />
        <CompareRow label={t('detailedStats.combat.dmgMitigated')} playerValue={c.damageMitigated} opponentValue={opp?.damageMitigated ?? null} showCompare={show} />
      </CardContent>
    </Card>
  )
}

function ObjectivesCard({ stats, compareOpponent }: { stats: DetailedGameStats; compareOpponent: boolean }) {
  const { t } = useTranslation()
  const o = stats.objectives
  const opp = stats.opponent
  const show = compareOpponent
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Target className="h-4 w-4 text-hextech-cyan" />
          {t('detailedStats.objectives.title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-0 divide-y divide-hextech-border-dim/50">
        <CompareRow label={t('detailedStats.objectives.dmgEpic')} playerValue={o.damageToEpicMonsters} opponentValue={opp?.epicMonsterDamage ?? null} showCompare={show} />
        <StatRow label={t('detailedStats.objectives.epicDmgPercent')} value={o.teamEpicMonsterDmgPercent != null ? `${o.teamEpicMonsterDmgPercent}%` : '—'} />
        <CompareRow label={t('detailedStats.objectives.dmgBuild')} playerValue={o.damageToBuildings} opponentValue={opp?.damageToBuildings ?? null} showCompare={show} />
        <CompareRow label={t('detailedStats.objectives.turretPlates')} playerValue={o.turretPlates} opponentValue={opp?.turretPlates ?? null} showCompare={show} />
        <CompareRow label={t('detailedStats.objectives.inhibitors')} playerValue={o.inhibitorTakedowns} opponentValue={opp?.inhibitorTakedowns ?? null} showCompare={show} />
        <CompareRow label={t('detailedStats.objectives.stolen')} playerValue={o.objectivesStolen} opponentValue={opp?.objectivesStolen ?? null} showCompare={show} />
        {show && opp ? (
          <div className="flex items-center justify-between py-1.5">
            <span className="text-xs text-hextech-text">{t('detailedStats.objectives.firstTower')}</span>
            <div className="flex items-center gap-3 text-xs font-semibold">
              <Badge variant={o.firstTowerParticipation ? 'success' : 'outline'} className="text-[10px] h-5">{o.firstTowerParticipation ? t('detailedStats.yes') : t('detailedStats.no')}</Badge>
              <span className="text-hextech-text-dim">vs</span>
              <Badge variant={opp.firstTowerParticipation ? 'success' : 'outline'} className="text-[10px] h-5 text-hextech-text-dim">{opp.firstTowerParticipation ? t('detailedStats.yes') : t('detailedStats.no')}</Badge>
            </div>
          </div>
        ) : (
          <StatRow label={t('detailedStats.objectives.firstTower')} value={
            o.firstTowerParticipation
              ? <Badge variant="success" className="text-[10px] h-5">{t('detailedStats.yes')}</Badge>
              : <Badge variant="outline" className="text-[10px] h-5 text-hextech-text-dim">{t('detailedStats.no')}</Badge>
          } />
        )}
      </CardContent>
    </Card>
  )
}

function VisionCard({ stats, compareOpponent }: { stats: DetailedGameStats; compareOpponent: boolean }) {
  const { t } = useTranslation()
  const v = stats.vision
  const opp = stats.opponent
  const show = compareOpponent
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Eye className="h-4 w-4 text-hextech-teal" />
          {t('detailedStats.vision.title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-0 divide-y divide-hextech-border-dim/50">
        <CompareRow label={t('detailedStats.vision.vsPerMin')} playerValue={v.visionScorePerMin} opponentValue={opp?.visionScorePerMin ?? null} showCompare={show} digits={2} />
        <CompareRow label={t('detailedStats.vision.controlWards')} playerValue={v.controlWardsPurchased} opponentValue={opp?.controlWardsPurchased ?? null} showCompare={show} />
        <CompareRow label={t('detailedStats.vision.wardsPlaced')} playerValue={v.wardsPlaced} opponentValue={opp?.wardsPlaced ?? null} showCompare={show} />
        <CompareRow label={t('detailedStats.vision.wardsDestroyed')} playerValue={v.wardsDestroyed} opponentValue={opp?.wardsDestroyed ?? null} showCompare={show} />
        <CompareRow label={t('detailedStats.vision.stealthWards')} playerValue={v.stealthWardsPlaced} opponentValue={opp?.stealthWardsPlaced ?? null} showCompare={show} />
        <StatRow
          label={t('detailedStats.vision.vsAdvantage')}
          value={
            v.visionScoreAdvantage !== null
              ? <><DiffIndicator value={v.visionScoreAdvantage} /> <DiffValue value={v.visionScoreAdvantage} /></>
              : <span className="text-hextech-text-dim">—</span>
          }
        />
      </CardContent>
    </Card>
  )
}

function BehavioralCard({ stats, compareOpponent }: { stats: DetailedGameStats; compareOpponent: boolean }) {
  const { t } = useTranslation()
  const b = stats.behavioral
  const opp = stats.opponent
  const show = compareOpponent
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Zap className="h-4 w-4 text-hextech-gold-bright" />
          {t('detailedStats.behavioral.title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-0 divide-y divide-hextech-border-dim/50">
        <CompareRow label={t('detailedStats.behavioral.skillshots')} playerValue={b.skillshotsDodged} opponentValue={opp?.skillshotsDodged ?? null} showCompare={show} />
        <CompareRow label={t('detailedStats.behavioral.killsNearTurret')} playerValue={b.killsNearEnemyTurret} opponentValue={opp?.killsNearEnemyTurret ?? null} showCompare={show} />
        <CompareRow label={t('detailedStats.behavioral.outnumbered')} playerValue={b.outnumberedKills} opponentValue={opp?.outnumberedKills ?? null} showCompare={show} />
        <CompareRow label={t('detailedStats.behavioral.enemyJungle')} playerValue={b.takedownsInEnemyJungle} opponentValue={opp?.takedownsInEnemyJungle ?? null} showCompare={show} />
      </CardContent>
    </Card>
  )
}
