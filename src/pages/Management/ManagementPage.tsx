import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, LayoutDashboard, CalendarDays, HeartPulse, ListTodo, UserPlus, Users } from 'lucide-react'
import { PanelErrorBoundary } from '@/components/PanelErrorBoundary'
import { AssignedObjectivesCard } from '@/components/Coaching/AssignedObjectivesCard'
import { DevPlanCard } from '@/components/Coaching/DevPlanCard'
import { MyMicroVerdictsCard } from '@/components/MicroReview/CoachMicroReviews'
import { NotificationPrefsCard } from '@/components/Notifications/NotificationPrefsCard'
import { NoGroupNotice, SectionTabs, TeamSectionHeader, useTabParam, useTeamSection, type SectionTab } from '@/components/team/TeamSection'
import { isLegacyStaff } from '@/lib/permissions'
import { GroupsSection } from '@/pages/Coaching/GroupsSection'
import { StaffDashboardSection } from '@/pages/Coaching/StaffDashboardSection'
import { PlanningSection } from '@/pages/Coaching/PlanningSection'
import { WellbeingSection } from '@/pages/Coaching/WellbeingSection'
import { TeamOpsSection } from '@/pages/Coaching/TeamOpsSection'
import { TrialsSection } from '@/pages/Coaching/TrialsSection'

type TabId = 'overview' | 'planning' | 'wellbeing' | 'teamOps' | 'trials' | 'groups'

/**
 * Management: running the group day to day — the overview (assigned
 * objectives, verdicts, dev plan, staff dashboard), the planning (events,
 * presence, team sessions), wellbeing, tasks, trials, and the groups
 * themselves (create, join, roles). One group at a time, the one picked in
 * the section header (shared with Espace d'équipe, Coaching and Stats
 * collectives). Overview and Groups stay reachable without a group.
 */
export function ManagementPage() {
  const { t } = useTranslation()
  const section = useTeamSection()
  const { available, loading, myUserId, groups, group, nameOf, reload } = section

  const hasGroup = !!group
  const isStaff = !!group && isLegacyStaff(group.myRole, group.myStaffRoles)
  // The sections take a list of groups (a leftover of their own pickers):
  // they get the active group alone, and the `key` remounts them per group.
  const groupsHere = useMemo(() => (group ? [group] : []), [group])
  const staffHere = useMemo(() => (group && isStaff ? [group] : []), [group, isStaff])

  const tabs = useMemo(() => ([
    { id: 'overview' as const, label: t('coaching.tabs.overview'), icon: LayoutDashboard, show: true },
    { id: 'planning' as const, label: t('coaching.tabs.planning'), icon: CalendarDays, show: hasGroup },
    { id: 'wellbeing' as const, label: t('coaching.tabs.wellbeing'), icon: HeartPulse, show: hasGroup },
    { id: 'teamOps' as const, label: t('coaching.tabs.teamOps'), icon: ListTodo, show: hasGroup },
    { id: 'trials' as const, label: t('coaching.tabs.trials'), icon: UserPlus, show: isStaff },
    { id: 'groups' as const, label: t('coaching.tabs.groups'), icon: Users, show: true },
  ] satisfies Array<SectionTab<TabId> & { show: boolean }>).filter((x) => x.show), [t, hasGroup, isStaff])
  const [tab, setTab] = useTabParam(tabs.map((x) => x.id), 'overview')

  const k = group?.id ?? 'none'

  return (
    <div className="space-y-4 animate-fade-in">
      <TeamSectionHeader title={t('management.title')} subtitle={t('management.subtitle')} section={section} />
      {loading ? (
        <Loader2 className="h-6 w-6 animate-spin text-hextech-gold" />
      ) : !available || !myUserId ? (
        <p className="text-sm text-hextech-text-dim">{t('coaching.unavailable')}</p>
      ) : (
        <>
          <SectionTabs tabs={tabs} active={tab} onChange={setTab} />
          <div>
            {tab === 'overview' && (
              <PanelErrorBoundary key={`overview-${k}`} label="Overview">
                <div className="space-y-4">
                  {!hasGroup && <NoGroupNotice />}
                  <AssignedObjectivesCard />
                  <MyMicroVerdictsCard />
                  {group?.myRole === 'player' && <DevPlanCard key={`plan-${group.id}`} groupId={group.id} playerId={myUserId} mode="player" />}
                  <StaffDashboardSection key={`staff-${k}`} staffGroups={staffHere} />
                </div>
              </PanelErrorBoundary>
            )}
            {tab === 'planning' && (
              <PanelErrorBoundary key={`planning-${k}`} label="Planning">
                <PlanningSection groups={groupsHere} myUserId={myUserId} nameOf={nameOf} />
              </PanelErrorBoundary>
            )}
            {tab === 'wellbeing' && (
              <PanelErrorBoundary key={`wellbeing-${k}`} label="Wellbeing">
                <WellbeingSection groups={groupsHere} myUserId={myUserId} nameOf={nameOf} />
              </PanelErrorBoundary>
            )}
            {tab === 'teamOps' && (
              <PanelErrorBoundary key={`teamOps-${k}`} label="Tasks">
                <TeamOpsSection groups={groupsHere} myUserId={myUserId} nameOf={nameOf} />
              </PanelErrorBoundary>
            )}
            {tab === 'trials' && (
              <PanelErrorBoundary key={`trials-${k}`} label="Trials">
                <TrialsSection staffGroups={staffHere} />
              </PanelErrorBoundary>
            )}
            {tab === 'groups' && (
              <PanelErrorBoundary key="groups" label="Groups">
                <div className="space-y-4">
                  <GroupsSection groups={groups} active={group} myUserId={myUserId} reload={reload} />
                  <NotificationPrefsCard />
                </div>
              </PanelErrorBoundary>
            )}
          </div>
        </>
      )}
    </div>
  )
}
