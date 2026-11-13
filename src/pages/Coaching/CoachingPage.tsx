import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { useCollab } from '@/hooks/useCollab'
import { AssignedObjectivesCard } from '@/components/Coaching/AssignedObjectivesCard'
import { GroupsSection } from './GroupsSection'
import { PlayersSection } from './PlayersSection'
import { TeamWorkspaceSection } from './TeamWorkspaceSection'

/** Teams & coaching: groups, invitations, sharing, coach view of players. */
export function CoachingPage() {
  const { t } = useTranslation()
  const { available, loading, myUserId, groups, staffGroups, nameOf, reload } = useCollab()

  return (
    <div className="space-y-4 animate-fade-in">
      <div>
        <h1 className="font-display text-2xl font-bold text-hextech-gold-bright">{t('coaching.title')}</h1>
        <p className="mt-1 text-sm text-hextech-text">{t('coaching.subtitle')}</p>
      </div>
      {loading ? (
        <Loader2 className="h-6 w-6 animate-spin text-hextech-gold" />
      ) : !available || !myUserId ? (
        <p className="text-sm text-hextech-text-dim">{t('coaching.unavailable')}</p>
      ) : (
        <>
          <AssignedObjectivesCard />
          {staffGroups.length > 0 && <PlayersSection staffGroups={staffGroups} myUserId={myUserId} nameOf={nameOf} />}
          <TeamWorkspaceSection staffGroups={staffGroups} />
          <GroupsSection groups={groups} myUserId={myUserId} reload={reload} />
        </>
      )}
    </div>
  )
}
