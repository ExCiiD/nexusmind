import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useToast } from '@/hooks/useToast'
import { Save, X } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { RoleGlyph } from '@/components/team/RoleGlyph'
import type { AwardHolder, Team, TeamMember } from '@/lib/ipc'
import type { CardChampion, MemberLook } from '@/lib/collab'
import { cardChoiceOf, frontChampion, isOwnMember } from '@/lib/cardChampionView'
import { CardSkinDialog } from '@/components/team/CardSkinDialog'
import { bestChampions, lookForMember, mainChampion, type LookSources } from '@/lib/playerCard'
import { useWeeklyAwards } from '@/hooks/useWeeklyAwards'
import { useAllChampions } from '@/hooks/useAllChampions'
import { useProfilePrefs } from '@/components/Profile/ProfileCard'
import { useUserStore } from '@/store/useUserStore'
import { useBackgroundJobsStore } from '@/store/useBackgroundJobsStore'
import { EmptySlotCard, PlayerCard } from './PlayerCard'
import { ROLES, type Role } from '@/lib/championRoles'
import { cn } from '@/lib/utils'


// No width here: each field sets its own (a shared w-full would beat w-14).
const INPUT = 'rounded border border-hextech-border bg-hextech-dark px-2 py-1 text-xs'

interface RosterTabProps {
  team: Team | null
  loading: boolean
  onChange: () => void
  /** The cloud group's logo, on the cards' crest. */
  logoUrl?: string | null
  /** Extra actions for the top bar (the looking-for-team export). */
  actions?: ReactNode
  /** The roster is the group's players: no adding or removing here. Always
   *  true since 19/11/2026 (the only caller is Espace d'équipe). */
  groupManaged?: boolean
  /** Espace d'équipe: the card row fills the remaining height of the page, centred vertically, and the cards
   *  shrink to fit the window's height (a 1 : 1.75 card under the header and the action row). */
  fill?: boolean
}

/** Looks the members of my cloud groups shared (empty when signed out). */
function useMemberLooks(): MemberLook[] {
  const [looks, setLooks] = useState<MemberLook[]>([])
  useEffect(() => {
    let alive = true
    window.api.collabListMemberLooks?.()
      .then((l) => { if (alive) setLooks(Array.isArray(l) ? l : []) })
      .catch(() => { /* signed out or offline: initials and default banners */ })
    return () => { alive = false }
  }, [])
  return looks
}

