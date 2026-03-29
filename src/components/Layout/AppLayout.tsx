import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'

export function AppLayout() {
  return (
    <div className="flex h-screen bg-hextech-black">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="app-drag-region h-9 w-full" />
        <div className="px-8 pb-8">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
