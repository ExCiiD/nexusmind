import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  Target,
  ClipboardCheck,
  BarChart3,
  Flame,
  LogOut,
  History,
  ChartNoAxesCombined,
  Settings,
  Users,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUserStore } from '@/store/useUserStore'
import { useSessionStore } from '@/store/useSessionStore'
import { getLevelFromXp } from '@/lib/utils'
import { Progress } from '@/components/ui/progress'
import { useState } from 'react'
import { useToast } from '@/hooks/useToast'
import { useTranslation } from 'react-i18next'
import i18n from '../../i18n/config'

export function Sidebar() {
  const { t } = useTranslation()
  const user = useUserStore((s) => s.user)
  const clearUser = useUserStore((s) => s.clearUser)
  const activeSession = useSessionStore((s) => s.activeSession)
  const levelInfo = user ? getLevelFromXp(user.xp) : { level: 1, currentXp: 0, nextLevelXp: 100 }
  const xpPercent = (levelInfo.currentXp / levelInfo.nextLevelXp) * 100
  const [disconnecting, setDisconnecting] = useState(false)
  const { toast } = useToast()

  const isCoach = user?.role === 'coach' || user?.role === 'both'

  const navItems = [
    { to: '/', icon: LayoutDashboard, label: t('nav.dashboard') },
    { to: '/session', icon: Target, label: t('nav.session') },
    { to: '/review', icon: ClipboardCheck, label: t('nav.review') },
    { to: '/history', icon: History, label: t('nav.history') },
    { to: '/stats', icon: ChartNoAxesCombined, label: t('nav.detailedStats') },
    { to: '/analytics', icon: BarChart3, label: t('nav.analytics') },
    ...(isCoach ? [{ to: '/students', icon: Users, label: 'Students' }] : []),
    { to: '/settings', icon: Settings, label: t('nav.settings') },
  ]

  const handleDisconnect = async () => {
    setDisconnecting(true)
    try {
      await window.api.disconnectRiot()
      clearUser()
    } catch {
      toast({ title: t('sidebar.disconnectError'), variant: 'destructive' })
      setDisconnecting(false)
    }
  }

  return (
    <aside className="flex h-screen w-64 flex-col border-r border-hextech-border-dim bg-hextech-dark">
      <div className="app-drag-region flex h-14 items-center gap-3 border-b border-hextech-border-dim px-5">
        <div className="h-8 w-8 rounded bg-gradient-to-br from-hextech-cyan to-hextech-teal flex items-center justify-center">
          <span className="text-sm font-bold text-hextech-black">N</span>
        </div>
        <span className="font-display text-lg font-bold text-hextech-gold-bright">NexusMind</span>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-4">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-hextech-elevated text-hextech-gold-bright'
                  : 'text-hextech-text hover:bg-hextech-elevated/50 hover:text-hextech-text-bright',
              )
            }
          >
            <Icon className="h-4 w-4" />
            {label}
            {to === '/session' && activeSession && (
              <span className="ml-auto h-2 w-2 rounded-full bg-hextech-green animate-pulse" />
            )}
          </NavLink>
        ))}
      </nav>

      {user && (
        <div className="border-t border-hextech-border-dim p-4 space-y-3">
          <div className="flex items-center justify-between text-xs">
            <span className="text-hextech-text">{t('sidebar.level')} {levelInfo.level}</span>
            <span className="text-hextech-gold">
              {levelInfo.currentXp}/{levelInfo.nextLevelXp} {t('sidebar.xp')}
            </span>
          </div>
          <Progress value={xpPercent} indicatorClassName="bg-hextech-cyan" />

          {user.streakDays > 0 && (
            <div className="flex items-center gap-2 text-xs text-hextech-gold">
              <Flame className="h-3.5 w-3.5" />
              <span>{user.streakDays} {user.streakDays === 1 ? t('sidebar.dayStreak') : t('sidebar.dayStreaks')}</span>
            </div>
          )}

          <div className="flex items-center justify-between">
            <div className="truncate min-w-0">
              {user.displayName && (
                <div className="text-xs font-medium text-hextech-text-bright truncate">{user.displayName}</div>
              )}
              <div className="text-[10px] text-hextech-text-dim truncate">
                {user.summonerName}#{user.tagLine}
              </div>
            </div>
            <div className="flex items-center gap-1 ml-2 shrink-0">
              <button
                onClick={() => i18n.changeLanguage(i18n.language.startsWith('fr') ? 'en' : 'fr')}
                className="rounded px-1.5 py-0.5 text-[10px] font-bold text-hextech-text-dim border border-hextech-border-dim hover:bg-hextech-elevated hover:text-hextech-gold transition-colors"
                title="Switch language / Changer la langue"
              >
                {i18n.language.startsWith('fr') ? 'EN' : 'FR'}
              </button>
              <button
                onClick={handleDisconnect}
                disabled={disconnecting}
                title={t('sidebar.disconnectTitle')}
                className="rounded p-1 text-hextech-text-dim transition-colors hover:bg-hextech-elevated hover:text-[#FF4655] disabled:opacity-50"
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  )
}
