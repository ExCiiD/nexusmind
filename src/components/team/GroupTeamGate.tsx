import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Users } from 'lucide-react'
import { Card } from '@/components/ui/card'
import type { Group } from '@/lib/collab'
import type { Team } from '@/lib/ipc'
import { isLegacyStaff } from '@/lib/permissions'
import { riotIdKey } from '@/lib/playerCard'
import { planGroupTeamSync } from '@/lib/groupTeamSyncCore'

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

/**
 * Makes this device's team for `group` match the group's players: created
 * (named after the group) and linked the first time, then players who
 * joined are added and members who left are removed. Returns the team.
 */
const inFlight = new Map<string, Promise<Team>>()
function syncGroupTeam(group: Group): Promise<Team> {
  // One sync per group at a time: two gates mounting together (or React's
  // dev double effect) must not create the team twice.
  const running = inFlight.get(group.id)
  if (running) return running
  const p = doSync(group).finally(() => inFlight.delete(group.id))
  inFlight.set(group.id, p)
  return p
}

async function doSync(group: Group): Promise<Team> {
  const teams = await window.api.listTeams({ isOpponent: false })
  let team = teams.find((x) => x.groupId === group.id) ?? null
  if (!team) {
    const created = await window.api.createTeam({ name: group.name, isOpponent: false })
    const linked = await window.api.linkTeamToGroup(created.id, group.id)
    team = linked ?? { ...created, groupId: group.id }
  }
  // The lanes the staff set on the roster the group published, if any.
  const shared = await window.api.teamGetShared?.(group.id).catch(() => null)
  const lanes = new Map<string, string>()
  for (const m of shared?.roster ?? []) {
    const key = riotIdKey(m.ign, m.tagLine)
    if (key) lanes.set(key, m.role)
  }
  const current = team.members ?? []
  const region = current.find((m) => m.region)?.region ?? 'EUW1'
  const plan = planGroupTeamSync(group.members, current, (k) => lanes.get(k))
  for (const id of plan.remove) await window.api.removeTeamMember(id)
  for (const m of plan.add) await window.api.addTeamMember(team.id, { ...m, region })
  // #38: a player who renamed their Riot account (same puuid) keeps their team
  // member (history, pool, stats) — updated in place, not removed and re-added.
  for (const { id, ...change } of plan.update) await window.api.updateTeamMember(id, change)
  if ((plan.add.length || plan.remove.length || plan.update.length) && isLegacyStaff(group.myRole, group.myStaffRoles)) {
    window.api.teamPublishToGroup?.(group.id, team.id).catch(() => { /* retried on the next change */ })
  }
  return team
}

/**
 * What the group-scoped team tabs render through (Stats collectives,
 * Espace d'équipe, Champion Pool, Draft Sim): the group's team, built from
 * the players who joined the group with their Riot account (19/11/2026 —
 * no team to pick or link by hand any more). Synced each time it mounts.
 */
export function GroupTeamGate({ group, children }: {
  group: Group
  children: (team: Team, reload: () => Promise<void>) => ReactNode
}) {
  const { t } = useTranslation()
  const { team, reload } = useGroupTeam(group.id)
  const [state, setState] = useState<'syncing' | 'ready' | 'failed'>('syncing')
  const [error, setError] = useState<string | null>(null)
  const membersKey = group.members.map((m) => `${m.userId}:${m.role}:${m.riotId ?? ''}`).join('|')
  const run = useRef(0)

  useEffect(() => {
    const id = ++run.current
    setState('syncing')
    syncGroupTeam(group)
      .then(async () => { await reload(); if (id === run.current) setState('ready') })
      .catch((err: Error) => { if (id === run.current) { setError(err.message); setState('failed') } })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-sync when the group's players change, not on every render
  }, [group.id, membersKey, reload])

  if (state === 'syncing' && !team) return <Loader2 className="h-5 w-5 animate-spin text-hextech-gold" />
  if (state === 'failed' && !team) {
    return <Card className="p-5 text-sm text-hextech-red">{t('team.sync.failed')}{error ? ` (${error})` : ''}</Card>
  }
  if (!team) return null
  if ((team.members ?? []).length === 0) {
    return (
      <Card className="flex items-start gap-3 p-5">
        <Users className="mt-0.5 h-5 w-5 shrink-0 text-hextech-gold" />
        <div>
          <h3 className="text-base text-hextech-text-bright">{t('team.sync.emptyTitle', { name: group.name })}</h3>
          <p className="mt-1 max-w-2xl text-sm text-hextech-text">{t('team.sync.emptyDesc')}</p>
        </div>
      </Card>
    )
  }
  return <>{children(team, reload)}</>
}
