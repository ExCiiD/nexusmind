import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Hourglass } from 'lucide-react'
import { EmptyState } from '@/components/ui/data-state'
import type { TeamGameTimeline } from '@/lib/analyst'
import { summarizeTeamObjectives } from '@/lib/teamTimelineCore'
import { DEFAULT_OBJECTIVES_FILTERS, toTeamObjectivesFilters, type ObjectivesFilterState } from '@/lib/analystViews'
import { ObjectivesView, type ObjectivesState } from './ObjectivesView'
import { analystErrorText, isMissingTableError } from './analystErrors'

/**
 * #40 · 1/3, Stats collectives → « Objectifs »: lists the group's team games for the filters, then reads each game's
 * summary one by one (the « 12 / 18 » banner: cached ones come back at once, the others go through Riot), and sums
 * them up with summarizeTeamObjectives. Summaries already read stay in memory while the tab is open, so changing a
 * filter only reads the games not seen yet.
 */
export function TeamObjectivesTab({ groupId }: { groupId: string }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [filters, setFilters] = useState<ObjectivesFilterState>(DEFAULT_OBJECTIVES_FILTERS)
  const [state, setState] = useState<ObjectivesState>({ kind: 'loading', done: 0, total: 0 })
  const [missingTable, setMissingTable] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const cache = useRef(new Map<string, TeamGameTimeline | 'unavailable'>())
  const teamFilters = useMemo(() => toTeamObjectivesFilters(filters), [filters])

  useEffect(() => { cache.current.clear() }, [groupId])

  useEffect(() => {
    let alive = true
    setState({ kind: 'loading', done: 0, total: 0 })
    ;(async () => {
      try {
        const refs = await window.api.teamObjectivesGames(groupId, teamFilters)
        if (!alive) return
        let done = 0
        setState({ kind: 'loading', done, total: refs.length })
        for (const ref of refs) {
          if (!alive) return
          if (!cache.current.has(ref.gameId)) {
            const res = await window.api.teamObjectivesGameTimeline(ref.gameId)
            cache.current.set(ref.gameId, 'unavailable' in res ? 'unavailable' : res)
          }
          done++
          if (alive) setState({ kind: 'loading', done, total: refs.length })
        }
        const ids = new Set(refs.map((r) => r.gameId))
        const read = [...cache.current.entries()].filter(([id]) => ids.has(id))
        const timelines = read.map(([, v]) => v).filter((v): v is TeamGameTimeline => v !== 'unavailable')
        if (alive) setState({ kind: 'ready', summary: summarizeTeamObjectives(timelines, teamFilters), unavailable: read.length - timelines.length })
      } catch (err) {
        if (!alive) return
        setMissingTable(isMissingTableError(err))
        setState({ kind: 'error', cause: analystErrorText(err, t) })
      }
    })()
    return () => { alive = false }
  }, [groupId, teamFilters, attempt, t])

  if (missingTable) {
    return <EmptyState icon={Hourglass} title={t('analyst.common.notDeployedTitle')} description={t('analyst.common.notDeployed')} />
  }
  return (
    <ObjectivesView
      state={state}
      filters={filters}
      onFiltersChange={setFilters}
      onRetry={() => setAttempt((n) => n + 1)}
      onWiden={() => setFilters((f) => ({ ...f, period: '30d' }))}
      onOpenPlanning={() => navigate('/management?tab=planning')}
    />
  )
}
