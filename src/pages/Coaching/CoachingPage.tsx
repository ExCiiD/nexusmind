import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Loader2, LayoutDashboard, CalendarDays, Film, HeartPulse, ListTodo,
  FileBarChart, UserPlus, GraduationCap, Users, Shield, ListTree, Swords, Target,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCollab } from '@/hooks/useCollab'
import { PanelErrorBoundary } from '@/components/PanelErrorBoundary'
import { AssignedObjectivesCard } from '@/components/Coaching/AssignedObjectivesCard'
import { GroupSwitcher } from '@/components/Coaching/GroupSwitcher'
import { GroupTeamGate } from '@/components/team/GroupTeamGate'
import { isLegacyStaff } from '@/lib/permissions'
import { resolveActiveGroup, useActiveGroupStore } from '@/store/useActiveGroupStore'
import { GroupsSection } from './GroupsSection'
import { PlayersSection } from './PlayersSection'
import { TeamSpaceSection } from './TeamSpaceSection'
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
import { ChampPoolTab } from '@/pages/Team/ChampPoolTab'
import { DraftTab } from '@/pages/Team/DraftTab'
import { ScoutingTab } from '@/pages/Team/ScoutingTab'

type TabId =
  | 'overview' | 'planning' | 'workspace' | 'pool' | 'draft' | 'scouting'
  | 'players' | 'vod' | 'wellbeing' | 'teamOps' | 'reports' | 'trials' | 'groups'

/**
 * Coaching & Management (E13, docs/PLAN_GESTION_EQUIPE.md): one group at a
 * time, picked in the header (GroupSwitcher, shared with Stats collectives),
 * for every tab. The team side of the group lives here too since 18 November
 * 2026 — Espace d'équipe (its roster), Champion Pool, Draft Sim, Scouting —
 * on the local team linked to the group (GroupTeamGate). Tabs whose section
 * would render nothing for the user's role in that group are hidden.
 */
