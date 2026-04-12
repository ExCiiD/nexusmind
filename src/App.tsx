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
import { DevToolbar } from '@/components/Dev/DevToolbar'
import { UpdateBanner } from '@/components/UpdateBanner'
import { Toaster } from '@/components/ui/toaster'
import { ToastAction } from '@/components/ui/toast'
import { useEffect } from 'react'
import { useToast } from '@/hooks/useToast'

export function App() {
  const user = useUserStore((s) => s.user)
  const loadUser = useUserStore((s) => s.loadUser)
  const { toast } = useToast()

  useEffect(() => {
    loadUser()
  }, [loadUser])

  useEffect(() => {
    const unsubscribe = window.api.onGameEnd((data) => {
      useUserStore.getState().setGameEndData(data)

      // Only open the review page when a game row was created AND the queue is session-eligible
      // (ranked SoloQ/Flex). Non-eligible queues (ARAM, Arena, Custom…) are recorded but do
      // not trigger an auto-review navigation.
      if (data?.game?.id && data?.isSessionEligible !== false) {
        window.location.hash = '#/review'
      }

      // Off-role warning: game was auto-added to the session but the played role
      // doesn't match the configured main role. Offer immediate removal.
      if (data?.isOffRole && data?.game?.id) {
        const gameId = data.game.id as string
        const playedRole = (data.stats?.role as string | undefined) ?? 'inconnu'
        toast({
          title: '⚠️ Rôle secondaire détecté',
          description: `Tu as joué ${playedRole} — pas ton main role. Retirer cette game de la session ?`,
          variant: 'destructive',
          duration: 12000,
          action: (
            <ToastAction
              altText="Retirer de la session"
              onClick={async () => {
                await window.api.deleteGame(gameId)
                // Clear the review nav since the game was removed
                useUserStore.getState().setGameEndData(null)
                window.location.hash = '#/session'
              }}
            >
              Retirer
            </ToastAction>
          ),
        })
      }
    })
    return unsubscribe
  }, [toast])

  useEffect(() => {
    const offStarted = window.api.onRecordingStarted(() => {
      toast({ title: '● Recording started', description: 'Your game is being recorded.', variant: 'default' })
    })
    const offStopped = window.api.onRecordingStopped(() => {
      toast({ title: 'Recording saved', description: 'Recording stopped and will be linked to your game.', variant: 'default' })
    })
    return () => {
      offStarted()
      offStopped()
    }
  }, [])

  return (
    <>
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
            <Route path="/external-review/:id" element={<ExternalReviewPage />} />
            <Route path="/analytics" element={<AnalyticsPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/stats" element={<StatsLandingPage />} />
            <Route path="/stats/averages" element={<Navigate to="/stats" replace />} />
            <Route path="/stats/:matchId" element={<DetailedStatsPage />} />
            <Route path="/assessment" element={<ReassessmentPage />} />
            <Route path="/settings" element={<SettingsPage />} />
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
