import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { PanelErrorBoundary } from '@/components/PanelErrorBoundary'
import { NoGroupNotice, TeamSectionHeader, useTeamSection } from '@/components/team/TeamSection'
import { TeamSpaceSection } from '@/pages/Coaching/TeamSpaceSection'

/**
 * Espace d'équipe: the roster of the group picked in the section header —
 * its players and their cards, built from the members who joined with their
 * Riot account (GroupTeamGate). The Champion Pool, Draft Sim and Scouting of
 * Coaching and the Stats collectives all work on this same team.
 */
export function TeamSpacePage() {
  const { t } = useTranslation()
  const section = useTeamSection()
  const { available, loading, myUserId, group } = section

  return (
    // The page fills the visible height, so the card row can sit centred in it (RosterTab `fill`).
    <div className="flex min-h-[calc(100dvh-4rem)] flex-col gap-4 animate-fade-in">
      <TeamSectionHeader title={t('teamSpace.title')} subtitle={t('teamSpace.subtitle')} section={section} />
      {loading ? (
        <Loader2 className="h-6 w-6 animate-spin text-hextech-gold" />
      ) : !available || !myUserId ? (
        <p className="text-sm text-hextech-text-dim">{t('coaching.unavailable')}</p>
      ) : !group ? (
        <NoGroupNotice />
      ) : (
        <PanelErrorBoundary key={`workspace-${group.id}`} label="Team workspace">
          <TeamSpaceSection group={group} />
        </PanelErrorBoundary>
      )}
    </div>
  )
}
