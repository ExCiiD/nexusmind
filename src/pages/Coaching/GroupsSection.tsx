import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Copy, Loader2, LogOut, Plus, Trash2, UserMinus, Users } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/useToast'
import { collabErrorKey, type Group, type GroupKind, type GroupRole } from '@/lib/collab'

interface Props {
  groups: Group[]
  myUserId: string
  reload: () => Promise<void>
}

export function GroupsSection({ groups, myUserId, reload }: Props) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [name, setName] = useState('')
  const [kind, setKind] = useState<GroupKind>('team')
  const [code, setCode] = useState('')
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
    await window.api.collabJoin(code.trim())
    setCode('')
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
          <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (code.trim()) join() }}>
            <div className="text-sm font-medium text-hextech-text-bright">{t('coaching.groups.join')}</div>
            <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={16} placeholder="ABCD2345EF" />
            <Button type="submit" variant="outline" disabled={!code.trim() || busy !== null}>
              {busy === 'join' && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              {t('coaching.groups.joinButton')}
            </Button>
          </form>
        </CardContent>
      </Card>

      {groups.map((g) => {
        const staff = g.myRole !== 'player'
        return (
          <Card key={g.id}>
            <CardHeader className="pb-2">
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                {g.name}
                <span className="rounded bg-hextech-elevated px-2 py-0.5 text-xs text-hextech-text-dim">{t(`coaching.kinds.${g.kind}`)}</span>
                <span className="rounded bg-hextech-gold/10 px-2 py-0.5 text-xs text-hextech-gold">{roleLabel(g.myRole)}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <ul className="divide-y divide-hextech-border-dim rounded-lg border border-hextech-border-dim text-sm">
                {g.members.map((m) => (
                  <li key={m.userId} className="flex items-center justify-between gap-2 px-3 py-2">
                    <span className="truncate text-hextech-text-bright">
                      {m.displayName || m.riotId || '—'}
                      {m.userId === myUserId && <span className="ml-1 text-xs text-hextech-text-dim">({t('coaching.comments.you')})</span>}
                    </span>
                    <span className="flex items-center gap-2 text-xs text-hextech-text-dim">
                      {roleLabel(m.role)}
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
