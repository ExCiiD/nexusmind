import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link2, Loader2, Unlink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ErrorState } from '@/components/ui/data-state'
import { useToast } from '@/hooks/useToast'
import { isLegacyStaff } from '@/lib/permissions'
import { isServerNotReadyError } from '@/lib/matchEventView'
import type { Group } from '@/lib/collab'
import type { SharedRosterMember } from '@/lib/team'

const LINK_ERRORS = ['FORBIDDEN', 'NOT_FOUND', 'NOT_A_MEMBER'] as const

/** The i18n key for a link error: server not ready, one of the RPC's codes, else generic. */
export function rosterLinkErrorKey(err: unknown): string {
  if (isServerNotReadyError(err)) return 'team.rosterLink.errors.notDeployed'
  const msg = (err as Error)?.message ?? ''
  const code = LINK_ERRORS.find((c) => msg.includes(c))
  return `team.rosterLink.errors.${code ?? 'generic'}`
}

/**
 * #46.4: the group's staff link a row of the published roster to a member of the group (for the players the publish
 * could not match by Riot ID), or unlink it. Opens from the roster's action bar, desktop and web. Hidden for non-staff
 * and before the roster_member_link migration's app (teamLinkRosterMember absent).
 */
export function RosterLinkButton({ group }: { group: Group }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  if (!window.api.teamLinkRosterMember || !isLegacyStaff(group.myRole, group.myStaffRoles)) return null
  return (
    <>
      <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setOpen(true)}>
        <Link2 className="h-3.5 w-3.5" aria-hidden />{t('team.rosterLink.open')}
      </Button>
      {open && <RosterLinkDialog group={group} onClose={() => setOpen(false)} />}
    </>
  )
}

function RosterLinkDialog({ group, onClose }: { group: Group; onClose: () => void }) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [rows, setRows] = useState<SharedRosterMember[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setFailed(false)
    try {
      const shared = await window.api.teamGetShared(group.id)
      setRows(shared.roster.filter((r) => r.scoutingId === null))
    } catch { setFailed(true); setRows([]) }
  }, [group.id])
  useEffect(() => { void load() }, [load])

  const nameOf = (userId: string) => {
    const m = group.members.find((x) => x.userId === userId)
    return m?.displayName || m?.riotId || '—'
  }
  const linked = new Set((rows ?? []).map((r) => r.userId).filter(Boolean) as string[])
  // Who can be linked: the group's members not linked to a row yet (contract #46.4), players first.
  const plays = (m: Group['members'][number]) => m.role === 'player' || !!m.alsoPlays
  const candidates = group.members.filter((m) => !linked.has(m.userId)).sort((a, b) => Number(plays(b)) - Number(plays(a)))

  const link = async (row: SharedRosterMember, userId: string | null) => {
    setBusy(row.id)
    try {
      const verified = await window.api.teamLinkRosterMember!(row.id, userId)
      // false: linked, but the member's Riot ID isn't verified yet, so the row keeps its own name and Riot ID.
      const key = !userId ? 'team.rosterLink.unlinked' : verified === false ? 'team.rosterLink.linkedUnverified' : 'team.rosterLink.linked'
      toast({ title: t(key, { row: row.displayName, name: userId ? nameOf(userId) : '' }) })
      await load()
    } catch (err) {
      toast({ title: t(rosterLinkErrorKey(err)), variant: 'destructive' })
    } finally { setBusy(null) }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{t('team.rosterLink.title')}</DialogTitle>
          <DialogDescription>{t('team.rosterLink.desc')}</DialogDescription>
        </DialogHeader>
        {rows === null ? (
          <Loader2 className="mx-auto h-5 w-5 animate-spin text-hextech-gold" aria-label={t('common.loading')} />
        ) : failed ? (
          <ErrorState title={t('team.rosterLink.loadFailed')} cause={t('team.rosterLink.errors.generic')} onRetry={() => { void load() }} />
        ) : rows.length === 0 ? (
          <p className="text-sm text-hextech-text-dim">{t('team.rosterLink.empty')}</p>
        ) : (
          <ul className="max-h-[60vh] divide-y divide-hextech-border-dim overflow-y-auto">
            {rows.map((row) => {
              const riotId = row.ign ? `${row.ign}${row.tagLine ? `#${row.tagLine}` : ''}` : null
              return (
                <li key={row.id} className="flex items-center gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-hextech-text-bright">
                      {row.displayName}
                      <span className="ml-2 font-mono text-[10px] uppercase text-hextech-text-dim">{row.role}</span>
                    </p>
                    {riotId && <p className="truncate text-xs text-hextech-text-dim">{riotId}</p>}
                  </div>
                  {busy === row.id ? (
                    <Loader2 className="h-4 w-4 animate-spin text-hextech-text-dim" aria-label={t('common.loading')} />
                  ) : row.userId ? (
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-1 text-xs text-hextech-green">
                        <Link2 className="h-3 w-3" aria-hidden />{nameOf(row.userId)}
                      </span>
                      <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => { void link(row, null) }}
                        aria-label={t('team.rosterLink.unlinkOf', { row: row.displayName })}>
                        <Unlink className="h-3 w-3" aria-hidden />{t('team.rosterLink.unlink')}
                      </Button>
                    </div>
                  ) : candidates.length === 0 ? (
                    <span className="text-xs text-hextech-text-dim">{t('team.rosterLink.noCandidate')}</span>
                  ) : (
                    <Select value="" onValueChange={(userId) => { void link(row, userId) }}>
                      <SelectTrigger className="h-8 w-48 text-xs" aria-label={t('team.rosterLink.linkOf', { row: row.displayName })}>
                        <SelectValue placeholder={t('team.rosterLink.link')} />
                      </SelectTrigger>
                      <SelectContent>
                        {candidates.map((m) => (
                          <SelectItem key={m.userId} value={m.userId}>{m.displayName || m.riotId || '—'}{m.riotId && m.displayName ? ` · ${m.riotId}` : ''}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}
