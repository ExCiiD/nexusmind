import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { SkipLink } from './SkipLink'

export function AppLayout() {
  return (
    <div className="ascend-texture-bg flex h-screen">
      <SkipLink />
      {/* Fixed drag region at the top of the main area (outside the scroll container) */}
      <div className="app-drag-region fixed top-0 right-0 h-9 z-50" style={{ left: '16rem' }} />
      <Sidebar />
      {/* The 36px top band stays put (it sits under the window controls and
          the drag region); only the content below it scrolls, so nothing
          slides underneath the minimize/maximize/close buttons. */}
      <main id="main" tabIndex={-1} className="flex min-w-0 flex-1 flex-col focus:outline-none">
        <div className="h-9 shrink-0" />
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-6 pb-4">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
