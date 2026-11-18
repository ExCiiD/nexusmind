import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link2, Loader2, Plus, Shield } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/useToast'
import type { Group } from '@/lib/collab'
import type { Team } from '@/lib/ipc'
import { isLegacyStaff } from '@/lib/permissions'

/** This device's own teams, and the one that is the roster of `groupId`. */
export function useGroupTeam(groupId: string | null) {
  const [teams, setTeams] = useState<Team[] | null>(null)
  const reload = useCallback(async () => {
    try { setTeams(await window.api.listTeams({ isOpponent: false })) } catch { setTeams([]) }
  }, [])
  useEffect(() => { reload() }, [reload])
  const team = groupId ? teams?.find((t) => t.groupId === groupId) ?? null : null
  return { teams, team, loading: teams === null, reload }
}

const ROLES = new Set(['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'])

/**
 * What the group-scoped team tabs render through (Espace d'équipe, Champion
 * Pool, Draft Sim, Stats collectives): the local team linked to the group,
 * or — the first time on this computer — a card to link one of its teams or
 * create the group's team, filled from the roster the group published.
 */
export function GroupTeamGate({ group, children }: {
  group: Group
  children: (team: Team, reload: () => Promise<void>) => ReactNode
}) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const { teams, team, loading, reload } = useGroupTeam(group.id)
  const candidates = (teams ?? []).filter((x) => !x.groupId)
  const [pick, setPick] = useState<string>('')
  const [busy, setBusy] = useState(false)

  if (loading) return <Loader2 className="h-5 w-5 animate-spin text-hextech-gold" />
  if (team) return <>{children(team, reload)}</>

  // Staff publish the linked roster right away, so the planning's starters
  // and the web read the same team (TeamSpaceSection keeps it published).
  const publish = (teamId: string) => {
    if (isLegacyStaff(group.myRole)) window.api.teamPublishToGroup?.(group.id, teamId).catch(() => { /* retried on the next roster change */ })
  }

  const link = async (teamId: string) => {
    setBusy(true)
    try {
      await window.api.linkTeamToGroup(teamId, group.id)
      publish(teamId)
      await reload()
    } catch (err) {
      toast({ title: t('team.link.failed'), description: (err as Error).message, variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  const create = async () => {
    setBusy(true)
    try {
      const created = await window.api.createTeam({ name: group.name, isOpponent: false })
      await window.api.linkTeamToGroup(created.id, group.id)
      // The roster the group already published, if any, becomes this team's.
      const shared = await window.api.teamGetShared?.(group.id).catch(() => null)
      for (const m of shared?.roster ?? []) {
        if (!ROLES.has(m.role)) continue
        await window.api.addTeamMember(created.id, {
          displayName: m.displayName, ign: m.ign ?? undefined, tagLine: m.tagLine ?? undefined, region: m.region ?? 'EUW1', role: m.role,
        })
      }
      publish(created.id)
      await reload()
      toast({ title: t('team.link.created', { name: group.name }), variant: 'gold' })
    } catch (err) {
      toast({ title: t('team.link.failed'), description: (err as Error).message, variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  const chosen = pick || candidates[0]?.id || ''
  return (
    <Card className="space-y-4 p-5">
      <div>
        <h3 className="flex items-center gap-2 text-lg text-hextech-text-bright">
          <Shield className="h-5 w-5 text-hextech-gold" />{t('team.link.title', { name: group.name })}
        </h3>
        <p className="mt-1 max-w-2xl text-sm text-hextech-text">{t('team.link.desc')}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {candidates.length > 0 && (
          <>
            <Select value={chosen} onValueChange={setPick}>
              <SelectTrigger className="w-56" aria-label={t('team.link.pick')}><SelectValue /></SelectTrigger>
              <SelectContent>
                {candidates.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name} · {t('team.link.players', { count: c.members?.length ?? 0 })}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" onClick={() => link(chosen)} disabled={busy || !chosen} className="gap-1">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}{t('team.link.link')}
            </Button>
            <span className="text-xs text-hextech-text-dim">{t('team.link.or')}</span>
          </>
        )}
        <Button size="sm" variant={candidates.length > 0 ? 'outline' : 'default'} onClick={create} disabled={busy} className="gap-1">
          <Plus className="h-3.5 w-3.5" />{t('team.link.create', { name: group.name })}
        </Button>
      </div>
    </Card>
  )
}
