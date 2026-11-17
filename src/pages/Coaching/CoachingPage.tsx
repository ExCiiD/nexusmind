import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Loader2, LayoutDashboard, CalendarDays, Film, HeartPulse, ListTodo,
  FileBarChart, UserPlus, GraduationCap, Users, Shield,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCollab } from '@/hooks/useCollab'
import { PanelErrorBoundary } from '@/components/PanelErrorBoundary'
import { AssignedObjectivesCard } from '@/components/Coaching/AssignedObjectivesCard'
import { GroupsSection } from './GroupsSection'
import { PlayersSection } from './PlayersSection'
import { TeamWorkspaceSection } from './TeamWorkspaceSection'
import { StaffDashboardSection } from './StaffDashboardSection'
import { DevPlanCard } from '@/components/Coaching/DevPlanCard'
import { PlanningSection } from './PlanningSection'
import { VodReviewSection } from './VodReviewSection'
import { MyMicroVerdictsCard, TeamCodexCard } from '@/components/MicroReview/CoachMicroReviews'
import { WellbeingSection } from './WellbeingSection'
import { TeamOpsSection } from './TeamOpsSection'
import { NotificationPrefsCard } from '@/components/Notifications/NotificationPrefsCard'
import { WeeklyReportSection } from './WeeklyReportSection'
import { TrialsSection } from './TrialsSection'

type TabId = 'overview' | 'planning' | 'vod' | 'wellbeing' | 'teamOps' | 'reports' | 'trials' | 'players' | 'workspace' | 'groups'

/**
 * Teams & coaching (E13, docs/PLAN_GESTION_EQUIPE.md): groups, invitations,
 * sharing, coach view of players.
 *
 * Previously a single flat stack of every section piled on top of each
 * other (E2-E10 each added one more card at the bottom). Reworked into a
 * dashboard-first tab layout — Overview is the per-player alert table a
 * coach actually opens the page for, every other section is one click
 * away in a tab instead of several screens of scrolling. Tabs whose
 * section would render nothing for the user's current role/group mix are
 * hidden rather than shown empty.
 */
