import { useEffect, useState } from 'react'
import type { WeeklyAwards } from '@/lib/ipc'

/**
 * The weekly awards of a local team (team:weekly-awards): who wears the MVP
 * and Grinder frames on the player cards, their streaks and totals. Null
 * while loading, without a team, or when the lookup fails (cards simply
 * show no frame). `refreshKey` reloads them (roster changes).
 */
export function useWeeklyAwards(teamId: string | null | undefined, refreshKey?: unknown): WeeklyAwards | null {
  const [awards, setAwards] = useState<WeeklyAwards | null>(null)
  useEffect(() => {
    const load = window.api.teamWeeklyAwards
    if (!teamId || !load) {
      setAwards(null)
      return
    }
    let alive = true
    load(teamId)
      .then((a) => { if (alive) setAwards(a) })
      .catch(() => { if (alive) setAwards(null) })
    return () => { alive = false }
  }, [teamId, refreshKey])
  return awards
}