export function CoachingPage() {
  const { t } = useTranslation()
  const { available, loading, myUserId, groups, nameOf, reload } = useCollab()
  const storedGroupId = useActiveGroupStore((s) => s.groupId)
  const group = resolveActiveGroup(groups, storedGroupId)
  const [tab, setTab] = useState<TabId>('overview')

  const hasGroup = !!group
  const isStaff = !!group && isLegacyStaff(group.myRole)
  // Every section below gets the active group alone: their own pickers
  // (shown only for several groups) disappear, and the `key` resets their
  // state when the header switches groups.
  const groupsHere = useMemo(() => (group ? [group] : []), [group])
  const staffHere = useMemo(() => (group && isStaff ? [group] : []), [group, isStaff])

  const tabs = useMemo(() => ([
    { id: 'overview' as const, label: t('coaching.tabs.overview', { defaultValue: 'Overview' }), icon: LayoutDashboard, show: true },
    { id: 'planning' as const, label: t('coaching.tabs.planning', { defaultValue: 'Planning' }), icon: CalendarDays, show: hasGroup },
    { id: 'workspace' as const, label: t('coaching.tabs.workspace', { defaultValue: 'Team workspace' }), icon: Shield, show: hasGroup },
    { id: 'pool' as const, label: t('team.tabs.pool', { defaultValue: 'Champion Pool' }), icon: ListTree, show: hasGroup },
    { id: 'draft' as const, label: t('team.tabs.draft', { defaultValue: 'Draft Sim' }), icon: Swords, show: hasGroup },
    { id: 'scouting' as const, label: t('team.tabs.scouting', { defaultValue: 'Scouting' }), icon: Target, show: hasGroup },
    { id: 'players' as const, label: t('coaching.tabs.players', { defaultValue: 'Players' }), icon: GraduationCap, show: isStaff },
    { id: 'vod' as const, label: t('coaching.tabs.vod', { defaultValue: 'VOD review' }), icon: Film, show: hasGroup },
    { id: 'wellbeing' as const, label: t('coaching.tabs.wellbeing', { defaultValue: 'Wellbeing' }), icon: HeartPulse, show: hasGroup },
    { id: 'teamOps' as const, label: t('coaching.tabs.teamOps', { defaultValue: 'Tasks' }), icon: ListTodo, show: hasGroup },
    { id: 'reports' as const, label: t('coaching.tabs.reports', { defaultValue: 'Weekly report' }), icon: FileBarChart, show: isStaff },
    { id: 'trials' as const, label: t('coaching.tabs.trials', { defaultValue: 'Trials' }), icon: UserPlus, show: isStaff },
    { id: 'groups' as const, label: t('coaching.tabs.groups', { defaultValue: 'Groups' }), icon: Users, show: true },
  ]).filter((x) => x.show), [t, hasGroup, isStaff])

  // If the active tab's section stops being relevant (another group where
  // the user isn't staff, or they left their last group), fall back to
  // Overview instead of showing a dead tab with no corresponding button.
  useEffect(() => {
    if (!loading && !tabs.some((x) => x.id === tab)) setTab('overview')
  }, [loading, tabs, tab])

  const k = group?.id ?? 'none'

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-hextech-gold-bright">{t('coaching.title')}</h1>
          <p className="mt-1 text-sm text-hextech-text">{t('coaching.subtitle')}</p>
        </div>
        {available && groups.length > 0 && <GroupSwitcher groups={groups} active={group} />}
      </div>
      {loading ? (
        <Loader2 className="h-6 w-6 animate-spin text-hextech-gold" />
      ) : !available || !myUserId ? (
        <p className="text-sm text-hextech-text-dim">{t('coaching.unavailable')}</p>
      ) : (
        <>
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
              <PanelErrorBoundary key={`overview-${k}`} label="Overview">
                <div className="space-y-4">
                  <AssignedObjectivesCard />
                  <MyMicroVerdictsCard />
                  {group?.myRole === 'player' && <DevPlanCard key={group.id} groupId={group.id} playerId={myUserId} mode="player" />}
                  <StaffDashboardSection key={k} staffGroups={staffHere} />
                  {!hasGroup && (
                    <p className="text-sm text-hextech-text-dim">
                      {t('coaching.overview.noGroups', { defaultValue: 'No groups yet — create or join one in the Groups tab to get started.' })}
                    </p>
                  )}
                </div>
              </PanelErrorBoundary>
            )}
            {tab === 'planning' && (
              <PanelErrorBoundary key={`planning-${k}`} label="Planning">
                <PlanningSection groups={groupsHere} myUserId={myUserId} nameOf={nameOf} />
              </PanelErrorBoundary>
            )}
            {tab === 'workspace' && group && (
              <PanelErrorBoundary key={`workspace-${k}`} label="Team workspace">
                <TeamSpaceSection group={group} />
              </PanelErrorBoundary>
            )}
            {tab === 'pool' && group && (
              <PanelErrorBoundary key={`pool-${k}`} label="Champion pool">
                <GroupTeamGate group={group}>{(team, reloadTeam) => <ChampPoolTab team={team} onChange={reloadTeam} />}</GroupTeamGate>
              </PanelErrorBoundary>
            )}
            {tab === 'draft' && group && (
              <PanelErrorBoundary key={`draft-${k}`} label="Draft sim">
                <GroupTeamGate group={group}>{(team) => <DraftTab myTeam={team} />}</GroupTeamGate>
              </PanelErrorBoundary>
            )}
            {tab === 'scouting' && (
              <PanelErrorBoundary key="scouting" label="Scouting">
                <ScoutingTab />
              </PanelErrorBoundary>
            )}
            {tab === 'players' && (
              <PanelErrorBoundary key={`players-${k}`} label="Players">
                <PlayersSection staffGroups={staffHere} myUserId={myUserId} nameOf={nameOf} />
              </PanelErrorBoundary>
            )}
            {tab === 'vod' && (
              <PanelErrorBoundary key={`vod-${k}`} label="VOD review">
                <div className="space-y-4">
                  <VodReviewSection groups={groupsHere} myUserId={myUserId} nameOf={nameOf} />
                  <TeamCodexCard staffGroups={staffHere} />
                </div>
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
            {tab === 'reports' && (
              <PanelErrorBoundary key={`reports-${k}`} label="Weekly report">
                <WeeklyReportSection staffGroups={staffHere} />
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
