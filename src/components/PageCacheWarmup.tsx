import { useEffect } from 'react'
import { useTeamSection } from '@/components/team/TeamSection'
import { isLegacyStaff } from '@/lib/permissions'
import { fetchInto, getEntry } from '@/lib/queryCache'
import { HISTORY_KEY, SNAPSHOTS_KEY, fetchHistory, fetchSnapshots } from '@/lib/pageQueries'
import { fetchStaffDashboard, staffDashboardKey } from '@/lib/staffQueries'

/** After the start, once the first screen had its turn. */
const WARMUP_DELAY_MS = 5_000

/**
 * Start-up warm-up (20/11/2026, "loads that feel almost instant"): the History, the Stats snapshots and, for staff,
 * the staff dashboard are loaded in the background shortly after the start, so their first opening shows at once
 * instead of waiting. A key a page already loaded is left alone. Renders nothing.
 */
export function PageCacheWarmup() {
  // The group Management shows (the one picked in the section's header), when I am staff there.
  const { group } = useTeamSection()
  const staffGroupId = group && isLegacyStaff(group.myRole, group.myStaffRoles) ? group.id : null

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!getEntry(HISTORY_KEY)) fetchInto(HISTORY_KEY, fetchHistory).catch(() => {})
      if (!getEntry(SNAPSHOTS_KEY)) fetchInto(SNAPSHOTS_KEY, fetchSnapshots).catch(() => {})
    }, WARMUP_DELAY_MS)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (!staffGroupId) return
    const key = staffDashboardKey(staffGroupId)
    const timer = setTimeout(() => {
      if (!getEntry(key)) fetchInto(key, () => fetchStaffDashboard(staffGroupId)).catch(() => {})
    }, WARMUP_DELAY_MS)
    return () => clearTimeout(timer)
  }, [staffGroupId])

  return null
}
