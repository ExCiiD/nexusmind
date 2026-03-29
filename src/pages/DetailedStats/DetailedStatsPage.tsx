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
  Shield,
  Eye,
  Target,
  Zap,
  TrendingUp,
  TrendingDown,
  Minus,
  Crown,
  HelpCircle,
  User,
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

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          {t('detailedStats.back')}
        </Button>
      </div>

      {/* Game header */}
      <div className={cn(
        'rounded-lg border p-4',
        m.win ? 'border-hextech-green/30 bg-hextech-green/5' : 'border-[#FF4655]/30 bg-[#FF4655]/5',
      )}>
        <div className="flex items-center gap-4">
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
      <DiffLegendBanner />

      {/* Stat categories in a 2-column grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <LaningCard stats={stats} />
        <EconomyCard stats={stats} />
        <CombatCard stats={stats} />
        <ObjectivesCard stats={stats} />
        <VisionCard stats={stats} />
        <BehavioralCard stats={stats} />
      </div>
    </div>
  )
}

function DiffLegendBanner() {
  const { t } = useTranslation()
  return (
    <TooltipProvider>
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

/* ─── Category Cards ─── */

function LaningCard({ stats }: { stats: DetailedGameStats }) {
  const { t } = useTranslation()
  const l = stats.laning
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
            <StatRow
              label={t('detailedStats.laning.gold15')}
              value={formatStatNumber(l.gold15)}
              sub={<><DiffIndicator value={l.goldDiff15} /> <DiffValue value={l.goldDiff15} /></>}
            />
            <StatRow
              label={t('detailedStats.laning.xp15')}
              value={formatStatNumber(l.xp15)}
              sub={<><DiffIndicator value={l.xpDiff15} /> <DiffValue value={l.xpDiff15} /></>}
            />
            <NullableStatRow
              label={t('detailedStats.laning.xpPerMin15')}
              value={l.xpPerMin15}
            />
            <StatRow
              label={t('detailedStats.laning.cs15')}
              value={formatStatNumber(l.cs15)}
              sub={<><DiffIndicator value={l.csDiff15} /> <DiffValue value={l.csDiff15} /></>}
            />
            <StatRow
              label={t('detailedStats.laning.dmg15')}
              value={formatStatNumber(l.damage15)}
              sub={<><DiffIndicator value={l.damageDiff15} /> <DiffValue value={l.damageDiff15} /></>}
            />
            <NullableStatRow
              label={t('detailedStats.laning.dpm15')}
              value={l.damagePerMin15}
            />
            <NullableStatRow
              label={t('detailedStats.laning.turretPlates15')}
              value={l.turretPlates15}
            />
          </>
        )}
        <StatRow
          label={t('detailedStats.laning.firstBlood')}
          value={
            l.firstBloodParticipation
              ? <Badge variant="success" className="text-[10px] h-5">{t('detailedStats.yes')}</Badge>
              : <Badge variant="outline" className="text-[10px] h-5 text-hextech-text-dim">{t('detailedStats.no')}</Badge>
          }
        />
      </CardContent>
    </Card>
  )
}

