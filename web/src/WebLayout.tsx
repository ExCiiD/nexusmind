import { NavLink, Outlet } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { CalendarDays, FileSearch, GraduationCap, Home, UserCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { FeedbackButton } from '@/components/Feedback/FeedbackDialog'
import { NotificationBell } from '@/components/Notifications/NotificationBell'
import { DownloadButton } from './DownloadButton'
import logo from '@/assets/ascend-logo-mark.png'

const NAV = [
  { to: '/', icon: Home, key: 'web.nav.home', end: true },
  { to: '/reviews', icon: FileSearch, key: 'web.nav.reviews' },
  { to: '/scrims', icon: CalendarDays, key: 'web.nav.scrims' },
  { to: '/coaching', icon: GraduationCap, key: 'web.nav.coaching' },
  { to: '/account', icon: UserCircle, key: 'web.nav.account' },
]

/** Sidebar on wide screens, bottom tab bar on phones. */
export function WebLayout() {
  const { t } = useTranslation()
  return (
    <div className="ascend-texture-bg min-h-screen text-hextech-text">
      <aside className="fixed inset-y-0 left-0 hidden w-56 flex-col border-r border-hextech-border-dim bg-hextech-dark p-4 md:flex">
        <div className="mb-6 flex items-center gap-2">
          <img src={logo} alt="" className="h-8 w-8 rounded-full object-cover" />
          <span className="flex-1 font-display text-lg text-hextech-gold-bright">Ascend</span>
          <NotificationBell />
        </div>
        <nav className="space-y-1">
          {NAV.map(({ to, icon: Icon, key, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn('flex items-center gap-2 rounded px-3 py-2 text-sm', isActive ? 'bg-hextech-gold/10 text-hextech-gold' : 'hover:bg-hextech-elevated')
              }
            >
              <Icon className="h-4 w-4" />{t(key)}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto space-y-3">
          <DownloadButton compact className="w-full" />
          <p className="text-xs text-hextech-text-dim">{t('web.desktopHint')}</p>
          <FeedbackButton />
        </div>
      </aside>

      <div className="fixed right-4 top-4 z-30 md:hidden">
        <NotificationBell />
      </div>

      <main className="px-4 pb-24 pt-4 md:ml-56 md:px-8 md:pb-8 md:pt-8">
        <div className="mx-auto max-w-4xl">
          <Outlet />
        </div>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-hextech-border-dim bg-hextech-dark pb-[env(safe-area-inset-bottom)] md:hidden">
        {NAV.map(({ to, icon: Icon, key, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn('flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px]', isActive ? 'text-hextech-gold' : 'text-hextech-text-dim')
            }
          >
            <Icon className="h-5 w-5" />{t(key)}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
