import { NavLink, useLocation } from 'react-router-dom'
import {
  UserCircle,
  LayoutDashboard,
  Swords,
  TrendingUp,
  Flame,
  LogOut,
  ClipboardList,
  Settings,
  Film,
  FileSearch,
  RefreshCw,
  HelpCircle,
  Users,
  AlertTriangle,
  GraduationCap,
  ListTodo,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUserStore } from '@/store/useUserStore'
import { useSessionStore } from '@/store/useSessionStore'
import { getLevelFromXp } from '@/lib/utils'
import { Progress } from '@/components/ui/progress'
import { useState, useEffect } from 'react'
import { useToast } from '@/hooks/useToast'
import { useTranslation } from 'react-i18next'
import i18n from '../../i18n/config'
import { SyncIndicator } from '@/components/Cloud/SyncIndicator'
import { FeedbackButton } from '@/components/Feedback/FeedbackDialog'
import { NotificationBell } from '@/components/Notifications/NotificationBell'
import { AscendMark } from '@/components/Brand/AscendMark'
import { TierAvatar, useProfilePrefs } from '@/components/Profile/ProfileCard'
import { tierForLevel } from '@/lib/profile'
import { useShareProfileLook } from '@/hooks/useShareProfileLook'

export function Sidebar() {
  const { t } = useTranslation()
  const user = useUserStore((s) => s.user)
  const profilePrefs = useProfilePrefs(user?.id)
  useShareProfileLook(profilePrefs)
  const clearUser = useUserStore((s) => s.clearUser)
  const activeSession = useSessionStore((s) => s.activeSession)
  const [isRecording, setIsRecording] = useState(false)
  const [appVersion, setAppVersion] = useState('')

  useEffect(() => {
    window.api.getAppVersion?.().then(setAppVersion).catch(() => {})
  }, [])

  useEffect(() => {
    window.api.getCaptureStatus().then((s) => setIsRecording(s.isRecording)).catch(() => {})
    const offStarted = window.api.onRecordingStarted(() => setIsRecording(true))
    const offStopped = window.api.onRecordingStopped(() => setIsRecording(false))
    const poll = setInterval(() => {
      window.api.getCaptureStatus().then((s) => setIsRecording(s.isRecording)).catch(() => {})
    }, 10_000)
    return () => {
      offStarted()
      offStopped()
      clearInterval(poll)
    }
  }, [])
  const levelInfo = user ? getLevelFromXp(user.xp) : { level: 1, currentXp: 0, nextLevelXp: 100 }
  const xpPercent = (levelInfo.currentXp / levelInfo.nextLevelXp) * 100
  const [disconnecting, setDisconnecting] = useState(false)
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const { toast } = useToast()

  const handleCheckUpdates = async () => {
    if (checkingUpdate) return
    setCheckingUpdate(true)
    try {
      const result = await window.api.checkForUpdates()
      switch (result.status) {
        case 'available':
          toast({
            title: t('update.availableTitle', 'Update available'),
            description: result.latestVersion
              ? t('update.availableVersion', 'Version {{version}} is downloading…', { version: result.latestVersion })
              : t('update.availableDesc', 'The update is downloading in the background.'),
          })
          break
        case 'up-to-date':
          toast({
            title: t('update.upToDate', 'You are up to date!'),
            description: result.currentVersion ? `v${result.currentVersion}` : undefined,
          })
          break
        case 'unknown':
          toast({
            title: t('update.checkBusy', 'Update check in progress'),
            description: t('update.checkBusyDesc', 'Another check is already running. Please wait a moment and retry.'),
          })
          break
        case 'dev-mode':
          toast({
            title: t('update.devMode', 'Auto-update disabled in development'),
            description: t('update.devModeDesc', 'Build and install the packaged app to test updates.'),
          })
          break
        case 'error':
        default:
          toast({
            title: t('update.checkFailed', 'Could not check for updates'),
            description: result.error,
            variant: 'destructive',
          })
      }
    } catch (err) {
      toast({
        title: t('update.checkFailed', 'Could not check for updates'),
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      })
    } finally {
      setCheckingUpdate(false)
    }
  }

  // Live badges (cheap local COUNTs), refreshed on every navigation and each minute.
  const location = useLocation()
  const [badges, setBadges] = useState<{ toReview: number; mistakes30d: number }>({ toReview: 0, mistakes30d: 0 })
  useEffect(() => {
    let alive = true
    const load = () => window.api.getNavBadges?.().then((b) => { if (alive) setBadges(b) }).catch(() => {})
    load()
    const id = setInterval(load, 60_000)
    return () => { alive = false; clearInterval(id) }
  }, [location.pathname])

  const planObjectives = (() => {
    if (!activeSession) return 0
    try { return (JSON.parse(activeSession.objectiveIds) as string[]).length } catch { return 1 }
  })()

  const path = location.pathname
  const navGroups: NavGroup[] = [
    {
      id: 'practice',
      items: [
        { to: '/', icon: LayoutDashboard, label: t('nav.dashboard'), active: path === '/' },
        { to: '/plan', icon: ListTodo, label: t('nav.plan'), badge: planObjectives > 0 ? { text: t('nav.objBadge', { count: planObjectives }), tone: 'dim' } : undefined },
        { to: '/session', icon: Swords, label: t('nav.session'), dot: activeSession ? 'live' : undefined },
        { to: '/record', icon: Film, label: t('nav.record'), status: isRecording ? 'rec' : user?.autoRecord ? 'auto' : undefined },
        { to: '/review', icon: FileSearch, label: t('nav.review'), active: path.startsWith('/review') || path.startsWith('/external-review'), badge: badges.toReview > 0 ? { text: String(badges.toReview), tone: 'strong' } : undefined },
      ],
    },
    {
      id: 'analysis',
      items: [
        { to: '/history', icon: ClipboardList, label: t('nav.history') },
        // "Statistiques" covers the stats page, per-game stats, lane phase and fundamentals progression.
        { to: '/stats', icon: TrendingUp, label: t('nav.statistics'), active: (path.startsWith('/stats') && !path.startsWith('/stats/mistakes')) || path.startsWith('/analytics') || path.startsWith('/lane-phase') },
        { to: '/stats/mistakes', icon: AlertTriangle, label: t('nav.mistakeLab'), badge: badges.mistakes30d > 0 ? { text: String(badges.mistakes30d), tone: 'dim' } : undefined },
      ],
    },
    {
      id: 'team',
      items: [
        { to: '/team', icon: Users, label: t('nav.team', { defaultValue: 'Team' }), active: path.startsWith('/team') },
        { to: '/coaching', icon: GraduationCap, label: t('nav.coaching') },
      ],
    },
    {
      id: 'account',
      items: [
        { to: '/profile', icon: UserCircle, label: t('nav.profile') },
        { to: '/settings', icon: Settings, label: t('nav.settings') },
        { to: '/help', icon: HelpCircle, label: t('nav.help') },
      ],
    },
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
    <aside className="flex h-screen w-64 shrink-0 flex-col border-r border-hextech-border-dim bg-hextech-dark">
      <div className="app-drag-region flex h-14 items-center gap-3 border-b border-hextech-border-dim px-5">
        <AscendMark size={32} className="shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="font-display text-lg font-bold text-hextech-gold-bright block leading-tight">Ascend</span>
          {appVersion && <span className="text-[10px] text-hextech-text-dim/60 leading-none">v{appVersion}</span>}
        </div>
        <NotificationBell />
        <button
          onClick={handleCheckUpdates}
          disabled={checkingUpdate}
          title={t('update.checkButton', 'Check for updates')}
          className="app-no-drag rounded-md p-1.5 text-hextech-text-dim transition-colors hover:bg-hextech-elevated hover:text-hextech-gold disabled:opacity-50"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', checkingUpdate && 'animate-spin')} />
        </button>
      </div>

      {/* Scrolls on its own: on a short window the link list used to push the
          whole layout past 100vh and add a second, page-level scrollbar. */}
      <nav className="min-h-0 flex-1 space-y-5 overflow-y-auto px-3 py-4" aria-label={t('nav.label')}>
        {navGroups.map((group, gi) => (
          <div key={group.id}>
            <p className="mb-1.5 px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-hextech-text-dim">
              {String(gi + 1).padStart(2, '0')} // {t(`nav.groups.${group.id}`)}
            </p>
            <ul className="space-y-0.5">
              {group.items.map((item) => (
                <li key={item.to}><SidebarLink item={item} /></li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      {user && (
        <div className="shrink-0 border-t border-hextech-border-dim p-4 space-y-3">
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

          <SyncIndicator />
          <FeedbackButton />

          <div className="flex items-center justify-between">
            <NavLink to="/profile" title={t('nav.profile')} className="group flex min-w-0 items-center gap-2.5 rounded-md p-1 -m-1 hover:bg-hextech-elevated/60">
              {profilePrefs && <TierAvatar iconId={profilePrefs.iconId} tier={tierForLevel(levelInfo.level)} size={34} />}
              <div className="truncate min-w-0">
                <div className="text-xs font-medium text-hextech-text-bright truncate group-hover:text-hextech-gold-bright">{user.displayName || user.summonerName}</div>
                <div className="text-[10px] text-hextech-text-dim truncate">
                  {user.summonerName}#{user.tagLine}
                </div>
              </div>
            </NavLink>
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
                className="rounded p-1 text-hextech-text-dim transition-colors hover:bg-hextech-elevated hover:text-[#E24C3A] disabled:opacity-50"
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

interface NavItem {
  to: string
  icon: typeof LayoutDashboard
  label: string
  /** Overrides NavLink's own matching (sections spanning several routes). */
  active?: boolean
  badge?: { text: string; tone: 'dim' | 'strong' }
  dot?: 'live'
  status?: 'rec' | 'auto'
}
interface NavGroup { id: 'practice' | 'analysis' | 'team' | 'account'; items: NavItem[] }

function SidebarLink({ item }: { item: NavItem }) {
  const { t } = useTranslation()
  const Icon = item.icon
  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      className={({ isActive }) => {
        const on = item.active ?? isActive
        return cn(
          'relative flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
          on ? 'bg-hextech-elevated font-semibold text-hextech-gold-bright' : 'font-medium text-hextech-text hover:bg-hextech-elevated/50 hover:text-hextech-text-bright',
        )
      }}
    >
      {({ isActive }) => {
        const on = item.active ?? isActive
        return (
          <>
            {on && <span aria-hidden className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-hextech-gold" />}
            <Icon className={cn('h-4 w-4 shrink-0', on ? 'text-hextech-gold' : '')} />
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {item.dot === 'live' && <span className="h-2 w-2 rounded-full bg-hextech-green animate-pulse" aria-label={t('nav.sessionLive')} />}
            {item.status === 'rec' && (
              <span className="flex items-center gap-1 font-mono text-[10px] font-bold text-hextech-red"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-hextech-red" />REC</span>
            )}
            {item.status === 'auto' && (
              <span className="flex items-center gap-1 font-mono text-[10px] font-semibold text-hextech-green" title={t('nav.autoRecordTitle')}><span className="h-1.5 w-1.5 rounded-full bg-hextech-green" />AUTO</span>
            )}
            {item.badge && (
              <span className={cn('rounded border px-1.5 py-px font-mono text-[10px]',
                item.badge.tone === 'strong' ? 'border-hextech-text-bright font-bold text-hextech-text-bright' : 'border-hextech-border-dim text-hextech-text')}>
                {item.badge.text}
              </span>
            )}
          </>
        )
      }}
    </NavLink>
  )
}
