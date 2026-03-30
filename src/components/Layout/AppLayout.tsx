import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'

export function AppLayout() {
  return (
    <div className="flex h-screen bg-hextech-black">
      {/* Fixed drag region at the top of the main area (outside the scroll container) */}
      <div className="app-drag-region fixed top-0 right-0 h-9 z-50" style={{ left: '16rem' }} />
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="h-9" />
        <div className="px-8 pb-8">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
