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
import { StatsAveragesPage } from '@/pages/DetailedStats/StatsAveragesPage'
import { SettingsPage } from '@/pages/Settings/SettingsPage'
import { StudentsPage } from '@/pages/Students/StudentsPage'
import { DevToolbar } from '@/components/Dev/DevToolbar'
import { UpdateBanner } from '@/components/UpdateBanner'
import { Toaster } from '@/components/ui/toaster'
import { CoachProvider } from '@/context/CoachContext'
import { useEffect } from 'react'

export function App() {
  const user = useUserStore((s) => s.user)
  const loadUser = useUserStore((s) => s.loadUser)

  useEffect(() => {
    loadUser()
  }, [loadUser])

  useEffect(() => {
    const unsubscribe = window.api.onGameEnd((data) => {
      useUserStore.getState().setGameEndData(data)
      window.location.hash = '#/review'
    })
    return unsubscribe
  }, [])

  return (
    <CoachProvider>
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
            <Route path="/review" element={<ReviewPage />} />
            <Route path="/analytics" element={<AnalyticsPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/stats" element={<StatsLandingPage />} />
            <Route path="/stats/averages" element={<StatsAveragesPage />} />
            <Route path="/stats/:matchId" element={<DetailedStatsPage />} />
            <Route path="/assessment" element={<ReassessmentPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/students" element={<StudentsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        )}
      </Routes>
      {user && <DevToolbar />}
      <UpdateBanner />
      <Toaster />
    </CoachProvider>
  )
}
