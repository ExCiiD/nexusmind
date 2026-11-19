import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useToast } from '@/hooks/useToast'
import { UserPlus, Save, X, Wand2 } from 'lucide-react'
import type { AwardHolder, Team, TeamMember } from '@/lib/ipc'
import type { MemberLook } from '@/lib/collab'
import { bestChampions, lookForMember, mainChampion, type LookSources } from '@/lib/playerCard'
import { useWeeklyAwards } from '@/hooks/useWeeklyAwards'
import { useAllChampions } from '@/hooks/useAllChampions'
import { useProfilePrefs } from '@/components/Profile/ProfileCard'
import { useUserStore } from '@/store/useUserStore'
import { useBackgroundJobsStore } from '@/store/useBackgroundJobsStore'
import type { Role } from '@/components/team/RoleIconPicker'
import { BulkImportModal } from './BulkImportModal'
import { EmptySlotCard, PlayerCard } from './PlayerCard'

const ROLES: Role[] = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT']

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

export function RosterTab({ team, loading, onChange, logoUrl, actions }: RosterTabProps) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [addingRole, setAddingRole] = useState<Role | null>(null)
  const [bulkImportOpen, setBulkImportOpen] = useState(false)
  const [form, setForm] = useState({
    displayName: '', ign: '', tagLine: '', region: 'EUW1', role: 'TOP' as Role,
  })

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
  const memberFor = (role: Role): TeamMember | undefined => members.find((m) => m.role === role)
  const resetForm = () => setForm({ displayName: '', ign: '', tagLine: '', region: 'EUW1', role: 'TOP' })

  const handleAdd = async () => {
    if (!form.displayName.trim()) return
    try {
      await window.api.addTeamMember(team.id, {
        displayName: form.displayName.trim(),
        ign: form.ign.trim() || undefined,
        tagLine: form.tagLine.trim() || undefined,
        region: form.region,
        role: form.role,
      })
      setAddingRole(null)
      resetForm()
      onChange()
      toast({ title: t('team.roster.memberAdded', { defaultValue: 'Member added' }) })
    } catch (err) {
      toast({ title: t('team.roster.card.addFailed'), description: (err as Error).message, variant: 'destructive' })
    }
  }

  const handleRemove = async (memberId: string) => {
    if (!confirm(t('team.roster.confirmRemove', { defaultValue: 'Remove this member from the roster?' }))) return
    try {
      await window.api.removeTeamMember(memberId)
      onChange()
    } catch (err) {
      toast({ title: t('team.roster.card.removeFailed'), description: (err as Error).message, variant: 'destructive' })
    }
  }

  const fetchChampions = (member: TeamMember) => {
    void runAutoFill({
      // The team name in the label lets the Champion Pool tab see the job too.
      label: t('team.roster.card.fetchJob', { team: team.name, name: member.displayName }),
      members: [member],
      scope: 'quick',
      onDone: () => onChange(),
    })
  }

  return (
    <TooltipProvider delayDuration={150}>
      <div className="space-y-3">
        {/* Top action bar — bulk import is the marquee action for fast setup */}
        <div className="flex flex-wrap justify-end gap-2">
          {actions}
          <Button size="sm" variant="outline" onClick={() => setBulkImportOpen(true)}>
            <Wand2 className="h-3.5 w-3.5 mr-1.5" />
            {t('team.roster.bulkImport', { defaultValue: 'Import from multi-link' })}
          </Button>
        </div>

        <BulkImportModal
          open={bulkImportOpen}
          onClose={() => setBulkImportOpen(false)}
          defaultRegion="EUW1"
          onImport={async (p) => {
            await window.api.addTeamMember(team.id, {
              displayName: p.gameName,
              ign: p.gameName,
              tagLine: p.tagLine || undefined,
              region: p.region,
              role: p.role,
            })
            onChange()
          }}
        />

        {/* Room between the cards for the award frames (6 % outside each card). */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-8 px-2 pt-2 sm:grid-cols-3 xl:grid-cols-5">
          {ROLES.map((role) => {
            const member = memberFor(role)
            if (member) {
              const canFetch = !!(member.ign && member.tagLine && member.region)
              return (
                <PlayerCard
                  key={role}
                  member={member}
                  role={role}
                  look={lookForMember(member, lookSources)}
                  champions={bestChampions(member.champPool)}
                  team={{ name: team.name, tag: team.tag, logoUrl }}
                  artChampion={mainChampion(member.champPool)}
                  holders={holdersOf(member.id)}
                  totals={awards?.totals[member.id]}
                  nameOf={nameOf}
                  fetching={fetching}
                  onFetch={canFetch ? () => fetchChampions(member) : null}
                  onEdit={() => setEditingId(member.id)}
                  onRemove={() => handleRemove(member.id)}
                  editForm={editingId === member.id ? (
                    <MemberEditForm
                      member={member}
                      onSave={() => { setEditingId(null); onChange() }}
                      onCancel={() => setEditingId(null)}
                    />
                  ) : undefined}
                />
              )
            }
            return (
              <EmptySlotCard key={role} role={role}>
                {addingRole === role ? (
                  <div className="space-y-1.5">
                    <input
                      autoFocus
                      placeholder={t('team.roster.card.displayName')}
                      aria-label={t('team.roster.card.displayName')}
                      value={form.displayName}
                      onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
                      className={`${INPUT} w-full`}
                    />
                    <div className="flex gap-1">
                      <input
                        placeholder={t('team.roster.card.gameName')}
                        aria-label={t('team.roster.card.gameName')}
                        value={form.ign}
                        onChange={(e) => setForm((f) => ({ ...f, ign: e.target.value }))}
                        className={`${INPUT} min-w-0 flex-1`}
                      />
                      <input
                        placeholder={t('team.roster.card.tag')}
                        aria-label={t('team.roster.card.tag')}
                        value={form.tagLine}
                        onChange={(e) => setForm((f) => ({ ...f, tagLine: e.target.value }))}
                        className={`${INPUT} w-14 shrink-0`}
                      />
                    </div>
                    <div className="flex gap-1">
                      <Button size="sm" className="flex-1" onClick={handleAdd}>
                        <Save className="mr-1 h-3 w-3" />{t('team.roster.card.save')}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={t('common.cancel')}
                        onClick={() => { setAddingRole(null); resetForm() }}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button size="sm" variant="outline" className="w-full" onClick={() => { setAddingRole(role); setForm((f) => ({ ...f, role })) }}>
                    <UserPlus className="mr-1 h-3 w-3" />
                    {t('team.roster.card.add')}
                  </Button>
                )}
              </EmptySlotCard>
            )
          })}
        </div>
      </div>
    </TooltipProvider>
  )
}

function MemberEditForm({ member, onSave, onCancel }: {
  member: TeamMember
  onSave: () => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [displayName, setDisplayName] = useState(member.displayName)
  const [ign, setIgn] = useState(member.ign ?? '')
  const [tagLine, setTagLine] = useState(member.tagLine ?? '')

  const save = async () => {
    try {
      await window.api.updateTeamMember(member.id, {
        displayName: displayName.trim(),
        ign: ign.trim() || null,
        tagLine: tagLine.trim() || null,
      })
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
      <div className="flex gap-1">
        <input
          placeholder={t('team.roster.card.gameName')}
          aria-label={t('team.roster.card.gameName')}
          value={ign}
          onChange={(e) => setIgn(e.target.value)}
          className={`${INPUT} min-w-0 flex-1`}
        />
        <input
          placeholder={t('team.roster.card.tag')}
          aria-label={t('team.roster.card.tag')}
          value={tagLine}
          onChange={(e) => setTagLine(e.target.value)}
          className={`${INPUT} w-14 shrink-0`}
        />
      </div>
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
