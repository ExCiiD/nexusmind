import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, UserPlus } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/useToast'
import { GroupTeamGate } from '@/components/team/GroupTeamGate'
import { RoleGlyph } from '@/components/team/RoleGlyph'
import { LftExportButton } from '@/components/lft/LftExportButton'
import { RosterTab } from '@/pages/Team/RosterTab'
import { isLegacyStaff } from '@/lib/permissions'
import { riotIdKey, riotIdKeyOf } from '@/lib/playerCard'
import type { Group } from '@/lib/collab'
import type { Team } from '@/lib/ipc'

const ROLES = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'] as const
type Role = (typeof ROLES)[number]

/**
 * Espace d'équipe: the roster of the selected group — the local team linked
 * to it, edited here (player cards), so a player added here is in Champion
 * Pool, Draft Sim and Stats collectives too. Group members not on the roster
 * yet are listed to be placed. Staff edits are published to the group, so
 * the other staff devices and the web see the same roster.
 */
export function TeamSpaceSection({ group }: { group: Group }) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const publishTimer = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => () => clearTimeout(publishTimer.current), [])

  const publishSoon = (teamId: string) => {
    if (!isLegacyStaff(group.myRole) || !window.api.teamPublishToGroup) return
    clearTimeout(publishTimer.current)
    publishTimer.current = setTimeout(() => {
      window.api.teamPublishToGroup?.(group.id, teamId).catch((err: Error) => {
        toast({ title: t('team.space.publishFailed'), description: err.message, variant: 'destructive' })
      })
    }, 1500)
  }

  return (
    <GroupTeamGate group={group}>
      {(team, reload) => {
        const changed = () => { void reload(); publishSoon(team.id) }
        return (
          <div className="space-y-4">
            <MembersToPlace group={group} team={team} onAdded={changed} />
            <RosterTab team={team} loading={false} onChange={changed} logoUrl={group.logoUrl} actions={<LftExportButton team={team} />} />
          </div>
        )
      }}
    </GroupTeamGate>
  )
}

/** Group players whose Riot ID isn't on the roster yet, one click from it. */
function MembersToPlace({ group, team, onAdded }: { group: Group; team: Team; onAdded: () => void }) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [roles, setRoles] = useState<Record<string, Role>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const members = team.members ?? []
  const onRoster = new Set(members.map((m) => riotIdKey(m.ign, m.tagLine)).filter(Boolean))
  const taken = new Set(members.map((m) => m.role))
  const region = members.find((m) => m.region)?.region ?? 'EUW1'
  const toPlace = group.members.filter((m) => m.role === 'player' && m.riotId && !onRoster.has(riotIdKeyOf(m.riotId)))
  if (toPlace.length === 0) return null

  const add = async (m: Group['members'][number]) => {
    const role = roles[m.userId] ?? ROLES.find((r) => !taken.has(r)) ?? 'TOP'
    const [ign, tagLine] = (m.riotId ?? '').split('#')
    setBusy(m.userId)
    try {
      await window.api.addTeamMember(team.id, { displayName: m.displayName || ign, ign, tagLine: tagLine || undefined, region, role })
      toast({ title: t('team.space.added', { name: m.displayName || ign }) })
      onAdded()
    } catch (err) {
      toast({ title: t('team.space.addFailed'), description: (err as Error).message, variant: 'destructive' })
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card className="p-4">
      <h3 className="mb-1 flex items-center gap-2 text-base text-hextech-text-bright">
        <UserPlus className="h-4 w-4 text-hextech-gold" />{t('team.space.toPlaceTitle', { count: toPlace.length })}
      </h3>
      <p className="mb-3 text-xs text-hextech-text-dim">{t('team.space.toPlaceDesc')}</p>
      <ul className="flex flex-wrap gap-2">
        {toPlace.map((m) => {
          const fallback = ROLES.find((r) => !taken.has(r)) ?? 'TOP'
          return (
            <li key={m.userId} className="flex items-center gap-2 rounded-md border border-hextech-border-dim bg-hextech-black/30 px-3 py-2">
              <span className="min-w-0">
                <span className="block truncate text-sm text-hextech-text-bright">{m.displayName || m.riotId}</span>
                <span className="block truncate font-mono text-[10px] text-hextech-text-dim">{m.riotId}</span>
              </span>
              <Select value={roles[m.userId] ?? fallback} onValueChange={(v) => setRoles((p) => ({ ...p, [m.userId]: v as Role }))}>
                <SelectTrigger className="h-8 w-28 text-xs" aria-label={t('team.space.role')}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      <span className="flex items-center gap-1.5">
                        <RoleGlyph role={r} className="h-3.5 w-3.5 text-hextech-gold" />
                        {t(`team.roster.roles.${r}`, { defaultValue: r })}{taken.has(r) ? ` · ${t('team.space.taken')}` : ''}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" onClick={() => add(m)} disabled={busy !== null} className="gap-1">
                {busy === m.userId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}{t('team.space.add')}
              </Button>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
