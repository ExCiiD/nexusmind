/**
 * DashboardTab — wide stats table + 4 donut charts.
 *
 * Visual layout mirrors the spreadsheet used by competitive players:
 *   - One row per roster member
 *   - 20+ columns of averaged stats (K/D/A, CS, damage, vision, etc.)
 *   - Below: pie/donut charts breaking down team contribution
 *     (damage dealt, damage taken, gold, kill participation)
 *
 * Shares the same `team:compute-synergy-stats` backend and `localStorage`
 * cache as StatsTab — computing in either tab auto-populates the other on
 * next mount.
 */

import { useState, useMemo, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/useToast'
import { Loader2, RefreshCw, Users, BarChart3 } from 'lucide-react'
import { compareByRole } from '@/lib/championRoles'
import type { Team, TeamSynergyStats } from '@/lib/ipc'
import { DashboardLayout } from './DashboardLayout'

interface Props {
  team: Team | null
}

const CACHE_KEY_PREFIX = 'nexusmind:combinedStats:'
function loadCache(teamId: string): Record<string, TeamSynergyStats> {
  try {
    const raw = localStorage.getItem(CACHE_KEY_PREFIX + teamId)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return typeof parsed === 'object' && parsed ? parsed : {}
  } catch { return {} }
}
function saveCacheEntry(teamId: string, minTogether: number, stats: TeamSynergyStats) {
  try {
    const cache = loadCache(teamId)
    cache[String(minTogether)] = stats
    localStorage.setItem(CACHE_KEY_PREFIX + teamId, JSON.stringify(cache))
  } catch (err) { console.warn('[DashboardTab] cache write failed', err) }
}

export function DashboardTab({ team }: Props) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [stats, setStats] = useState<TeamSynergyStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [minTogether, setMinTogether] = useState(3)
  const hydratedTeamRef = useRef<string | null>(null)

  // Lane-ordered so the table reads TOP → JG → MID → ADC → SUP, matching
  // the rest of the Team Management UI.
  const sortedPlayers = useMemo(() => {
    if (!stats) return []
    return [...stats.players].sort(compareByRole)
  }, [stats])

  // Hydrate from cache when team changes, falling back to any cached entry
  // if the selected `minTogether` doesn't have one yet.
  useEffect(() => {
    if (!team) {
      setStats(null)
      hydratedTeamRef.current = null
      return
    }
    if (hydratedTeamRef.current === team.id) return
    const cache = loadCache(team.id)
    const match = cache[String(minTogether)]
    if (match) {
      setStats(match)
    } else {
      const fallbackKey = Object.keys(cache)[0]
      if (fallbackKey) {
        setStats(cache[fallbackKey])
        setMinTogether(Number(fallbackKey))
      } else {
        setStats(null)
      }
    }
    hydratedTeamRef.current = team.id
  }, [team, minTogether])

  // Auto-recompute when changing minTogether and the new value has no cache.
  // Skipped on first visit (no stats present yet) so we don't surprise the
  // user with a long fetch.
  useEffect(() => {
    if (!team || loading) return
    if (hydratedTeamRef.current !== team.id) return
    const cache = loadCache(team.id)
    const cached = cache[String(minTogether)]
    if (cached) {
      if (!stats || stats.fetchedAt !== cached.fetchedAt) setStats(cached)
      return
    }
    if (stats) {
      setStats(null)
      void handleCompute()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minTogether, team])

  const handleCompute = async () => {
    if (!team) return
    setLoading(true)
    try {
      // Dashboard uses the combined endpoint so flex + scrim + tournament
      // are all aggregated together. The individual StatsTab / Scrim /
      // Tournament tabs use their dedicated endpoints for source-specific
      // breakdowns. Cache key stays the same as StatsTab on the renderer
      // (synergyStats:<teamId>) but holds a different payload — this is
      // fine because each tab reads/writes its own minTogether slot and
      // the keys never collide; visually they look identical.
      const res = await window.api.computeCombinedStats(team.id, { minTogether })
      setStats(res)
      saveCacheEntry(team.id, minTogether, res)
      if (res.matchCount === 0) {
        toast({
          title: t('team.stats.noMatches', { defaultValue: 'No synergy matches found' }),
          description: t('team.stats.noMatchesDesc', {
            defaultValue: 'No recent flex games where ≥{{n}} of your roster played together.',
            n: minTogether,
          }),
        })
      }
    } catch (err) {
      toast({
        title: t('team.stats.failed', { defaultValue: 'Failed to compute stats' }),
        description: (err as Error).message,
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  if (!team) {
    return (
      <Card className="p-6 text-center text-hextech-text-dim">
        {t('team.dashboard.noTeam', { defaultValue: 'Select or create a team first.' })}
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <Card className="p-4 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-hextech-gold" />
          <span className="text-sm text-hextech-text">
            {t('team.dashboard.subtitleCombined', {
              defaultValue: 'Combined stats: flex (≥{{n}} together) + all imported scrim & tournament games',
              n: minTogether,
            })}
          </span>
        </div>

        <div className="flex items-center gap-2 ml-auto">
          <label className="flex items-center gap-1.5 text-xs text-hextech-text-dim">
            {t('team.stats.minTogether', { defaultValue: 'Min players together:' })}
            <select
              value={minTogether}
              onChange={(e) => setMinTogether(Number(e.target.value))}
              disabled={loading}
              className="bg-hextech-dark border border-hextech-border rounded px-2 py-1 text-xs"
            >
              <option value={2}>2</option>
              <option value={3}>3</option>
              <option value={4}>4</option>
              <option value={5}>5</option>
            </select>
          </label>

          <Button
            size="sm"
            onClick={handleCompute}
            disabled={loading || !team || (team.members ?? []).length < minTogether}
          >
            {loading
              ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
            {loading
              ? t('team.stats.computing', { defaultValue: 'Computing…' })
              : stats
                ? t('team.stats.refresh', { defaultValue: 'Refresh' })
                : t('team.stats.compute', { defaultValue: 'Compute synergy stats' })}
          </Button>
        </div>
      </Card>

      {!stats && !loading && (
        <Card className="p-8 text-center text-hextech-text-dim">
          <BarChart3 className="h-8 w-8 mx-auto opacity-40" />
          <p className="mt-3 text-sm">
            {t('team.dashboard.emptyHint', {
              defaultValue: 'Click "Compute synergy stats" to populate the dashboard.',
            })}
          </p>
          <p className="mt-1 text-[10px] text-hextech-text-dim/70">
            {t('team.stats.cacheHint', {
              defaultValue: 'Results are cached locally and re-loaded next time you open this tab.',
            })}
          </p>
        </Card>
      )}

      {!stats && loading && (
        <Card className="p-8 text-center text-hextech-text-dim">
          <Loader2 className="h-8 w-8 mx-auto animate-spin text-hextech-gold" />
          <p className="mt-3 text-sm">
            {t('team.stats.computingDesc', {
              defaultValue: 'Fetching match history and computing synergy stats — may take up to a minute on first run.',
            })}
          </p>
        </Card>
      )}

      {stats && stats.matchCount > 0 && (
        <DashboardLayout
          players={sortedPlayers}
          matchCount={stats.matchCount}
          basedOnLabel={t('team.dashboard.basedOnFlex', {
            defaultValue: 'Averages from {{n}} flex games',
            n: stats.matchCount,
          })}
        />
      )}

      {stats && stats.matchCount === 0 && (
        <Card className="p-6 text-center text-hextech-text-dim">
          {t('team.stats.noMatchesDesc', {
            defaultValue: 'No recent flex games where ≥{{n}} of your roster played together.',
            n: minTogether,
          })}
        </Card>
      )}
    </div>
  )
}