export function CoachingPage() {
  const { t } = useTranslation()
  const { available, loading, myUserId, groups, staffGroups, nameOf, reload } = useCollab()
  const [tab, setTab] = useState<TabId>('overview')

  const hasGroups = groups.length > 0
  const isStaff = staffGroups.length > 0
  const myPlayerGroups = useMemo(() => groups.filter((g) => g.myRole === 'player'), [groups])

  const tabs = useMemo(() => ([
    { id: 'overview' as const, label: t('coaching.tabs.overview', { defaultValue: 'Overview' }), icon: LayoutDashboard, show: true },
    { id: 'planning' as const, label: t('coaching.tabs.planning', { defaultValue: 'Planning' }), icon: CalendarDays, show: hasGroups },
    { id: 'vod' as const, label: t('coaching.tabs.vod', { defaultValue: 'VOD review' }), icon: Film, show: hasGroups },
    { id: 'wellbeing' as const, label: t('coaching.tabs.wellbeing', { defaultValue: 'Wellbeing' }), icon: HeartPulse, show: hasGroups },
    { id: 'teamOps' as const, label: t('coaching.tabs.teamOps', { defaultValue: 'Tasks' }), icon: ListTodo, show: hasGroups },
    { id: 'reports' as const, label: t('coaching.tabs.reports', { defaultValue: 'Weekly report' }), icon: FileBarChart, show: isStaff },
    { id: 'trials' as const, label: t('coaching.tabs.trials', { defaultValue: 'Trials' }), icon: UserPlus, show: isStaff },
    { id: 'players' as const, label: t('coaching.tabs.players', { defaultValue: 'Players' }), icon: GraduationCap, show: isStaff },
    { id: 'workspace' as const, label: t('coaching.tabs.workspace', { defaultValue: 'Team workspace' }), icon: Shield, show: isStaff },
    { id: 'groups' as const, label: t('coaching.tabs.groups', { defaultValue: 'Groups' }), icon: Users, show: true },
  ]), [t, hasGroups, isStaff]).filter((x) => x.show)

  // If the active tab's section stops being relevant (e.g. the user just
  // left their last staff group), fall back to Overview instead of showing
  // a dead tab with no corresponding button.
  useEffect(() => {
    if (!loading && !tabs.some((x) => x.id === tab)) setTab('overview')
  }, [loading, tabs, tab])

  return (
    <div className="space-y-4 animate-fade-in">
      <div>
        <h1 className="font-display text-2xl font-bold text-hextech-gold-bright">{t('coaching.title')}</h1>
        <p className="mt-1 text-sm text-hextech-text">{t('coaching.subtitle')}</p>
      </div>
      {loading ? (
        <Loader2 className="h-6 w-6 animate-spin text-hextech-gold" />
      ) : !available || !myUserId ? (
        <p className="text-sm text-hextech-text-dim">{t('coaching.unavailable')}</p>
      ) : (
        <>
          {/* Tabs — same visual pattern as the Team page's tab bar, for
              consistency across the app. */}
          <div className="flex border-b border-hextech-border-dim overflow-x-auto">
            {tabs.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={cn(
                  'flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
                  tab === id
                    ? 'border-hextech-gold text-hextech-gold-bright'
                    : 'border-transparent text-hextech-text-dim hover:text-hextech-text',
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </div>

          {/* Tab content — each wrapped in its own error boundary so a
              crash in one section never black-screens the whole page. */}
          <div>
            {tab === 'overview' && (
              <PanelErrorBoundary key="overview" label="Overview">
                <div className="space-y-4">
                  <AssignedObjectivesCard />
                  <MyMicroVerdictsCard />
                  {myPlayerGroups.map((g) => (
                    <DevPlanCard key={g.id} groupId={g.id} playerId={myUserId} mode="player" />
                  ))}
                  <StaffDashboardSection staffGroups={staffGroups} />
                  {!hasGroups && (
                    <p className="text-sm text-hextech-text-dim">
                      {t('coaching.overview.noGroups', { defaultValue: 'No groups yet — create or join one in the Groups tab to get started.' })}
                    </p>
                  )}
                </div>
              </PanelErrorBoundary>
            )}
            {tab === 'planning' && (
              <PanelErrorBoundary key="planning" label="Planning">
                <PlanningSection groups={groups} myUserId={myUserId} nameOf={nameOf} />
              </PanelErrorBoundary>
            )}
            {tab === 'vod' && (
              <PanelErrorBoundary key="vod" label="VOD review">
                <div className="space-y-4">
                  <VodReviewSection groups={groups} myUserId={myUserId} nameOf={nameOf} />
                  <TeamCodexCard staffGroups={staffGroups} />
                </div>
              </PanelErrorBoundary>
            )}
            {tab === 'wellbeing' && (
              <PanelErrorBoundary key="wellbeing" label="Wellbeing">
                <WellbeingSection groups={groups} myUserId={myUserId} nameOf={nameOf} />
              </PanelErrorBoundary>
            )}
            {tab === 'teamOps' && (
              <PanelErrorBoundary key="teamOps" label="Tasks">
                <TeamOpsSection groups={groups} myUserId={myUserId} nameOf={nameOf} />
              </PanelErrorBoundary>
            )}
            {tab === 'reports' && (
              <PanelErrorBoundary key="reports" label="Weekly report">
                <WeeklyReportSection staffGroups={staffGroups} />
              </PanelErrorBoundary>
            )}
            {tab === 'trials' && (
              <PanelErrorBoundary key="trials" label="Trials">
                <TrialsSection staffGroups={staffGroups} />
              </PanelErrorBoundary>
            )}
            {tab === 'players' && (
              <PanelErrorBoundary key="players" label="Players">
                <PlayersSection staffGroups={staffGroups} myUserId={myUserId} nameOf={nameOf} />
              </PanelErrorBoundary>
            )}
            {tab === 'workspace' && (
              <PanelErrorBoundary key="workspace" label="Team workspace">
                <TeamWorkspaceSection staffGroups={staffGroups} />
              </PanelErrorBoundary>
            )}
            {tab === 'groups' && (
              <PanelErrorBoundary key="groups" label="Groups">
                <div className="space-y-4">
                  <GroupsSection groups={groups} myUserId={myUserId} reload={reload} />
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
