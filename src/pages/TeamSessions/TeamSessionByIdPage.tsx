import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useCollab } from '@/hooks/useCollab'
import { useTeamSection } from '@/components/team/TeamSection'
import { canManageSession } from '@/lib/permissions'
import { useLocalizedFundamentals } from '@/lib/constants/useFundamentals'
import { getAllFundamentalsForGroup } from '@/lib/fundamentals'
import type { GroupFundamental } from '@/lib/teamSessions'
import { TeamSessionHistoryView } from './TeamSessionHistoryView'

/**
 * A finished session opened by its id (/team-sessions/:sessionId) — for a session whose Planning slot was deleted
 * after it started (eventDeleted: no calendar event left to open /team-session/:calendarEventId with). The history
 * view, with the group picked in the section (its staff rights and fundamentals).
 */
export function TeamSessionByIdPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const { myUserId, nameOf, loading } = useCollab()
  const { group } = useTeamSection()
  const [fundamentals, setFundamentals] = useState<GroupFundamental[]>([])
  const baseCategories = useLocalizedFundamentals()
  const all = useMemo(() => getAllFundamentalsForGroup(fundamentals, baseCategories), [fundamentals, baseCategories])

  useEffect(() => {
    if (!group) return
    window.api.groupFundamentalsList(group.id).then(setFundamentals).catch(() => setFundamentals([]))
  }, [group])

  if (loading || !sessionId) return <Loader2 className="h-6 w-6 animate-spin text-hextech-gold" />
  const me = group?.members.find((m) => m.userId === myUserId)
  const canManage = !!group && canManageSession(group.myRole, me?.isCaptain ?? false, group.myStaffRoles)
  return (
    <div className="w-full py-4">
      <TeamSessionHistoryView
        sessionId={sessionId}
        calendarEventId={null}
        canManage={canManage}
        nameOf={nameOf}
        objectiveLabel={(id) => all.find((f) => f.id === id)?.label ?? id}
      />
    </div>
  )
}
