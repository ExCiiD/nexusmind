import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { App } from './App'
import './i18n/config'
import './index.css'

// Global crash diagnostics — without these, render exceptions that
// somehow escape every error boundary in the tree just produce a black
// screen with no console output. Routing them through console.error
// makes them visible in DevTools so the next bug report has actionable
// info instead of "écran noir".
window.addEventListener('error', (event) => {
  console.error('[window.error]', event.error ?? event.message, 'at', event.filename, event.lineno + ':' + event.colno)
})
window.addEventListener('unhandledrejection', (event) => {
  console.error('[unhandledrejection]', event.reason)
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>
)
