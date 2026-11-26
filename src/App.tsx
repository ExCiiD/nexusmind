import { Routes, Route, Navigate } from 'react-router-dom'
import { useUserStore } from '@/store/useUserStore'
import { AppLayout } from '@/components/Layout/AppLayout'
import { OnboardingPage } from '@/pages/Onboarding/OnboardingPage'
import { DashboardPage } from '@/pages/Dashboard/DashboardPage'
import { SessionPage } from '@/pages/Session/SessionPage'
import { ReviewPage } from '@/pages/Review/ReviewPage'
import { PanelErrorBoundary } from '@/components/PanelErrorBoundary'
import { GameEndNav } from '@/components/GameEndNav'
import { PageCacheWarmup } from '@/components/PageCacheWarmup'
import { RealtimeCacheBridge } from '@/components/RealtimeCacheBridge'
import { DevToolbar } from '@/components/Dev/DevToolbar'
import { UpdateBanner } from '@/components/UpdateBanner'
import { Toaster } from '@/components/ui/toaster'
import { BackgroundJobsIndicator } from '@/components/BackgroundJobsIndicator'
import { AnnouncementBubbleStack } from '@/components/Announcements/AnnouncementBubbleStack'
import { SessionCheckinToast } from '@/components/TeamSession/SessionCheckinToast'
import { TeamSessionBanner } from '@/components/TeamSession/TeamSessionBanner'
import { EndOfGamePrompt } from '@/components/TeamSession/EndOfGamePrompt'
import { Suspense, lazy, useEffect, useRef } from 'react'
import { startCollab, useCollab } from '@/hooks/useCollab'
import { dropCachedData, scopeChanged } from '@/lib/queryCache'

// UI-09 (26/11/2026): the routes outside the start-up path load on first visit (Dashboard, Session, Review and
// Onboarding stay in the main bundle). recharts and the big pages leave the start-up parse.
const ProfilePage = lazy(() => import('@/pages/Profile/ProfilePage').then((m) => ({ default: m.ProfilePage })))
const MyPlanPage = lazy(() => import('@/pages/Plan/MyPlanPage').then((m) => ({ default: m.MyPlanPage })))
const AnalyticsPage = lazy(() => import('@/pages/Analytics/AnalyticsPage').then((m) => ({ default: m.AnalyticsPage })))
const ReassessmentPage = lazy(() => import('@/pages/Assessment/ReassessmentPage').then((m) => ({ default: m.ReassessmentPage })))
const HistoryPage = lazy(() => import('@/pages/History/HistoryPage').then((m) => ({ default: m.HistoryPage })))
const DetailedStatsPage = lazy(() => import('@/pages/DetailedStats/DetailedStatsPage').then((m) => ({ default: m.DetailedStatsPage })))
const LanePhasePage = lazy(() => import('@/pages/Stats/LanePhasePage').then((m) => ({ default: m.LanePhasePage })))
const MistakeStatsPage = lazy(() => import('@/pages/Stats/MistakeStatsPage').then((m) => ({ default: m.MistakeStatsPage })))
const SettingsPage = lazy(() => import('@/pages/Settings/SettingsPage').then((m) => ({ default: m.SettingsPage })))
const RecordPage = lazy(() => import('@/pages/Record/RecordPage').then((m) => ({ default: m.RecordPage })))
const RecordPlayerPage = lazy(() => import('@/pages/Record/RecordPlayerPage').then((m) => ({ default: m.RecordPlayerPage })))
const ExternalReviewPage = lazy(() => import('@/pages/Review/ExternalReviewPage').then((m) => ({ default: m.ExternalReviewPage })))
const HelpPage = lazy(() => import('@/pages/Help/HelpPage').then((m) => ({ default: m.HelpPage })))
const TeamPage = lazy(() => import('@/pages/Team/TeamPage').then((m) => ({ default: m.TeamPage })))
const CoachingPage = lazy(() => import('@/pages/Coaching/CoachingPage').then((m) => ({ default: m.CoachingPage })))
const ManagementPage = lazy(() => import('@/pages/Management/ManagementPage').then((m) => ({ default: m.ManagementPage })))
const TeamSpacePage = lazy(() => import('@/pages/TeamSpace/TeamSpacePage').then((m) => ({ default: m.TeamSpacePage })))
const TeamSessionPage = lazy(() => import('@/pages/TeamSession/TeamSessionPage').then((m) => ({ default: m.TeamSessionPage })))
const TeamSessionsPage = lazy(() => import('@/pages/TeamSessions/TeamSessionsPage').then((m) => ({ default: m.TeamSessionsPage })))
const SoloSessionSheetPage = lazy(() => import('@/pages/History/SoloSessionSheetPage').then((m) => ({ default: m.SoloSessionSheetPage })))
const PlayerSheetPage = lazy(() => import('@/pages/TeamSessions/PlayerSheetPage').then((m) => ({ default: m.PlayerSheetPage })))
const TeamSessionByIdPage = lazy(() => import('@/pages/TeamSessions/TeamSessionByIdPage').then((m) => ({ default: m.TeamSessionByIdPage })))

