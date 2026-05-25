/**
 * StatsTab — synergy stats for the active team.
 *
 * Pulls every flex-queue match where at least N team members played together
 * on the same side (via `team:compute-synergy-stats`), then renders three
 * sections per player:
 *   1. Averages: KDA, CS/min, dmg dealt/taken, CC, vision, gold/min
 *   2. Shares: % of team total for damage, gold, vision, dmg taken, CC
 *   3. Per-champion win rate table
 *
 * The compute step can be slow on first run (lots of match fetches), but
 * MatchCache makes subsequent refreshes nearly instant. Surfaced via an
 * explicit "Compute" button so users opt in to the API cost.
 */

import { useState, useMemo, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/useToast'
import { Loader2, RefreshCw, Users } from 'lucide-react'
import { compareByRole } from '@/lib/championRoles'
import type { Team, TeamSynergyStats } from '@/lib/ipc'
import { SynergyPlayerCard } from './SynergyPlayerCard'

interface Props {
  team: Team | null
}

/**
 * LocalStorage cache layout. Each team gets one entry holding a map of
 * cached results keyed by the `minTogether` value used, so toggling the
 * filter between (say) 3 and 4 doesn't repeatedly hit Riot — we serve the
 * matching cache and only recompute on first visit for a given threshold.
 *
 *   nexusmind:synergyStats:<teamId>  →  { "3": {stats…}, "4": {stats…} }
 */
const CACHE_KEY_PREFIX = 'nexusmind:synergyStats:'
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
  } catch (err) {
    console.warn('[StatsTab] failed to persist synergy stats', err)
  }
}

export function StatsTab({ team }: Props) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [stats, setStats] = useState<TeamSynergyStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [minTogether, setMinTogether] = useState(3)
  // Tracks the team we last hydrated from cache for, so switching active
  // teams re-hydrates rather than carrying over the previous team's stats.
  const hydratedTeamRef = useRef<string | null>(null)

  // Sort players in canonical lane order so the cards line up with the rest
  // of the app (Roster, Champion Pool, Scouting all use the same order).
  const sortedPlayers = useMemo(() => {
    if (!stats) return []
    return [...stats.players].sort(compareByRole)
  }, [stats])

  // Hydrate from localStorage when a team is first selected. We pick the
  // entry matching the currently-selected `minTogether` if available, else
  // fall back to whatever single entry exists so the user sees *something*
  // immediately (and can recompute if they want a different threshold).
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
      // No exact match — try any cached entry so the UI isn't blank, but
      // align the `minTogether` selector with whatever we found to avoid
      // misleading the user about which threshold the data is for.
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

  // When the user changes `minTogether` and we have a cached entry for it,
  // serve that immediately. Otherwise auto-trigger a fresh compute so the
  // displayed numbers always match the selected threshold.
  useEffect(() => {
    if (!team || loading) return
    if (hydratedTeamRef.current !== team.id) return // wait for hydration
    const cache = loadCache(team.id)
    const cached = cache[String(minTogether)]
    if (cached) {
      // Cache hit — swap in if it's not already the displayed dataset
      if (!stats || stats.fetchedAt !== cached.fetchedAt) setStats(cached)
      return
    }
    // Cache miss for this threshold → auto-compute. Only fire when the user
    // has actually engaged with the tab (i.e. we already have *some* stats
    // from a previous compute) so we don't surprise users with a long fetch
    // the very first time they open the tab. We also clear `stats` so the
    // user doesn't briefly see stale numbers from the old threshold.
    if (stats) {
      setStats(null)
      void handleCompute()
    }
    // We intentionally exclude `stats` and `handleCompute` from deps — they
    // would re-trigger this effect after compute completes and create a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minTogether, team])

  const handleCompute = async () => {
    if (!team) return
    setLoading(true)
    try {
      const res = await window.api.computeTeamSynergyStats(team.id, { minTogether })
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
      } else {
        toast({
          title: t('team.stats.computed', { defaultValue: 'Synergy stats ready' }),
          description: t('team.stats.computedDesc', {
            defaultValue: '{{matches}} flex games · {{members}} members with data',
            matches: res.matchCount,
            members: res.membersWithGames,
          }),
        })
      }
    } catch (err) {
      console.error('[StatsTab] compute failed', err)
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
        {t('team.stats.noTeam', { defaultValue: 'Select or create a team first.' })}
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <Card className="p-4 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-hextech-gold" />
          <span className="text-sm text-hextech-text">
            {t('team.stats.subtitle', {
              defaultValue: 'Flex queue games where ≥{{n}} of your roster played together',
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
            title={t('team.stats.computeHint', {
              defaultValue: 'Fetches the last 100 flex games per member and aggregates stats. First run can take a minute.',
            })}
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

      {stats === null && !loading && (
        <Card className="p-8 text-center text-hextech-text-dim">
          <BarChart3Placeholder />
          <p className="mt-3 text-sm">
            {t('team.stats.emptyHint', {
              defaultValue: 'Click "Compute synergy stats" to pull and analyze your last flex games together.',
            })}
          </p>
          <p className="mt-1 text-[10px] text-hextech-text-dim/70">
            {t('team.stats.cacheHint', {
              defaultValue: 'Results are cached locally and re-loaded next time you open this tab.',
            })}
          </p>
        </Card>
      )}

      {stats === null && loading && (
        <Card className="p-8 text-center text-hextech-text-dim">
          <Loader2 className="h-8 w-8 mx-auto animate-spin text-hextech-gold" />
          <p className="mt-3 text-sm">
            {t('team.stats.computingDesc', {
              defaultValue: 'Fetching match history and computing synergy stats — may take up to a minute on first run.',
            })}
          </p>
        </Card>
      )}

      {stats && (
        <>
          <Card className="p-3 flex items-center gap-4 text-xs text-hextech-text-dim flex-wrap">
            <Badge label={t('team.stats.matchCount', { defaultValue: 'Matches' })} value={String(stats.matchCount)} />
            <Badge label={t('team.stats.candidates', { defaultValue: 'Candidates scanned' })} value={String(stats.candidateCount)} />
            <Badge label={t('team.stats.players', { defaultValue: 'Players with data' })} value={`${stats.membersWithGames}/${stats.membersResolved}`} />
            <span className="ml-auto italic">
              {t('team.stats.lastUpdate', { defaultValue: 'Updated' })}: {new Date(stats.fetchedAt).toLocaleTimeString()}
            </span>
          </Card>

          {stats.matchCount === 0 ? (
            <Card className="p-6 text-center text-hextech-text-dim">
              {t('team.stats.noMatchesDesc', {
                defaultValue: 'No recent flex games where ≥{{n}} of your roster played together.',
                n: minTogether,
              })}
            </Card>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
              {sortedPlayers.map((p) => (
                <SynergyPlayerCard key={p.memberId} player={p} matchCount={stats.matchCount} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Badge({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="uppercase tracking-wider text-[9px] font-semibold">{label}</span>
      <span className="text-hextech-text-bright font-bold tabular-nums">{value}</span>
    </span>
  )
}

function BarChart3Placeholder() {
  return (
    <div className="inline-flex h-12 items-end gap-1 opacity-40">
      <div className="w-2 h-4 bg-hextech-gold rounded-t" />
      <div className="w-2 h-8 bg-hextech-gold rounded-t" />
      <div className="w-2 h-6 bg-hextech-gold rounded-t" />
      <div className="w-2 h-10 bg-hextech-gold rounded-t" />
      <div className="w-2 h-5 bg-hextech-gold rounded-t" />
    </div>
  )
}

