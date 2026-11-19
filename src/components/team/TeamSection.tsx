import { useCallback, type ComponentType, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'
import { Users } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCollab } from '@/hooks/useCollab'
import { GroupSwitcher } from '@/components/Coaching/GroupSwitcher'
import { resolveActiveGroup, useActiveGroupStore } from '@/store/useActiveGroupStore'

/**
 * Shared frame of the "Équipe & staff" section: Management, Espace d'équipe,
 * Coaching and Stats collectives. One group drives the whole section — the one
 * picked in any of their headers (useActiveGroupStore, remembered on this
 * device) — and every page shows the same header and the same switcher.
 */
export function useTeamSection() {
  const collab = useCollab()
  const storedGroupId = useActiveGroupStore((s) => s.groupId)
  const group = resolveActiveGroup(collab.groups, storedGroupId)
  return { ...collab, group }
}

export function TeamSectionHeader({ title, subtitle, section }: {
  title: string
  subtitle: string
  section: ReturnType<typeof useTeamSection>
}) {
  const { available, groups, group } = section
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="font-display text-2xl font-bold text-hextech-gold-bright">{title}</h1>
        <p className="mt-1 text-sm text-hextech-text">{subtitle}</p>
      </div>
      {available && groups.length > 0 && <GroupSwitcher groups={groups} active={group} />}
    </div>
  )
}

export interface SectionTab<T extends string> {
  id: T
  label: string
  icon: ComponentType<{ className?: string }>
}

/**
 * The page's tab, kept in the URL (`?tab=`) so links and notifications can
 * open a given tab. An unknown or hidden tab (e.g. a staff tab for a player)
 * shows `fallback` instead.
 */
export function useTabParam<T extends string>(visible: readonly T[], fallback: T): [T, (tab: T) => void] {
  const [params, setParams] = useSearchParams()
  const raw = params.get('tab') as T | null
  const tab = raw && visible.includes(raw) ? raw : fallback
  const setTab = useCallback((next: T) => {
    setParams((p) => {
      const n = new URLSearchParams(p)
      n.set('tab', next)
      return n
    }, { replace: true })
  }, [setParams])
  return [tab, setTab]
}

export function SectionTabs<T extends string>({ tabs, active, onChange }: {
  tabs: SectionTab<T>[]
  active: T
  onChange: (tab: T) => void
}) {
  return (
    <div className="flex border-b border-hextech-border-dim overflow-x-auto" role="tablist">
      {tabs.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          role="tab"
          aria-selected={active === id}
          onClick={() => onChange(id)}
          className={cn(
            'flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
            active === id
              ? 'border-hextech-gold text-hextech-gold-bright'
              : 'border-transparent text-hextech-text-dim hover:text-hextech-text',
          )}
        >
          <Icon className="h-4 w-4" />
          {label}
        </button>
      ))}
    </div>
  )
}

/** Shown by the section's pages when the user has no group yet: groups are created and joined in Management. */
export function NoGroupNotice({ children }: { children?: ReactNode }) {
  const { t } = useTranslation()
  return (
    <div className="rounded-lg border border-hextech-border-dim bg-hextech-dark/40 p-6 text-center">
      <Users className="mx-auto mb-2 h-6 w-6 text-hextech-gold" />
      <p className="text-sm text-hextech-text">{children ?? t('teamSection.noGroup')}</p>
      <Link to="/management?tab=groups" className="mt-3 inline-block text-sm font-medium text-hextech-gold hover:text-hextech-gold-bright">
        {t('teamSection.goToGroups')}
      </Link>
    </div>
  )
}
