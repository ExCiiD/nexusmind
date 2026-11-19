import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import '@/i18n/config'
import '@/index.css'
import { installWebApi } from './api'
import { CloudGate } from '@/components/Cloud/CloudGate'
import { Toaster } from '@/components/ui/toaster'
import { CoachingPage } from '@/pages/Coaching/CoachingPage'
import { ManagementPage } from '@/pages/Management/ManagementPage'
import { TeamSessionPage } from '@/pages/TeamSession/TeamSessionPage'
import { WebLayout } from './WebLayout'
import { HomePage } from './pages/HomePage'
import { MyReviewsPage } from './pages/MyReviewsPage'
import { ScrimsPage } from './pages/ScrimsPage'
import { TeamPage } from './pages/TeamPage'
import { AccountPage } from './pages/AccountPage'
import { DownloadButton } from './DownloadButton'
import { installDiagnostics } from '@/lib/diagnostics'
import { applyTheme, getStoredTheme } from '@/lib/theme'
import { applyAppearance, getStoredAppearance, loadCustomBackground } from '@/lib/appearance'

// Must run before any shared component calls window.api.
installWebApi()
// Last client errors, attached to bug reports only if the user agrees.
installDiagnostics()
// Before the first paint, so there's no flash of the default theme.
applyTheme(getStoredTheme())
applyAppearance(getStoredAppearance(), false)
// The user's own background lives in IndexedDB (async); shows once loaded.
void loadCustomBackground()

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* offline shell is optional */ })
  })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <CloudGate loginFooter={<DownloadButton className="w-full" />}>
        <Routes>
          <Route element={<WebLayout />}>
            <Route path="/" element={<HomePage />} />
            <Route path="/reviews" element={<MyReviewsPage />} />
            <Route path="/scrims" element={<ScrimsPage />} />
            <Route path="/management" element={<ManagementPage />} />
            <Route path="/coaching" element={<CoachingPage />} />
            <Route path="/team-session/:calendarEventId" element={<TeamSessionPage />} />
            <Route path="/team" element={<TeamPage />} />
            <Route path="/account" element={<AccountPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </CloudGate>
      <Toaster />
    </BrowserRouter>
  </React.StrictMode>,
)