export function RosterTab({ team, loading, onChange, logoUrl, actions, fill = false }: RosterTabProps) {
  const { t } = useTranslation()
  const [editingId, setEditingId] = useState<string | null>(null)
  /** #46.2: the card whose first champions (masteries, a few seconds) are being read. */
  const [quickId, setQuickId] = useState<string | null>(null)
  const { toast } = useToast()
  /** § 14: my card's choice once saved here (the shared looks are read once); undefined: as the looks say. */
  const [myCard, setMyCard] = useState<CardChampion | null | undefined>(undefined)
  /** The skin picker open for a champion of my card's back. */
  const [picking, setPicking] = useState<{ memberId: string; championId: string } | null>(null)

  const user = useUserStore((s) => s.user)
  const prefs = useProfilePrefs(user?.id)
  const looks = useMemberLooks()
  const lookSources = useMemo<LookSources>(() => ({
    me: user
      ? {
          puuid: user.puuid,
          riotId: user.tagLine ? `${user.summonerName}#${user.tagLine}` : user.summonerName,
          look: prefs ? { iconId: prefs.iconId, bannerId: prefs.bannerId } : null,
        }
      : null,
    looks,
  }), [user, prefs, looks])

  const { champions } = useAllChampions()
  const nameOf = useMemo(() => {
    const names = new Map(champions.map((c) => [c.key, c.name]))
    return (key: string) => names.get(key) ?? key
  }, [champions])

  const runAutoFill = useBackgroundJobsStore((s) => s.runAutoFill)
  const fetching = useBackgroundJobsStore((s) => !!team && s.jobs.some((j) => j.kind === 'autoFill' && j.label.includes(team.name)))

  // Weekly awards: reloaded when the roster changes.
  const rosterKey = (team?.members ?? []).map((m) => m.id).join(',')
  const awards = useWeeklyAwards(team?.id, rosterKey)
  const holdersOf = useMemo(() => {
    const by = new Map<string, AwardHolder[]>()
    for (const h of awards?.holders ?? []) by.set(h.memberId, [...(by.get(h.memberId) ?? []), h])
    return (memberId: string) => by.get(memberId) ?? []
  }, [awards])

  if (loading) return <Card className="p-6 text-center text-hextech-text-dim">{t('common.loading')}</Card>
  if (!team) {
    return (
      <Card className="p-6 text-center text-hextech-text-dim">
        {t('team.roster.noTeam', { defaultValue: 'Create a team above to start adding members.' })}
      </Card>
    )
  }

  const members = team.members ?? []
  // One card per lane; players beyond that (a sixth player, two on a lane)
  // are listed after the five, so nobody of the group is hidden.
  const starters = new Map<Role, TeamMember>()
  const others: TeamMember[] = []
  for (const m of members) {
    const lane = m.role as Role
    if (ROLES.includes(lane) && !starters.has(lane)) starters.set(lane, m)
    else others.push(m)
  }

  const fetchChampions = async (member: TeamMember) => {
    // #46.2: the card's first champions within seconds (masteries, one Riot call), shown at once; then the full
    // pool in the background as before. 0 (pool not empty) or a failure: just the full pool.
    if (window.api.teamCardChampions) {
      setQuickId(member.id)
      try {
        const res = await window.api.teamCardChampions?.(member.id)
        if ((res?.upserted ?? 0) > 0) onChange()
      } catch { /* the full pool below still runs */ }
      finally { setQuickId(null) }
    }
    void runAutoFill({
      // The team name in the label lets the Champion Pool tab see the job too.
      label: t('team.roster.card.fetchJob', { team: team.name, name: member.displayName }),
      members: [member],
      scope: 'quick',
      onDone: () => onChange(),
    })
  }

  // § 14: the champion and skin on the front, and the picker on my own card.
  const canPick = !!window.api.collabSetMyCardChampion && !!window.api.collabListCardSkins
  const frontOf = (member: TeamMember) => {
    const own = isOwnMember(member, lookSources.me)
    const choice = own && myCard !== undefined ? myCard : cardChoiceOf(member, looks)
    const best = bestChampions(member.champPool)
    const front = frontChampion(choice, best.champions.map((c) => c.championKey), mainChampion(member.champPool))
    return { own, choice, best, front }
  }
  const saveMyCard = async (choice: CardChampion | null): Promise<boolean> => {
    const ok = await window.api.collabSetMyCardChampion?.(choice).catch(() => false)
    if (ok) {
      setMyCard(choice)
      toast({ title: t('team.roster.card.pick.saved') })
      return true
    }
    // Signed out, refused, or the database without the card columns yet (migration 20261120140000).
    toast({ title: t('team.roster.card.pick.saveFailed'), description: t('team.roster.card.pick.saveFailedHint'), variant: 'destructive' })
    return false
  }

  const card = (member: TeamMember, role: Role) => {
    const canFetch = !!(member.ign && member.tagLine && member.region)
    const { own, best, front } = frontOf(member)
    return (
      <PlayerCard
        key={member.id}
        member={member}
        role={role}
        look={lookForMember(member, lookSources)}
        champions={best}
        team={{ name: team.name, tag: team.tag, logoUrl }}
        artChampion={front?.championId ?? null}
        artSkin={front?.skinNum ?? 0}
        picker={own && canPick && best.champions.length > 0
          ? { shownKey: front?.championId ?? null, onPick: (championId) => setPicking({ memberId: member.id, championId }) }
          : undefined}
        holders={holdersOf(member.id)}
        totals={awards?.totals[member.id]}
        nameOf={nameOf}
        fetching={fetching || quickId === member.id}
        onFetch={canFetch ? () => { void fetchChampions(member) } : null}
        onEdit={() => setEditingId(member.id)}
        onRenameSeen={() => onChange()}
        editForm={editingId === member.id ? (
          <MemberEditForm
            member={member}
            members={members}
            onSave={() => { setEditingId(null); onChange() }}
            onCancel={() => setEditingId(null)}
          />
        ) : undefined}
      />
    )
  }

  return (
    <TooltipProvider delayDuration={150}>
      <div className={fill ? 'flex flex-1 flex-col gap-3' : 'space-y-3'}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-hextech-text-dim">{t('team.roster.fromGroup')}</p>
          <div className="flex flex-wrap gap-2">{actions}</div>
        </div>

        {/* Room between the cards for the award frames (6 % outside each card). */}
        <div
          className={cn('grid grid-cols-2 gap-x-6 gap-y-8 px-2 pt-2 sm:grid-cols-3 xl:grid-cols-5', fill && 'my-auto w-full [&>*]:max-w-[var(--card-max)]')}
          // Under 16rem of header, tabs and actions, a card is 1.75 times as tall as it is wide.
          style={fill ? { ['--card-max' as string]: 'min(250px, calc((100dvh - 16rem) / 1.75))' } : undefined}
        >
          {ROLES.map((role) => {
            const member = starters.get(role)
            if (member) return card(member, role)
            return (
              <EmptySlotCard key={role} role={role}>
                <p className="text-center text-[11px] text-hextech-text-dim">{t('team.roster.emptyFromGroup')}</p>
              </EmptySlotCard>
            )
          })}
          {others.map((m) => card(m, (ROLES.includes(m.role as Role) ? m.role : 'TOP') as Role))}
        </div>
        {picking && (() => {
          const member = members.find((m) => m.id === picking.memberId)
          if (!member) return null
          const { choice, best } = frontOf(member)
          const role = (ROLES.includes(member.role as Role) ? member.role : 'TOP') as Role
          return (
            <CardSkinDialog
              championId={picking.championId}
              championName={nameOf(picking.championId)}
              current={choice}
              onSave={saveMyCard}
              onClose={() => setPicking(null)}
              preview={(skinNum) => (
                <PlayerCard
                  preview
                  member={member}
                  role={role}
                  look={lookForMember(member, lookSources)}
                  champions={best}
                  team={{ name: team.name, tag: team.tag, logoUrl }}
                  artChampion={picking.championId}
                  artSkin={skinNum}
                  holders={holdersOf(member.id)}
                  totals={awards?.totals[member.id]}
                  nameOf={nameOf}
                  fetching={false}
                  onFetch={null}
                  onEdit={() => {}}
                />
              )}
            />
          )
        })()}
      </div>
    </TooltipProvider>
  )
}

