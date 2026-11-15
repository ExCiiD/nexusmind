import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Group } from '@/lib/collab'
import { isLegacyStaff } from '@/lib/permissions'

/**
 * Current cloud user + their groups, and a name resolver for comment authors.
 * `available` is false when the build has no cloud backend or nobody is signed in.
 */
export function useCollab() {
  const [myUserId, setMyUserId] = useState<string | null>(null)
  const [groups, setGroups] = useState<Group[]>([])
  const [available, setAvailable] = useState(false)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    try {
      const status = await window.api.cloudStatus()
      if (!status.configured || !status.user) {
        setAvailable(false)
        return
      }
      setMyUserId(status.user.id)
      setAvailable(true)
      setGroups(await window.api.collabListGroups())
    } catch {
      setGroups([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { reload() }, [reload])

  const nameOf = useMemo(() => {
    const names = new Map<string, string>()
    for (const g of groups) for (const m of g.members) names.set(m.userId, m.displayName || m.riotId || 'Coach')
    return (userId: string) => names.get(userId) ?? 'Coach'
  }, [groups])

  // "Legacy" staff (owner/coach/analyst) — dev plans, staff dashboard, weekly
  // reports, trials, player management: none of this is calendar/session
  // scoped, so `manager` deliberately does NOT get it (see src/lib/permissions.ts).
  const staffGroups = groups.filter((g) => isLegacyStaff(g.myRole))

  return { available, loading, myUserId, groups, staffGroups, nameOf, reload }
}