function EconomyCard({ stats }: { stats: DetailedGameStats }) {
  const { t } = useTranslation()
  const e = stats.economy
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Coins className="h-4 w-4 text-hextech-gold" />
          {t('detailedStats.economy.title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-0 divide-y divide-hextech-border-dim/50">
        <NullableStatRow label={t('detailedStats.economy.xp')} value={e.xp} />
        <NullableStatRow label={t('detailedStats.economy.xpPerMin')} value={e.xpPerMin} />
        <StatRow label={t('detailedStats.economy.gpm')} value={formatStatNumber(e.goldPerMin)} />
        <StatRow label={t('detailedStats.economy.cspm')} value={e.csPerMin ?? '—'} />
        <StatRow label={t('detailedStats.economy.teamGold')} value={e.teamGoldPercent != null ? `${e.teamGoldPercent}%` : '—'} />
        <StatRow
          label={t('detailedStats.economy.csSplit')}
          value={`${e.laneCS} / ${e.jungleCS}`}
          sub={t('detailedStats.economy.laneJungle')}
        />
        <NullableStatRow label={t('detailedStats.economy.maxCsAdv')} value={e.maxCsAdvantage} />
      </CardContent>
    </Card>
  )
}

function CombatCard({ stats }: { stats: DetailedGameStats }) {
  const { t } = useTranslation()
  const c = stats.combat
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Swords className="h-4 w-4 text-[#FF4655]" />
          {t('detailedStats.combat.title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-0 divide-y divide-hextech-border-dim/50">
        <StatRow label={t('detailedStats.combat.totalDamage')} value={formatStatNumber(c.damagePerMin != null ? c.damagePerMin * (stats.meta.duration / 60) : null)} />
        <StatRow label={t('detailedStats.combat.kp')} value={c.killParticipation != null ? `${c.killParticipation}%` : '—'} />
        <StatRow label={t('detailedStats.combat.dpm')} value={formatStatNumber(c.damagePerMin)} />
        <StatRow label={t('detailedStats.combat.teamDmg')} value={c.teamDamagePercent != null ? `${c.teamDamagePercent}%` : '—'} />
        <StatRow label={t('detailedStats.combat.dmgPerGold')} value={c.damagePerGold ?? '—'} />
        <NullableStatRow label={t('detailedStats.combat.soloKills')} value={c.soloKills} />
        <StatRow label={t('detailedStats.combat.dmgTaken')} value={formatStatNumber(c.damageTaken)} sub={c.damageTakenPercent != null ? `${c.damageTakenPercent}%` : undefined} />
        <StatRow label={t('detailedStats.combat.dmgMitigated')} value={formatStatNumber(c.damageMitigated)} />
      </CardContent>
    </Card>
  )
}

function ObjectivesCard({ stats }: { stats: DetailedGameStats }) {
  const { t } = useTranslation()
  const o = stats.objectives
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Target className="h-4 w-4 text-hextech-cyan" />
          {t('detailedStats.objectives.title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-0 divide-y divide-hextech-border-dim/50">
        <StatRow
          label={t('detailedStats.objectives.dmgEpic')}
          value={formatStatNumber(o.damageToEpicMonsters)}
        />
        <StatRow
          label={t('detailedStats.objectives.epicDmgPercent')}
          value={o.teamEpicMonsterDmgPercent != null ? `${o.teamEpicMonsterDmgPercent}%` : '—'}
        />
        <StatRow
          label={t('detailedStats.objectives.dmgBuild')}
          value={formatStatNumber(o.damageToBuildings)}
          sub={(o.teamBuildingDamagePercent != null && o.teamBuildingDamagePercent !== undefined)
            ? `${o.teamBuildingDamagePercent}% ${t('detailedStats.objectives.ofTeam')}`
            : undefined}
        />
        <StatRow label={t('detailedStats.objectives.turretPlates')} value={o.turretPlates ?? 0} />
        <StatRow label={t('detailedStats.objectives.inhibitors')} value={o.inhibitorTakedowns ?? 0} />
        <StatRow label={t('detailedStats.objectives.stolen')} value={o.objectivesStolen} />
        <StatRow
          label={t('detailedStats.objectives.firstTower')}
          value={
            o.firstTowerParticipation
              ? <Badge variant="success" className="text-[10px] h-5">{t('detailedStats.yes')}</Badge>
              : <Badge variant="outline" className="text-[10px] h-5 text-hextech-text-dim">{t('detailedStats.no')}</Badge>
          }
        />
      </CardContent>
    </Card>
  )
}

function VisionCard({ stats }: { stats: DetailedGameStats }) {
  const { t } = useTranslation()
  const v = stats.vision
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Eye className="h-4 w-4 text-hextech-teal" />
          {t('detailedStats.vision.title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-0 divide-y divide-hextech-border-dim/50">
        <StatRow label={t('detailedStats.vision.vsPerMin')} value={v.visionScorePerMin} />
        <StatRow label={t('detailedStats.vision.controlWards')} value={v.controlWardsPurchased} />
        <StatRow label={t('detailedStats.vision.wardsPlaced')} value={v.wardsPlaced} />
        <StatRow label={t('detailedStats.vision.wardsDestroyed')} value={v.wardsDestroyed} />
        <NullableStatRow label={t('detailedStats.vision.stealthWards')} value={v.stealthWardsPlaced} />
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

function BehavioralCard({ stats }: { stats: DetailedGameStats }) {
  const { t } = useTranslation()
  const b = stats.behavioral
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Zap className="h-4 w-4 text-hextech-gold-bright" />
          {t('detailedStats.behavioral.title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-0 divide-y divide-hextech-border-dim/50">
        <NullableStatRow label={t('detailedStats.behavioral.skillshots')} value={b.skillshotsDodged} />
        <NullableStatRow label={t('detailedStats.behavioral.killsNearTurret')} value={b.killsNearEnemyTurret} />
        <NullableStatRow label={t('detailedStats.behavioral.outnumbered')} value={b.outnumberedKills} />
        <NullableStatRow label={t('detailedStats.behavioral.enemyJungle')} value={b.takedownsInEnemyJungle} />
      </CardContent>
    </Card>
  )
}