export function App() {
  const user = useUserStore((s) => s.user)
  const userLoading = useUserStore((s) => s.loading)
  const loadUser = useUserStore((s) => s.loadUser)

  useEffect(() => {
    loadUser()
  }, [loadUser])

  // Perf gain 4: the cloud status and my groups are loaded at start, before Management / Lobby / Coaching ask.
  useEffect(() => { startCollab() }, [])

  // Perf gain 3: never another profile's or account's data. The cached pages are emptied when the local profile or
  // the cloud account changes (not on their first value).
  const localId = user?.id ?? null
  const { myUserId: cloudId } = useCollab()
  const scope = useRef<{ local: string | null; cloud: string | null }>({ local: null, cloud: null })
  useEffect(() => {
    const prev = scope.current
    if (scopeChanged(prev.local, localId) || scopeChanged(prev.cloud, cloudId)) dropCachedData()
    scope.current = { local: localId, cloud: cloudId }
  }, [localId, cloudId])

  return (
    <>
      <GameEndNav />
      {/* Route only once the stored user is known: routing on the initial
          `null` sent every launch through /onboarding for a moment. */}
      {!userLoading && (
      <Suspense fallback={null}>
      <Routes>
        {!user ? (
          <>
            <Route path="/onboarding/*" element={<OnboardingPage />} />
            <Route path="*" element={<Navigate to="/onboarding" replace />} />
          </>
        ) : (
          <Route element={<AppLayout />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/plan" element={<MyPlanPage />} />
            <Route path="/session" element={<SessionPage />} />
            <Route path="/record" element={<RecordPage />} />
            <Route path="/record/:recordingId" element={<RecordPlayerPage />} />
            <Route path="/review" element={<ReviewPage />} />
            <Route path="/external-review/:id" element={<ExternalReviewPage />} />
            <Route path="/analytics" element={<Navigate to="/stats?tab=progress" replace />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/history/session/:sessionId/stats" element={<PanelErrorBoundary label="Solo player sheet"><SoloSessionSheetPage /></PanelErrorBoundary>} />
            <Route path="/stats" element={<AnalyticsPage />} />
            <Route path="/stats/:matchId" element={<DetailedStatsPage />} />
            <Route path="/lane-phase/:gameId" element={<LanePhasePage />} />
            <Route path="/stats/mistakes" element={<MistakeStatsPage />} />
            <Route path="/assessment" element={<ReassessmentPage />} />
            <Route path="/team" element={<PanelErrorBoundary label="Team page"><TeamPage /></PanelErrorBoundary>} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/management" element={<PanelErrorBoundary label="Management page"><ManagementPage /></PanelErrorBoundary>} />
            <Route path="/team-space" element={<PanelErrorBoundary label="Team Lobby page"><TeamSpacePage /></PanelErrorBoundary>} />
            <Route path="/coaching" element={<PanelErrorBoundary label="Coaching page"><CoachingPage /></PanelErrorBoundary>} />
            <Route path="/team-sessions" element={<PanelErrorBoundary label="Team sessions"><TeamSessionsPage /></PanelErrorBoundary>} />
            <Route path="/team-sessions/:sessionId" element={<PanelErrorBoundary label="Team session"><TeamSessionByIdPage /></PanelErrorBoundary>} />
            <Route path="/team-session/:calendarEventId/player/:userId" element={<PanelErrorBoundary label="Player sheet"><PlayerSheetPage /></PanelErrorBoundary>} />
            <Route path="/team-session/:calendarEventId" element={<PanelErrorBoundary label="Team session"><TeamSessionPage /></PanelErrorBoundary>} />
            <Route path="/help" element={<HelpPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        )}
      </Routes>
      </Suspense>
      )}
      {/* Dev builds only: the `dev:*` handlers it calls exist only unpackaged. */}
      {import.meta.env.DEV && user && <DevToolbar />}
      <UpdateBanner />
      {/* Persistent indicator for long-running team scouts / auto-fills.
          Rendered above the toaster so its pills don't get covered by
          stacked toasts. Hidden when no jobs are active. */}
      {user && <BackgroundJobsIndicator />}
      {user && <PageCacheWarmup />}
      {user && <RealtimeCacheBridge />}
      {user && <AnnouncementBubbleStack />}
      {user && <TeamSessionBanner />}
      {user && <EndOfGamePrompt />}
      {user && <SessionCheckinToast />}
      <Toaster />
    </>
  )
}
