import { Routes, Route, Navigate } from 'react-router-dom'
import { useUserStore } from '@/store/useUserStore'
import { AppLayout } from '@/components/Layout/AppLayout'
import { OnboardingPage } from '@/pages/Onboarding/OnboardingPage'
import { DashboardPage } from '@/pages/Dashboard/DashboardPage'
import { SessionPage } from '@/pages/Session/SessionPage'
import { ReviewPage } from '@/pages/Review/ReviewPage'
import { AnalyticsPage } from '@/pages/Analytics/AnalyticsPage'
import { ReassessmentPage } from '@/pages/Assessment/ReassessmentPage'
import { HistoryPage } from '@/pages/History/HistoryPage'
import { DetailedStatsPage } from '@/pages/DetailedStats/DetailedStatsPage'
import { StatsLandingPage } from '@/pages/DetailedStats/StatsLandingPage'
import { SettingsPage } from '@/pages/Settings/SettingsPage'
import { RecordPage } from '@/pages/Record/RecordPage'
import { RecordPlayerPage } from '@/pages/Record/RecordPlayerPage'
import { ExternalReviewPage } from '@/pages/Review/ExternalReviewPage'
import { ExternalReviewNewPage } from '@/pages/Review/ExternalReviewNewPage'
import { PostGameCapturePage } from '@/pages/Review/PostGameCapturePage'
import { HelpPage } from '@/pages/Help/HelpPage'
import { GameEndNav } from '@/components/GameEndNav'
import { DevToolbar } from '@/components/Dev/DevToolbar'
import { UpdateBanner } from '@/components/UpdateBanner'
import { Toaster } from '@/components/ui/toaster'
import { useEffect } from 'react'

export function App() {
  const user = useUserStore((s) => s.user)
  const loadUser = useUserStore((s) => s.loadUser)

  useEffect(() => {
    loadUser()
  }, [loadUser])

  return (
    <>
      <GameEndNav />
      <Routes>
        {!user ? (
          <>
            <Route path="/onboarding/*" element={<OnboardingPage />} />
            <Route path="*" element={<Navigate to="/onboarding" replace />} />
          </>
        ) : (
          <Route element={<AppLayout />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/session" element={<SessionPage />} />
            <Route path="/replays" element={<Navigate to="/record" replace />} />
            <Route path="/record" element={<RecordPage />} />
            <Route path="/record/:recordingId" element={<RecordPlayerPage />} />
            <Route path="/review" element={<ReviewPage />} />
            <Route path="/post-game-capture" element={<PostGameCapturePage />} />
            <Route path="/external-review/new" element={<ExternalReviewNewPage />} />
            <Route path="/external-review/:id" element={<ExternalReviewPage />} />
            <Route path="/analytics" element={<AnalyticsPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/stats" element={<StatsLandingPage />} />
            <Route path="/stats/averages" element={<Navigate to="/stats" replace />} />
            <Route path="/stats/:matchId" element={<DetailedStatsPage />} />
            <Route path="/assessment" element={<ReassessmentPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/help" element={<HelpPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        )}
      </Routes>
      {user && <DevToolbar />}
      <UpdateBanner />
      <Toaster />
    </>
  )
}