/** Display name and lane. The Riot ID is the one the player joined the
 *  group with, so it isn't edited here. Picking a lane another player holds
 *  swaps the two. */
function MemberEditForm({ member, members, onSave, onCancel }: {
  member: TeamMember
  members: TeamMember[]
  onSave: () => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [displayName, setDisplayName] = useState(member.displayName)
  const [role, setRole] = useState<Role>((ROLES.includes(member.role as Role) ? member.role : 'TOP') as Role)

  const save = async () => {
    try {
      const holder = role !== member.role ? members.find((m) => m.id !== member.id && m.role === role) : undefined
      if (holder) await window.api.updateTeamMember(holder.id, { role: member.role })
      await window.api.updateTeamMember(member.id, { displayName: displayName.trim() || member.displayName, role })
      onSave()
    } catch (err) {
      toast({ title: t('team.roster.card.updateFailed'), description: (err as Error).message, variant: 'destructive' })
    }
  }

  return (
    <div className="space-y-1.5">
      <input
        autoFocus
        aria-label={t('team.roster.card.displayName')}
        placeholder={t('team.roster.card.displayName')}
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        className={`${INPUT} w-full`}
      />
      <Select value={role} onValueChange={(v) => setRole(v as Role)}>
        <SelectTrigger className="h-8 w-full text-xs" aria-label={t('team.roster.card.lane')}><SelectValue /></SelectTrigger>
        <SelectContent>
          {ROLES.map((r) => (
            <SelectItem key={r} value={r}>
              <span className="flex items-center gap-1.5">
                <RoleGlyph role={r} className="h-3.5 w-3.5 text-hextech-gold" />
                {t(`team.roster.roles.${r}`, { defaultValue: r })}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex gap-1">
        <Button size="sm" className="flex-1" onClick={save}>
          <Save className="mr-1 h-3 w-3" />{t('team.roster.card.save')}
        </Button>
        <Button size="sm" variant="outline" aria-label={t('common.cancel')} onClick={onCancel}>
          <X className="h-3 w-3" />
        </Button>
      </div>
    </div>
  )
}
