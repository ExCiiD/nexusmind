import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useToast } from '@/hooks/useToast'
import { GroupTeamGate } from '@/components/team/GroupTeamGate'
import { LftExportButton } from '@/components/lft/LftExportButton'
import { CardLookButton } from '@/components/team/CardLookButton'
import { RosterTab } from '@/pages/Team/RosterTab'
import { isLegacyStaff } from '@/lib/permissions'
import type { Group } from '@/lib/collab'

/**
 * Espace d'équipe: the roster of the selected group. Its players are the
 * group's (each joined with their Riot account; GroupTeamGate keeps the
 * local team in step), so nobody is added or removed here — the staff set
 * each player's lane, edit the cards and fetch champions. Staff edits are
 * published to the group, so other staff devices and the web see the same.
 */
export function TeamSpaceSection({ group }: { group: Group }) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const publishTimer = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => () => clearTimeout(publishTimer.current), [])

  const publishSoon = (teamId: string) => {
    if (!isLegacyStaff(group.myRole, group.myStaffRoles) || !window.api.teamPublishToGroup) return
    clearTimeout(publishTimer.current)
    publishTimer.current = setTimeout(() => {
      window.api.teamPublishToGroup?.(group.id, teamId).catch((err: Error) => {
        toast({ title: t('team.space.publishFailed'), description: err.message, variant: 'destructive' })
      })
    }, 1500)
  }

  return (
    <GroupTeamGate group={group}>
      {(team, reload) => (
        <RosterTab
          team={team}
          loading={false}
          groupManaged
          onChange={() => { void reload(); publishSoon(team.id) }}
          logoUrl={group.logoUrl}
          actions={<><CardLookButton /><LftExportButton team={team} /></>}
        />
      )}
    </GroupTeamGate>
  )
}
