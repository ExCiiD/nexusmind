import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Copy, Loader2, LogOut, Plus, Star, Trash2, UserMinus, Users } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/useToast'
import { collabErrorKey, type Group, type GroupKind, type GroupRole } from '@/lib/collab'
import { cn } from '@/lib/utils'
import { ASSIGNABLE_ROLES, canChangeRoles, canEditCalendar, isLegacyStaff } from '@/lib/permissions'
import { GroupLogo, GroupLogoEditor } from '@/components/Coaching/GroupLogo'
import { useActiveGroupStore } from '@/store/useActiveGroupStore'
import { useUserStore } from '@/store/useUserStore'
import { parseRiotIdInput } from '@/lib/groupTeamSyncCore'

interface Props {
  groups: Group[]
  /** The group picked in the page header: the one shown in detail. */
  active: Group | null
  myUserId: string
  reload: () => Promise<void>
}

/** Every group in one block: three rows visible, the rest scrolls. A row
 *  picks the group for the whole page (and Stats collectives). */
function GroupList({ groups, active }: { groups: Group[]; active: Group | null }) {
  const { t } = useTranslation()
  const setGroupId = useActiveGroupStore((s) => s.setGroupId)
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="h-5 w-5 text-hextech-gold" />{t('coaching.groups.mine', { count: groups.length })}
        </CardTitle>
        <CardDescription>{t('coaching.groups.mineDesc')}</CardDescription>
      </CardHeader>
      <CardContent>
        {/* 3 rows of 3rem + 2 gaps of 0.375rem; more groups scroll inside. */}
        <ul className="max-h-[9.75rem] space-y-1.5 overflow-y-auto pr-1">
          {groups.map((g) => {
            const on = g.id === active?.id
            return (
              <li key={g.id}>
                <button
                  type="button"
                  onClick={() => setGroupId(g.id)}
                  aria-pressed={on}
                  className={cn(
                    'flex h-12 w-full items-center gap-3 rounded-lg border px-3 text-left text-sm transition-colors',
                    on ? 'border-hextech-gold bg-hextech-gold/10' : 'border-hextech-border-dim hover:bg-hextech-elevated',
                  )}
                >
                  <GroupLogo group={g} className="h-8 w-8" />
                  <span className={cn('min-w-0 flex-1 truncate font-medium', on ? 'text-hextech-gold-bright' : 'text-hextech-text-bright')}>{g.name}</span>
                  <span className="shrink-0 rounded bg-hextech-elevated px-2 py-0.5 text-xs text-hextech-text-dim">{t(`coaching.kinds.${g.kind}`)}</span>
                  <span className="shrink-0 rounded bg-hextech-gold/10 px-2 py-0.5 text-xs text-hextech-gold">{t(`coaching.roles.${g.myRole}`)}</span>
                  <span className="w-20 shrink-0 text-right font-mono text-[11px] text-hextech-text-dim">{t('coaching.groups.memberCount', { count: g.members.length })}</span>
                </button>
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}

export function GroupsSection({ groups, active, myUserId, reload }: Props) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [name, setName] = useState('')
  const [kind, setKind] = useState<GroupKind>('team')
  const [code, setCode] = useState('')
  // The Riot account the group will know this member by: the app's own on
  // desktop, typed on the web (which has none).
  const user = useUserStore((s) => s.user)
  const localRiotId = user?.summonerName && user.tagLine ? `${user.summonerName}#${user.tagLine}` : null
  const [typedRiotId, setTypedRiotId] = useState('')
  const joinRiotId = localRiotId ?? parseRiotIdInput(typedRiotId)
  const [busy, setBusy] = useState<string | null>(null)
  const [invites, setInvites] = useState<Record<string, string>>({})
  const [inviteRole, setInviteRole] = useState<Record<string, Exclude<GroupRole, 'owner'>>>({})

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key)
    try { await fn() } catch (err) {
      toast({ title: t(collabErrorKey(err)), variant: 'destructive' })
    } finally { setBusy(null) }
  }

  const create = () => run('create', async () => {
    await window.api.collabCreateGroup(name.trim(), kind)
    setName('')
    await reload()
  })

  const join = () => run('join', async () => {
    if (!joinRiotId) throw new Error('RIOT_ACCOUNT_REQUIRED')
    await window.api.collabJoin(code.trim(), localRiotId ? null : joinRiotId)
    setCode('')
    setTypedRiotId('')
    toast({ title: t('coaching.groups.joined'), variant: 'gold' })
    await reload()
  })

  const invite = (g: Group) => run(`invite-${g.id}`, async () => {
    const c = await window.api.collabCreateInvite(g.id, inviteRole[g.id] ?? 'player', 7)
    setInvites((prev) => ({ ...prev, [g.id]: c }))
  })

  const sharing = (g: Group, patch: Partial<Group['sharing']>) => run(`share-${g.id}`, async () => {
    await window.api.collabSetSharing(g.id, { ...g.sharing, ...patch })
    await reload()
  })

  const roleLabel = (r: GroupRole) => t(`coaching.roles.${r}`)

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-hextech-gold" />{t('coaching.groups.title')}
          </CardTitle>
          <CardDescription>{t('coaching.groups.desc')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) create() }}>
            <div className="text-sm font-medium text-hextech-text-bright">{t('coaching.groups.create')}</div>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder={t('coaching.groups.namePlaceholder')} />
            <div className="flex gap-2">
              <Select value={kind} onValueChange={(v) => setKind(v as GroupKind)}>
                <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="team">{t('coaching.kinds.team')}</SelectItem>
                  <SelectItem value="coaching">{t('coaching.kinds.coaching')}</SelectItem>
                </SelectContent>
              </Select>
              <Button type="submit" disabled={!name.trim() || busy !== null} className="gap-1">
                {busy === 'create' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                {t('common.create')}
              </Button>
            </div>
          </form>
          <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (code.trim() && joinRiotId) join() }}>
            <div className="text-sm font-medium text-hextech-text-bright">{t('coaching.groups.join')}</div>
            <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={16} placeholder="ABCD2345EF" />
            {localRiotId ? (
              <p className="text-xs text-hextech-text-dim">{t('coaching.groups.joinAs', { riotId: localRiotId })}</p>
            ) : (
              <div className="space-y-1">
                <Input value={typedRiotId} onChange={(e) => setTypedRiotId(e.target.value)} maxLength={40} placeholder={t('coaching.groups.riotIdPlaceholder')} aria-label={t('coaching.groups.riotIdLabel')} />
                <p className={cn('text-xs', typedRiotId && !joinRiotId ? 'text-hextech-red' : 'text-hextech-text-dim')}>{t(typedRiotId && !joinRiotId ? 'coaching.groups.riotIdInvalid' : 'coaching.groups.riotIdHint')}</p>
              </div>
            )}
            <Button type="submit" variant="outline" disabled={!code.trim() || !joinRiotId || busy !== null}>
              {busy === 'join' && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              {t('coaching.groups.joinButton')}
            </Button>
          </form>
        </CardContent>
      </Card>

      {groups.length > 0 && <GroupList groups={groups} active={active} />}

      {/* The group picked (here or in the page header) in detail. */}
      {active && [active].map((g) => {
        // Inviting (create_group_invite RPC) is still is_group_staff-gated —
        // a manager would see this UI but get a server-side 403 otherwise.
        const staff = isLegacyStaff(g.myRole)
        const management = canEditCalendar(g.myRole, !!g.members.find((m) => m.userId === myUserId)?.isCaptain)
        return (
          <Card key={g.id}>
            <CardHeader className="pb-2">
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                <GroupLogo group={g} className="h-9 w-9" />
                {g.name}
                <span className="rounded bg-hextech-elevated px-2 py-0.5 text-xs text-hextech-text-dim">{t(`coaching.kinds.${g.kind}`)}</span>
                <span className="rounded bg-hextech-gold/10 px-2 py-0.5 text-xs text-hextech-gold">{roleLabel(g.myRole)}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {management && <GroupLogoEditor group={g} onChanged={reload} />}
              <ul className="divide-y divide-hextech-border-dim rounded-lg border border-hextech-border-dim text-sm">
                {g.members.map((m) => (
                  <li key={m.userId} className="flex items-center justify-between gap-2 px-3 py-2">
                    <span className="truncate text-hextech-text-bright">
                      {m.displayName || m.riotId || '—'}
                      {m.userId === myUserId && <span className="ml-1 text-xs text-hextech-text-dim">({t('coaching.comments.you')})</span>}
                    </span>
                    <span className="flex items-center gap-2 text-xs text-hextech-text-dim">
                      {canChangeRoles(g.myRole) && m.role !== 'owner' && m.userId !== myUserId ? (
                        <Select
                          value={m.role}
                          disabled={busy !== null}
                          onValueChange={(v) => run(`role-${m.userId}`, async () => {
                            await window.api.collabSetMemberRole(g.id, m.userId, v as Exclude<GroupRole, 'owner'>)
                            await reload()
                            toast({ title: t('coaching.groups.roleChanged', { name: m.displayName || m.riotId || '—', role: roleLabel(v as GroupRole) }) })
                          })}
                        >
                          <SelectTrigger className="h-7 w-32 text-xs" aria-label={t('coaching.groups.changeRole', { name: m.displayName || m.riotId || '—' })}>
                            {busy === `role-${m.userId}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <SelectValue />}
                          </SelectTrigger>
                          <SelectContent>
                            {ASSIGNABLE_ROLES.map((r) => <SelectItem key={r} value={r}>{roleLabel(r)}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      ) : roleLabel(m.role)}
                      {g.myRole === 'owner' ? (
                        <button
                          title={m.isCaptain ? t('coaching.groups.unsetCaptain') : t('coaching.groups.setCaptain')}
                          onClick={() => run(`captain-${m.userId}`, async () => { await window.api.collabSetCaptain(g.id, m.userId, !m.isCaptain); await reload() })}
                        >
                          <Star className={cn('h-3.5 w-3.5', m.isCaptain ? 'fill-hextech-gold text-hextech-gold' : 'hover:text-hextech-gold')} />
                        </button>
                      ) : m.isCaptain && (
                        <Star className="h-3.5 w-3.5 fill-hextech-gold text-hextech-gold" />
                      )}
                      {g.myRole === 'owner' && m.userId !== myUserId && (
                        <button title={t('coaching.groups.remove')} onClick={() => run(`rm-${m.userId}`, async () => { await window.api.collabRemoveMember(g.id, m.userId); await reload() })}>
                          <UserMinus className="h-3.5 w-3.5 hover:text-[#E24C3A]" />
                        </button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>

              {staff && (
                <div className="flex flex-wrap items-center gap-2">
                  <Select value={inviteRole[g.id] ?? 'player'} onValueChange={(v) => setInviteRole((p) => ({ ...p, [g.id]: v as Exclude<GroupRole, 'owner'> }))}>
                    <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="player">{roleLabel('player')}</SelectItem>
                      <SelectItem value="analyst">{roleLabel('analyst')}</SelectItem>
                      {g.myRole === 'owner' && <SelectItem value="coach">{roleLabel('coach')}</SelectItem>}
                      {g.myRole === 'owner' && <SelectItem value="manager">{roleLabel('manager')}</SelectItem>}
                    </SelectContent>
                  </Select>
                  <Button size="sm" variant="outline" onClick={() => invite(g)} disabled={busy !== null}>
                    {busy === `invite-${g.id}` && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                    {t('coaching.groups.invite')}
                  </Button>
                  {invites[g.id] && (
                    <span className="flex items-center gap-2 rounded border border-hextech-gold/40 px-2 py-1 font-mono text-sm text-hextech-gold">
                      {invites[g.id]}
                      <button title={t('coaching.groups.copy')} onClick={() => { navigator.clipboard.writeText(invites[g.id]); toast({ title: t('coaching.groups.copied') }) }}>
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  )}
                  {invites[g.id] && <span className="text-xs text-hextech-text-dim">{t('coaching.groups.inviteHint')}</span>}
                </div>
              )}

              {g.myRole !== 'owner' && (
                <div className="space-y-2 rounded-lg border border-hextech-border-dim p-3">
                  <div className="text-sm font-medium text-hextech-text-bright">{t('coaching.sharing.title')}</div>
                  {([
                    ['shareReviews', 'coaching.sharing.reviews'],
                    ['shareStats', 'coaching.sharing.stats'],
                    ['shareTeam', 'coaching.sharing.team'],
                    ['shareWellbeing', 'coaching.sharing.wellbeing'],
                  ] as const).map(([key, label]) => (
                    <label key={key} className="flex items-center justify-between gap-3 text-sm text-hextech-text">
                      <span>{t(label)}</span>
                      <Switch checked={g.sharing[key]} disabled={busy !== null} onCheckedChange={(v) => sharing(g, { [key]: v })} />
                    </label>
                  ))}
                  <p className="text-xs text-hextech-text-dim">{t('coaching.sharing.hint')}</p>
                </div>
              )}

              <div className="flex justify-end">
                {g.myRole === 'owner' ? (
                  <Button size="sm" variant="ghost" className="gap-1 text-[#E24C3A]" disabled={busy !== null}
                    onClick={() => { if (window.confirm(t('coaching.groups.deleteConfirm', { name: g.name }))) run(`del-${g.id}`, async () => { await window.api.collabDeleteGroup(g.id, 'DELETE'); await reload() }) }}>
                    <Trash2 className="h-3.5 w-3.5" />{t('coaching.groups.delete')}
                  </Button>
                ) : (
                  <Button size="sm" variant="ghost" className="gap-1" disabled={busy !== null}
                    onClick={() => run(`leave-${g.id}`, async () => { await window.api.collabLeave(g.id); await reload() })}>
                    <LogOut className="h-3.5 w-3.5" />{t('coaching.groups.leave')}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
