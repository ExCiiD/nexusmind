import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useToast } from '@/hooks/useToast'
import { Plus, Trash2, RefreshCw, Loader2, UserPlus, Eye, Wand2, BarChart3, Link2, Monitor, FileText } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { opponentKeyOf } from '@/lib/analyst'
import { OpponentDossierPage } from '@/components/analyst/OpponentDossierPage'
import { EmptyState } from '@/components/ui/data-state'
import { cn } from '@/lib/utils'
import { useChampionIconUrl } from '@/hooks/useChampionIconUrl'
import { compareByRole, ROLES, type Role } from '@/lib/championRoles'
import type { Team, TeamMember, ChampionPoolEntry, TeamSynergyStats } from '@/lib/ipc'
import { BulkImportModal } from './BulkImportModal'
import { DashboardLayout } from './DashboardLayout'
import { PanelErrorBoundary } from '@/components/PanelErrorBoundary'
import { ScopeDialog, type FetchScope } from '@/components/team/ScopeDialog'
import { useBackgroundJobsStore } from '@/store/useBackgroundJobsStore'
import { wrText } from '@/lib/winrate'
import { riotErrorText } from '@/lib/riotErrors'
import { useCollab } from '@/hooks/useCollab'
import { ScoutProgressBanner } from '@/components/team/ScoutProgressBanner'
import { isSessionExpiredMessage, scoutErrorKind, type ScoutLive, type ScoutLiveMember } from '@/store/scoutLive'
import { isWebApp } from '@/lib/isWebApp'
import type { ScoutPoolEntry } from '@/lib/scoutEngine'
import { isLegacyStaff } from '@/lib/permissions'
import type { PublishedDossier } from '@/lib/organisation'


/** `groupId`: the group picked in the section header — only its opponents
 *  are listed, plus the unassigned ones (local teams created before #7,
 *  `groupId === null`), shown apart with a button to attach them to this
 *  group. The web adapter is group-scoped already: its teams carry no
 *  `groupId` field and are all the group's. */
export function ScoutingTab({ groupId }: { groupId?: string }) {
  const { t } = useTranslation()
  const { groups } = useCollab()
  const groupHere = groups.find((g) => g.id === groupId)
  // The manager keeps the full Scouting (docs/AUDIT_LIAISONS.md, contract #49); only players and captains get the published dossiers.
  const isStaffHere = !groupHere || isLegacyStaff(groupHere.myRole, groupHere.myStaffRoles) || groupHere.myRole === 'manager'
  const [searchParams, setSearchParams] = useSearchParams()
  const { toast } = useToast()
  const [opponents, setOpponents] = useState<Team[]>([])
  const [loading, setLoading] = useState(true)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [pendingDelete, setPendingDelete] = useState<Team | null>(null)
  // Scope dialog state — discriminated by `kind` so a single dialog can
  // back both single-member scouting and team-wide scout-all flows.
  // `null` = closed. The `onConfirm` callback is built when the dialog
  // opens so it captures the right member / team in its closure.
  const [scopeRequest, setScopeRequest] = useState<
    | { kind: 'one'; member: TeamMember }
    | { kind: 'all'; team: Team }
    | null
  >(null)

  // Subscribe to global jobs so the row-level spinner reflects scouts in
  // progress even after the user navigates away and back. `currentName`
  // on a scoutAll job tells us which member is being processed RIGHT NOW.
  const scoutingMemberId = useBackgroundJobsStore(
    (s) => s.jobs.find((j) => j.kind === 'scoutAll' || j.kind === 'scoutOne')?.currentName ?? null,
  )
  // Lookup-by-displayName is fragile if names collide, but scoutingMemberId
  // is purely cosmetic (drives a spinner) and the team UI guarantees
  // unique display names per team. Worst case both rows spin briefly.
  const startScoutOneJob = useBackgroundJobsStore((s) => s.runScoutOne)
  const startScoutAllJob = useBackgroundJobsStore((s) => s.runScoutAll)
  const cancelJob = useBackgroundJobsStore((s) => s.cancelJob)
  const dismissScoutLive = useBackgroundJobsStore((s) => s.dismissScoutLive)
  // Progressive scout of the active team (lives in the store: it keeps going when the tab is left, and shows again on return).
  const liveScout = useBackgroundJobsStore((s) => (activeId ? s.scoutLive[activeId] : undefined))
  const liveJobId = useBackgroundJobsStore((s) => s.jobs.find((j) => j.scoutId && liveScout && j.scoutId === liveScout.scoutId)?.id ?? null)
  const resumeScout = useBackgroundJobsStore((s) => s.resumeScout)

  const load = async () => {
    setLoading(true)
    try {
      const list = await window.api.listTeams(groupId ? { isOpponent: true, groupId, includeUnassigned: true } : { isOpponent: true })
      setOpponents(list)
      if (!activeId && list.length > 0) setActiveId((list.find((o) => o.groupId !== null) ?? list[0]).id)
    } catch (err) {
      console.error('[ScoutingTab] Failed to load:', err)
    } finally {
      setLoading(false)
    }
  }

  // On mount and on a group change (the parent also remounts on group change):
  // load() picks the first opponent when none is active yet.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [groupId])

  const handleCreate = async () => {
    if (!newName.trim()) return
    try {
      const team = await window.api.createTeam({ name: newName.trim(), isOpponent: true, groupId })
      setNewName('')
      setCreating(false)
      setActiveId(team.id)
      await load()
    } catch (err) {
      toast({ title: t('team.scouting.createFailed'), description: (err as Error).message, variant: 'destructive' })
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await window.api.deleteTeam(id)
      if (activeId === id) setActiveId(null)
      await load()
    } catch (err) {
      toast({ title: t('team.scouting.deleteFailed'), description: (err as Error).message, variant: 'destructive' })
    }
  }

  const activeTeam = opponents.find((o) => o.id === activeId) ?? null
  const groupOpponents = opponents.filter((o) => o.groupId !== null)
  const unassigned = opponents.filter((o) => o.groupId === null)
  const canLink = !!groupId && typeof window.api.linkTeamToGroup === 'function'
  const [linking, setLinking] = useState<string | null>(null)

  const handleLink = async (team: Team) => {
    if (!groupId) return
    setLinking(team.id)
    try {
      await window.api.linkTeamToGroup(team.id, groupId)
      await load()
      // The chip moved from the "unassigned" block to the group's list: keep
      // keyboard focus on it instead of losing it with the removed button.
      setTimeout(() => {
        document.querySelector<HTMLButtonElement>(`[data-opponent-chip="${team.id}"]`)?.focus()
      }, 0)
    } catch (err) {
      toast({ title: t('team.scouting.linkFailed'), description: (err as Error).message, variant: 'destructive' })
    } finally {
      setLinking(null)
    }
  }

  const teamChip = (team: Team) => (
    <div
      key={team.id}
      className={cn(
        'rounded-md text-sm font-medium transition-colors group flex items-center',
        team.id === activeId
          ? 'bg-hextech-red/20 text-hextech-red border border-hextech-red/40'
          : 'bg-white/5 text-hextech-text hover:bg-white/10',
      )}
    >
      <button
        type="button"
        data-opponent-chip={team.id}
        onClick={() => setActiveId(team.id)}
        aria-pressed={team.id === activeId}
        className="flex items-center gap-1 pl-3 pr-1 py-1 rounded-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <Eye className="h-3 w-3" aria-hidden />
        {team.name}
      </button>
      <button
        type="button"
        onClick={() => setPendingDelete(team)}
        aria-label={t('team.scouting.deleteTeamAria', { name: team.name })}
        className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity hover:text-hextech-red pr-2 py-1 rounded-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <Trash2 className="h-3 w-3" aria-hidden />
      </button>
    </div>
  )

  /** Opens the scope picker for a single member's scout. The actual API
   *  call runs in `runScoutOne` once the user picks Quick vs Complete. */
  const handleScout = (memberId: string) => {
    const team = opponents.find((o) => o.id === activeId)
    const member = team?.members?.find((m) => m.id === memberId)
    if (!member) return
    if (!member.ign || !member.tagLine || !member.region) {
      toast({
        title: t('team.scouting.noRiotId', { defaultValue: 'Missing Riot ID' }),
        description: t('team.scouting.noRiotIdDesc', { defaultValue: 'Add IGN, tag, and region before scouting.' }),
        variant: 'destructive',
      })
      return
    }
    setScopeRequest({ kind: 'one', member })
  }

  const runScoutOne = async (member: TeamMember, scope: FetchScope) => {
    await startScoutOneJob({
      label: t('team.scouting.scoutOneJobLabel', {
        defaultValue: 'Scout — {{name}}',
        name: member.displayName,
      }),
      member,
      teamId: activeId ?? undefined,
      scope,
      onDone: ({ upserted, cancelled, rateLimited, failed, errorMessage }) => {
        if (cancelled) { load(); return }
        if (rateLimited || failed) {
          // Never the raw message: the translated text of its class (the banner shows the same).
          const e = scoutErrorKind(errorMessage)
          toast({
            title: t('team.scouting.scoutFailed', { defaultValue: 'Scouting failed' }),
            description: rateLimited ? riotErrorText(rateLimited, t) : t(`team.scouting.live.err.${e.kind === 'rateLimited' && isWebApp() ? 'rateLimitedWeb' : e.kind}`, { bad: e.bad ?? 0, of: e.of ?? 0 }),
            variant: 'destructive',
          })
          load()
          return
        }
        toast({
          title: t('team.scouting.done', { defaultValue: 'Scouting complete' }),
          description: t('team.scouting.scoutOneDoneDesc', { count: upserted }),
        })
        load()
      },
    })
  }

  /** Opens the scope picker for the whole team's scout. */
  const handleScoutAll = (team: Team) => {
    const eligible = (team.members ?? []).filter((m) => m.ign && m.tagLine && m.region)
    if (eligible.length === 0) {
      toast({
        title: t('team.scouting.noEligible', { defaultValue: 'No scoutable members' }),
        description: t('team.scouting.noEligibleDesc', {
          defaultValue: 'Each member needs IGN, tag line, and region before they can be scouted.',
        }),
        variant: 'destructive',
      })
      return
    }
    setScopeRequest({ kind: 'all', team })
  }

  const runScoutAll = async (team: Team, scope: FetchScope) => {
    const eligible = (team.members ?? []).filter((m) => m.ign && m.tagLine && m.region)
    const skipped = (team.members ?? []).length - eligible.length
    await startScoutAllJob({
      label: t('team.scouting.scoutAllJobLabel', {
        defaultValue: 'Scout — {{team}}',
        team: team.name,
      }),
      members: eligible,
      teamId: team.id,
      scope,
      onDone: ({ ok, upserted, cancelled, failed, rateLimited }) => {
        if (cancelled) {
          toast({
            title: t('team.scouting.scoutCancelled', { defaultValue: 'Scout cancelled' }),
            description: t('team.scouting.scoutCancelledDesc', {
              defaultValue: '{{ok}} member(s) scouted before stopping · {{upserted}} entries.',
              ok,
              upserted,
            }),
          })
          load()
          return
        }
        load()
        if (failed.length === 0) {
          toast({
            title: t('team.scouting.allDone', { defaultValue: 'Scouted all {{count}} members', count: ok }),
            description: t('team.scouting.allDoneDesc', {
              defaultValue: '{{champions}} champion entries · {{skipped}} skipped (missing Riot ID)',
              champions: upserted,
              skipped,
            }),
          })
        } else {
          toast({
            title: t('team.scouting.partial', { defaultValue: '{{ok}}/{{total}} scouted', ok, total: eligible.length }),
            description: rateLimited ? riotErrorText(rateLimited, t) : t('team.scouting.partialDesc', {
              defaultValue: 'Failed: {{names}}',
              names: failed.join(', '),
            }),
            variant: 'destructive',
          })
        }
      },
    })
  }

  // #40 · 3/3: « Dossier » opens a full-width page over the scouting screen, its key kept in the URL.
  const dossierKey = searchParams.get('dossier')
  const setDossier = (key: string | null) => setSearchParams((prev) => {
    const next = new URLSearchParams(prev)
    if (key) next.set('dossier', key); else next.delete('dossier')
    return next
  })
  if (groupId && dossierKey) {
    const name = groupOpponents.find((x) => opponentKeyOf(x.name) === dossierKey)?.name ?? dossierKey
    return <OpponentDossierPage key={dossierKey} groupId={groupId} opponentKey={dossierKey} opponentName={name} onBack={() => setDossier(null)} />
  }

  // § 18.4: a member who is not staff (player, captain) sees the published dossiers only, read only.
  if (groupId && !isStaffHere) {
    return <PublishedDossiers groupId={groupId} onOpen={setDossier} />
  }

  return (
    <div className="space-y-3">
      {/* Opponent team selector + create */}
      <Card className="p-3 flex items-center gap-2 flex-wrap">
        <span className="text-xs uppercase tracking-wider text-hextech-text-dim font-semibold">{t('team.scouting.opponentsLabel')}</span>
        {groupOpponents.length === 0 && !loading && (
          <span className="text-sm text-hextech-text-dim italic">
            {t('team.scouting.empty', { defaultValue: 'No opponent teams scouted yet.' })}
          </span>
        )}
        {groupOpponents.map(teamChip)}
        {creating ? (
          <div className="flex items-center gap-1">
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreate()
                else if (e.key === 'Escape') { setCreating(false); setNewName('') }
              }}
              placeholder={t('team.scouting.newTeamPlaceholder')}
              aria-label={t('team.scouting.newTeamPlaceholder')}
              className="bg-hextech-dark border border-hextech-border rounded px-2 py-1 text-sm"
            />
            <Button size="sm" onClick={handleCreate}>{t('team.scouting.add')}</Button>
          </div>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
            <Plus className="h-3 w-3 mr-1" />
            {t('team.scouting.newOpponent')}
          </Button>
        )}
      </Card>

      {unassigned.length > 0 && (
        <Card className="p-3 space-y-2 border-dashed" aria-labelledby="scouting-unassigned-title">
          <div>
            <h3 id="scouting-unassigned-title" className="font-mono text-xs uppercase tracking-wider text-hextech-text-dim">
              {t('team.scouting.unassignedTitle', { count: unassigned.length })}
            </h3>
            <p className="text-xs text-hextech-text-dim">{t('team.scouting.unassignedHint')}</p>
          </div>
          <ul className="flex flex-wrap gap-2">
            {unassigned.map((team) => (
              <li key={team.id} className="flex items-center gap-1">
                {teamChip(team)}
                {canLink && <Button
                  size="sm"
                  variant="outline"
                  disabled={linking !== null}
                  onClick={() => handleLink(team)}
                  aria-label={t('team.scouting.linkAria', { name: team.name })}
                >
                  {linking === team.id
                    ? <Loader2 className="h-3 w-3 mr-1 animate-spin" aria-hidden />
                    : <Link2 className="h-3 w-3 mr-1" aria-hidden />}
                  {t('team.scouting.link')}
                </Button>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <ConfirmDialog
        open={pendingDelete != null}
        onOpenChange={(open) => { if (!open) setPendingDelete(null) }}
        title={t('team.scouting.deleteTeamTitle', { name: pendingDelete?.name ?? '' })}
        description={t('team.scouting.deleteTeamDesc')}
        onConfirm={() => { if (pendingDelete) void handleDelete(pendingDelete.id) }}
      />

      {activeTeam ? (
        <OpponentDetail
          team={activeTeam}
          onChange={load}
          scoutingMemberName={scoutingMemberId}
          onScout={handleScout}
          onScoutAll={() => handleScoutAll(activeTeam)}
          live={liveScout}
          onCancelLive={() => { if (liveJobId) cancelJob(liveJobId) }}
          onDismissLive={() => dismissScoutLive(activeTeam.id)}
          onResumeLive={() => { void resumeScout(activeTeam.id, load) }}
          onOpenDossier={groupId ? () => setDossier(opponentKeyOf(activeTeam.name)) : undefined}
        />
      ) : (
        <Card className="p-6 text-center text-hextech-text-dim">
          {t('team.scouting.selectPrompt', { defaultValue: 'Select or create an opponent team to start scouting.' })}
        </Card>
      )}

      {scopeRequest && (
        <ScopeDialog
          open
          playerCount={
            scopeRequest.kind === 'one'
              ? 1
              : (scopeRequest.team.members ?? []).filter((m) => m.ign && m.tagLine && m.region).length
          }
          actionLabel={
            scopeRequest.kind === 'one'
              ? t('team.scouting.scopeTitleOne', {
                  defaultValue: 'Scout {{name}} — how thorough?',
                  name: scopeRequest.member.displayName,
                })
              : t('team.scouting.scopeTitleAll', {
                  defaultValue: 'Scout all opponents — how thorough?',
                })
          }
          onCancel={() => setScopeRequest(null)}
          onConfirm={(scope) => {
            const req = scopeRequest
            setScopeRequest(null)
            if (req.kind === 'one') runScoutOne(req.member, scope)
            else runScoutAll(req.team, scope)
          }}
        />
      )}
    </div>
  )
}

function OpponentDetail({ team, onChange, scoutingMemberName, onScout, onScoutAll, onOpenDossier, live, onCancelLive, onDismissLive, onResumeLive }: {
  team: Team
  /** Progressive scout of this team (running or just finished), if any. */
  live?: ScoutLive
  onCancelLive: () => void
  onDismissLive: () => void
  onResumeLive?: () => void
  onChange: () => void
  /** Display name of the member currently being scouted by ANY active
   *  background job. Used for row-level spinner. Null when nothing is
   *  running. */
  scoutingMemberName: string | null
  onScout: (memberId: string) => void
  onScoutAll: () => void
  /** #40: opens the opponent's dossier (group scouting only). */
  onOpenDossier?: () => void
}) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [addingMember, setAddingMember] = useState(false)
  const [bulkImportOpen, setBulkImportOpen] = useState(false)
  const [autoScoutAfterImport, setAutoScoutAfterImport] = useState(true)
  const [pendingRemove, setPendingRemove] = useState<TeamMember | null>(null)
  const [form, setForm] = useState({
    displayName: '', ign: '', tagLine: '', region: 'EUW1', role: 'TOP' as Role,
  })

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
      setAddingMember(false)
      setForm({ displayName: '', ign: '', tagLine: '', region: 'EUW1', role: 'TOP' })
      onChange()
    } catch (err) {
      toast({ title: t('team.scouting.addMemberFailed'), description: riotErrorText(err, t), variant: 'destructive' })
    }
  }

  const handleRemove = async (memberId: string) => {
    try {
      await window.api.removeTeamMember(memberId)
      onChange()
    } catch (err) {
      toast({ title: t('team.scouting.removeMemberFailed'), description: (err as Error).message, variant: 'destructive' })
    }
  }

  const members = team.members ?? []
  const byRole = ROLES.map((role) => ({
    role,
    member: members.find((m) => m.role === role),
  }))

  return (
    <div className="space-y-3">
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-bold text-hextech-text-bright">{team.name}</h3>
          {addingMember ? (
            <div className="flex items-center gap-1 flex-wrap">
              <input
                placeholder={t('team.scouting.form.displayName')}
                aria-label={t('team.scouting.form.displayName')}
                value={form.displayName}
                onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
                className="bg-hextech-dark border border-hextech-border rounded px-2 py-1 text-xs w-24"
              />
              <input
                placeholder="IGN"
                aria-label="IGN"
                value={form.ign}
                onChange={(e) => setForm((f) => ({ ...f, ign: e.target.value }))}
                className="bg-hextech-dark border border-hextech-border rounded px-2 py-1 text-xs w-24"
              />
              <input
                placeholder={t('team.scouting.form.tag')}
                aria-label={t('team.scouting.form.tag')}
                value={form.tagLine}
                onChange={(e) => setForm((f) => ({ ...f, tagLine: e.target.value }))}
                className="bg-hextech-dark border border-hextech-border rounded px-2 py-1 text-xs w-16"
              />
              <select
                value={form.region}
                aria-label={t('team.scouting.form.region')}
                onChange={(e) => setForm((f) => ({ ...f, region: e.target.value }))}
                className="bg-hextech-dark border border-hextech-border rounded px-1 py-1 text-xs"
              >
                <option value="EUW1">EUW</option>
                <option value="EUN1">EUNE</option>
                <option value="NA1">NA</option>
                <option value="KR">KR</option>
                <option value="BR1">BR</option>
                <option value="LA1">LAN</option>
                <option value="LA2">LAS</option>
                <option value="OC1">OCE</option>
                <option value="TR1">TR</option>
                <option value="RU">RU</option>
                <option value="JP1">JP</option>
              </select>
              <select
                value={form.role}
                aria-label={t('team.scouting.form.role')}
                onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as Role }))}
                className="bg-hextech-dark border border-hextech-border rounded px-1 py-1 text-xs"
              >
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
              <Button size="sm" onClick={handleAdd}>{t('team.scouting.save')}</Button>
              <Button size="sm" variant="outline" onClick={() => setAddingMember(false)}>{t('common.cancel')}</Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1 text-[10px] text-hextech-text-dim cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoScoutAfterImport}
                  onChange={(e) => setAutoScoutAfterImport(e.target.checked)}
                  className="accent-hextech-gold"
                />
                {t('team.scouting.autoScout', { defaultValue: 'Auto-scout on import' })}
              </label>
              <Button size="sm" variant="outline" onClick={() => setBulkImportOpen(true)}>
                <Wand2 className="h-3 w-3 mr-1" />
                {t('team.roster.bulkImport', { defaultValue: 'Import from multi-link' })}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setAddingMember(true)}>
                <UserPlus className="h-3 w-3 mr-1" aria-hidden />{t('team.scouting.addMember')}
              </Button>
              {onOpenDossier && (
                <Button size="sm" variant="outline" onClick={onOpenDossier}>
                  <FileText className="h-3 w-3 mr-1" aria-hidden />{t('analyst.dossier.open')}
                </Button>
              )}
              <Button
                size="sm"
                variant="default"
                onClick={onScoutAll}
                disabled={!!scoutingMemberName || members.length === 0}
                title={t('team.scouting.scoutAllHint', {
                  defaultValue: 'Re-fetch the full season match history (up to 500 games) for every opponent in parallel. ~15s on first scout, near-instant after.',
                })}
              >
                {scoutingMemberName
                  ? <Loader2 className="h-3 w-3 mr-1 animate-spin" aria-hidden />
                  : <RefreshCw className="h-3 w-3 mr-1" />}
                {scoutingMemberName
                  ? t('team.scouting.scoutingMember', { defaultValue: 'Scouting…' })
                  : t('team.scouting.scoutAll', { defaultValue: 'Scout all ({{count}})', count: members.length })}
              </Button>
            </div>
          )}
        </div>

        {live && (
          <div className="mb-3">
            <ScoutProgressBanner live={live} onCancel={onCancelLive} onDismiss={onDismissLive} onRetry={onResumeLive} />
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
          {byRole.map(({ role, member }) => (
            <div key={role} className="border border-hextech-border rounded p-2 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-hextech-text-dim">{role}</span>
                {member && (
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => onScout(member.id)}
                      disabled={!!scoutingMemberName}
                      title={t('team.scouting.scoutOneHint')}
                      aria-label={t('team.scouting.scoutOneAria', { name: member.displayName })}
                      className="text-hextech-gold hover:text-hextech-gold-bright disabled:opacity-30"
                    >
                      {(scoutingMemberName === member.displayName || live?.members[member.id]?.status === 'running') ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <RefreshCw className="h-3 w-3" aria-hidden />}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingRemove(member)}
                      aria-label={t('team.scouting.removeMemberAria', { name: member.displayName })}
                      className="text-hextech-text-dim hover:text-hextech-red"
                    >
                      <Trash2 className="h-3 w-3" aria-hidden />
                    </button>
                  </div>
                )}
              </div>
              {member ? (
                <>
                  <p className="text-xs font-semibold text-hextech-text-bright truncate">{member.displayName}</p>
                  {member.ign && (
                    <p className="text-[10px] text-hextech-text-dim truncate">
                      {member.ign}{member.tagLine ? `#${member.tagLine}` : ''}
                    </p>
                  )}
                  <MemberPoolPreview member={member} live={live?.members[member.id]} version={live?.finishedAt ?? 0} />
                </>
              ) : (
                <p className="text-[10px] text-hextech-text-dim italic text-center py-3">{t('team.scouting.emptySlot')}</p>
              )}
            </div>
          ))}
        </div>
      </Card>

      <ConfirmDialog
        open={pendingRemove != null}
        onOpenChange={(open) => { if (!open) setPendingRemove(null) }}
        title={t('team.scouting.removeMemberTitle', { name: pendingRemove?.displayName ?? '' })}
        confirmLabel={t('team.scouting.removeMemberConfirm')}
        onConfirm={() => { if (pendingRemove) void handleRemove(pendingRemove.id) }}
      />

      {/* The synergy fetch runs in the desktop app (Riot match history per player); the web adapter has no such call. */}
      {typeof window.api.computeTeamSynergyStats === 'function' ? (
        <PanelErrorBoundary label="Opponent synergy">
          <OpponentSynergyPanel team={team} />
        </PanelErrorBoundary>
      ) : (
        <EmptyState
          icon={Monitor}
          title={t('team.scouting.synergy.desktopOnlyTitle')}
          description={t('team.scouting.synergy.desktopOnlyDesc')}
        />
      )}

      <BulkImportModal
        open={bulkImportOpen}
        onClose={() => setBulkImportOpen(false)}
        defaultRegion="EUW1"
        title={t('team.scouting.importTitle', { defaultValue: 'Import opponents from multi-link' })}
        description={t('team.scouting.importDesc', {
          defaultValue: 'Paste an op.gg / blitz.gg multisearch URL — each player will be added to this opponent team and (optionally) auto-scouted.',
        })}
        onImport={async (p) => {
          const member = await window.api.addTeamMember(team.id, {
            displayName: p.gameName,
            ign: p.gameName,
            tagLine: p.tagLine || undefined,
            region: p.region,
            role: p.role,
          })
          // Auto-scout right after add (opponents are scouted by default —
          // that's the whole point of bulk-importing them).
          if (autoScoutAfterImport && p.tagLine) {
            try {
              await window.api.scoutMember(member.id, 100)
            } catch (err) {
              // Don't fail the import on a scout error — the member is added
              // and the user can retry the scout manually.
              console.warn('[ScoutingTab] Auto-scout failed for', p.gameName, err)
            }
          }
          onChange()
        }}
      />
    </div>
  )
}

/** The progressive scout's pool, in the shape of the stored one (playRate = games), so one aggregation serves both. */
function livePoolAsEntries(member: TeamMember, pool: ScoutPoolEntry[]): ChampionPoolEntry[] {
  return pool.map((e) => ({
    id: `live-${e.championKey}-${e.role}`, memberId: member.id, championKey: e.championKey, role: e.role, tier: e.tier,
    playRate: e.games, winRate: e.winRate, masteryPoints: e.masteryPoints, updatedAt: '',
  }))
}

/** 142 300 → « 142k » (mastery points shown on a mastery-only champion, which has no game yet). */
function shortPoints(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)
}

function MemberPoolPreview({ member, live, version = 0 }: { member: TeamMember; live?: ScoutLiveMember; version?: number }) {
  const { t } = useTranslation()
  const [pool, setPool] = useState<ChampionPoolEntry[]>([])
  const liveActive = !!live && live.poolSource !== 'none' && (live.status === 'mastery' || live.status === 'running' || live.status === 'done')

  // `version` changes when a scout finishes: the pools written at member-done are read again.
  useEffect(() => {
    let cancelled = false
    window.api.listChampionPool(member.id)
      .then((res) => { if (!cancelled) setPool(res) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [member.id, version])

  // IMPORTANT: this useMemo MUST run on every render, even when pool is
  // empty — otherwise we hit React error #310 ("Rendered more hooks than
  // during the previous render") because the early return below would
  // skip the hook on first render, then trigger it after pool loads.
  // Aggregate by championKey across ALL roles so the displayed game count
  // matches op.gg ("Aatrox 84 games") instead of just the assigned-role
  // subset ("Aatrox TOP 19 games").
  const shown = useMemo(() => (liveActive && live ? livePoolAsEntries(member, live.pool) : pool), [liveActive, live, member, pool])
  const aggregated = useMemo(() => {
    const byChamp = new Map<string, { championKey: string; games: number; wins: number; primaryRole: string; primaryGames: number; mastery: number }>()
    for (const e of shown) {
      const games = e.playRate ?? 0
      const wins = e.winRate != null ? Math.round((e.winRate / 100) * games) : 0
      const cur = byChamp.get(e.championKey)
      if (cur) {
        cur.games += games
        cur.wins += wins
        cur.mastery = Math.max(cur.mastery, e.masteryPoints ?? 0)
        if (games > cur.primaryGames) {
          cur.primaryGames = games
          cur.primaryRole = e.role
        }
      } else {
        byChamp.set(e.championKey, {
          championKey: e.championKey,
          games,
          wins,
          primaryRole: e.role,
          primaryGames: games,
          mastery: e.masteryPoints ?? 0,
        })
      }
    }
    return Array.from(byChamp.values())
      .sort((a, b) => b.games - a.games || b.mastery - a.mastery)
      .slice(0, 5)
  }, [shown])

  const status = live && live.status !== 'waiting' ? live : null
  const pct = live && live.total > 0 ? Math.min(100, Math.round((live.processed / live.total) * 100)) : 0
  const provisional = !!live && (live.status === 'mastery' || live.status === 'running')

  return (
    <div className="space-y-0.5 mt-1">
      {shown.length === 0 ? (
        live?.status === 'waiting' || live?.status === 'mastery' || live?.status === 'running'
          ? <p className="text-[9px] text-hextech-text-dim italic mt-1">{t('team.scouting.live.memberWaiting')}</p>
          : <p className="text-[9px] text-hextech-text-dim italic mt-1">{t('team.scouting.noPoolData')}</p>
      ) : (
        <>
          <p className="text-[9px] uppercase tracking-wider text-hextech-text-dim">
            {t('team.scouting.topN', { n: aggregated.length })}
            {provisional && <span className="ml-1 normal-case italic text-hextech-gold/80" title={t('team.scouting.live.provisionalHint')}>· {live?.poolSource === 'mastery' ? t('team.scouting.live.byMastery') : t('team.scouting.live.partial')}</span>}
          </p>
          <div className="flex gap-0.5 flex-wrap">
            {aggregated.map((e) => (
              <TinyChampIcon
                key={e.championKey}
                championKey={e.championKey}
                count={e.games}
                label={e.games === 0 && e.mastery > 0 ? shortPoints(e.mastery) : undefined}
                wins={e.wins}
                role={e.primaryRole}
              />
            ))}
          </div>
        </>
      )}
      {status && (
        <div className="space-y-0.5" data-scout-member-status={status.status}>
          {status.status === 'running' && (
            <>
              <div className="h-1 bg-black/40 rounded overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={t('team.scouting.live.memberBarAria', { name: member.displayName })}>
                <div className="h-full bg-hextech-gold transition-all duration-300" style={{ width: `${pct}%` }} />
              </div>
              <p className="text-[9px] text-hextech-text-dim font-mono">{t('team.scouting.live.memberGames', { done: status.processed, total: status.total })}</p>
            </>
          )}
          {status.status === 'mastery' && <p className="text-[9px] text-hextech-text-dim italic">{t('team.scouting.live.memberListing')}</p>}
          {status.status === 'done' && (status.totalMatches ?? 0) === 0 && (
            <p className="text-[9px] text-hextech-text-dim italic">{t('team.scouting.live.memberNoGames')}</p>
          )}
          {status.status === 'done' && (status.totalMatches ?? 0) > 0 && (
            <p className="text-[9px] text-emerald-400">
              {t('team.scouting.live.memberDone', { count: status.totalMatches ?? status.total })}
              {status.unreadable > 0 && <span className="text-amber-300"> · {t('team.scouting.live.memberUnreadable', { count: status.unreadable })}</span>}
            </p>
          )}
          {status.status === 'cancelled' && <p className="text-[9px] text-amber-300">{t('team.scouting.live.memberCancelled')}</p>}
          {status.status === 'error' && (
            <p className="text-[9px] text-hextech-red">
              {status.errorCode === 'RIOT_RATE_LIMITED' ? t('team.scouting.live.memberRateLimited') : isSessionExpiredMessage(status.errorMessage) ? t('team.scouting.live.memberSession') : t('team.scouting.live.memberFailed')}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Synergy-stats panel for an opponent team — mirrors the StatsFlexTab from
 * the active-team view, but applied to opponents.
 *
 * Aggregates flex queue games where ≥minTogether opponent members played
 * on the same side (`team:compute-synergy-stats` works on any team ID, no
 * dedicated opponent handler needed). Real synergy data — no approximation
 * disclaimer required. The per-champion winrates the user actually scouts
 * still come from each member's individual season pool (`scoutMember` +
 * MemberPoolPreview above), which keeps the cheap-to-compute SoloQ-only
 * data for that.
 *
 * Cached per (team, minTogether) like StatsFlexTab so toggling the filter
 * doesn't re-hit Riot.
 */
function OpponentSynergyPanel({ team }: { team: Team }) {
  const { t, i18n } = useTranslation()
  const { toast } = useToast()
  const [stats, setStats] = useState<TeamSynergyStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [minTogether, setMinTogether] = useState(3)

  const cacheKey = `nexusmind:opponentSynergy:${team.id}`
  const loadCachedFor = (n: number): TeamSynergyStats | null => {
    try {
      const raw = localStorage.getItem(cacheKey)
      if (!raw) return null
      const map = JSON.parse(raw) as Record<string, TeamSynergyStats>
      return map[String(n)] ?? null
    } catch { return null }
  }
  const saveCachedFor = (n: number, s: TeamSynergyStats) => {
    try {
      const raw = localStorage.getItem(cacheKey)
      const map = raw ? (JSON.parse(raw) as Record<string, TeamSynergyStats>) : {}
      map[String(n)] = s
      localStorage.setItem(cacheKey, JSON.stringify(map))
    } catch { /* quota */ }
  }

  // Hydrate from cache on team change OR when the user toggles minTogether.
  // Showing stale data immediately + a "refresh to update" hint is better
  // UX than a blank screen during the long Riot fetch.
  useEffect(() => {
    const cached = loadCachedFor(minTogether)
    setStats(cached)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [team.id, minTogether])

  const handleRefresh = async () => {
    setLoading(true)
    try {
      const res = await window.api.computeTeamSynergyStats(team.id, { minTogether })
      setStats(res)
      saveCachedFor(minTogether, res)
      if (res.matchCount === 0) {
        toast({
          title: t('team.scouting.synergy.noGames', { defaultValue: 'No synergy games found' }),
          description: t('team.scouting.synergy.noGamesDesc', {
            defaultValue: 'No recent flex games where ≥{{n}} of these opponents played together.',
            n: minTogether,
          }),
        })
      } else {
        toast({
          title: t('team.scouting.synergy.done', { defaultValue: 'Opponent synergy ready' }),
          description: t('team.scouting.synergy.doneDesc', {
            defaultValue: '{{matches}} flex games · {{members}} players with data',
            matches: res.matchCount,
            members: res.membersWithGames,
          }),
        })
      }
    } catch (err) {
      toast({
        title: t('team.scouting.synergy.failed', { defaultValue: 'Opponent synergy failed' }),
        description: riotErrorText(err, t),
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  const sortedPlayers = useMemo(() => stats ? [...stats.players].sort(compareByRole) : [], [stats])
  const membersWithIds = (team.members ?? []).filter((m) => m.ign && m.tagLine && m.region).length

  return (
    <div className="space-y-3">
      <Card className="p-3 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-hextech-gold" />
          <span className="text-sm text-hextech-text">
            {t('team.scouting.synergy.title', {
              defaultValue: 'Opponent synergy — flex games where ≥{{n}} of them played together',
              n: minTogether,
            })}
          </span>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-hextech-text-dim">
            {t('team.scouting.synergy.minTogether', { defaultValue: 'Min together:' })}
            <select
              value={minTogether}
              onChange={(e) => setMinTogether(Number(e.target.value))}
              disabled={loading}
              className="bg-hextech-dark border border-hextech-border rounded px-2 py-1 text-xs"
            >
              <option value={2}>2</option>
              <option value={3}>3</option>
              <option value={4}>4</option>
              <option value={5}>5</option>
            </select>
          </label>

          {stats && (
            <span className="text-[10px] text-hextech-text-dim italic">
              {t('team.scouting.synergy.lastUpdate', { defaultValue: 'Updated' })}: {new Date(stats.fetchedAt).toLocaleTimeString(i18n.language)}
            </span>
          )}
          <Button
            size="sm"
            onClick={handleRefresh}
            disabled={loading || membersWithIds < minTogether}
            title={membersWithIds < minTogether
              ? `Need ${minTogether} members with Riot IDs (have ${membersWithIds})`
              : undefined}
          >
            {loading
              ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" aria-hidden />
              : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
            {loading
              ? t('team.scouting.synergy.computing', { defaultValue: 'Computing…' })
              : stats
                ? t('team.scouting.synergy.refresh', { defaultValue: 'Refresh' })
                : t('team.scouting.synergy.compute', { defaultValue: 'Compute synergy' })}
          </Button>
        </div>
      </Card>

      {!stats && !loading && (
        <Card className="p-6 text-center text-hextech-text-dim">
          <BarChart3 className="h-8 w-8 mx-auto opacity-40" />
          <p className="mt-3 text-sm">
            {t('team.scouting.synergy.emptyHint', {
              defaultValue: 'Click "Compute synergy" to find flex games where these opponents have queued together.',
            })}
          </p>
          <p className="mt-1 text-[10px] text-hextech-text-dim/70">
            {t('team.scouting.synergy.cacheHint', {
              defaultValue: 'First run can be slow; results are cached locally for next time.',
            })}
          </p>
        </Card>
      )}

      {loading && !stats && (
        <Card className="p-6 text-center text-hextech-text-dim">
          <Loader2 className="h-8 w-8 mx-auto animate-spin text-hextech-gold" aria-hidden />
          <p className="mt-3 text-sm">
            {t('team.scouting.synergy.computingDesc', {
              defaultValue: 'Fetching flex games for every opponent — usually ~10s.',
            })}
          </p>
        </Card>
      )}

      {stats && stats.matchCount > 0 && (
        <DashboardLayout
          players={sortedPlayers}
          matchCount={stats.matchCount}
          basedOnLabel={t('team.scouting.synergy.basedOn', {
            defaultValue: 'Real flex stats from {{n}} games where ≥{{min}} opponents played together',
            n: stats.matchCount,
            min: minTogether,
          })}
        />
      )}

      {stats && stats.matchCount === 0 && (
        <Card className="p-6 text-center text-hextech-text-dim">
          {t('team.scouting.synergy.noGamesDesc', {
            defaultValue: 'No recent flex games where ≥{{n}} of these opponents played together.',
            n: minTogether,
          })}
        </Card>
      )}
    </div>
  )
}

function TinyChampIcon({ championKey, count, wins, role, label }: {
  championKey: string
  count: number
  /** Replaces the count badge (mastery points when no game is known yet). */
  label?: string
  wins?: number
  role?: string
}) {
  const iconUrl = useChampionIconUrl(championKey)
  const wr = wins != null && count > 0 ? Math.round((wins / count) * 100) : null
  const wrColor = wr == null ? '' : wrText(wr, count)
  return (
    <div
      className="relative"
      title={`${championKey} — ${count} games${wr != null ? ` (${wr}% WR)` : ''}${role ? ` · ${role}` : ''}`}
    >
      {iconUrl && <img src={iconUrl} alt={championKey} className="h-7 w-7 rounded" />}
      {/* Game count pinned bottom-right, slightly larger so it actually
          reads at scouting distance. */}
      <span className="absolute -bottom-0.5 -right-0.5 text-[9px] bg-black/85 text-hextech-gold px-0.5 rounded font-mono leading-tight">
        {label ?? count}
      </span>
      {/* WR pinned top-right, colored by performance. Only shown when we
          have win data — saves visual noise for manually-added entries. */}
      {wr != null && (
        <span className={cn('absolute -top-0.5 -right-0.5 text-[8px] bg-black/85 px-0.5 rounded font-mono leading-tight font-bold', wrColor)}>
          {wr}
        </span>
      )}
    </div>
  )
}

/**
 * § 18.4: the opponent dossiers the staff published (§ 12), newest first (opponentDossierListPublished) — name / tag,
 * « Publié le 19 nov. par Coach Sora », the record against us. A click opens the dossier, read only
 * (OpponentDossierPage, no refresh).
 */
function PublishedDossiers({ groupId, onOpen }: { groupId: string; onOpen: (key: string) => void }) {
  const { t, i18n } = useTranslation()
  const { nameOf } = useCollab()
  const [list, setList] = useState<PublishedDossier[] | null>(null)
  useEffect(() => {
    let alive = true
    setList(null)
    window.api.opponentDossierListPublished(groupId)
      .then((l) => { if (alive) setList(l) })
      .catch(() => { if (alive) setList([]) })
    return () => { alive = false }
  }, [groupId])

  if (!list) return <div className="h-24 animate-pulse rounded-lg bg-hextech-elevated/60" aria-busy />
  if (list.length === 0) return <EmptyState icon={FileText} title={t('scoutingPlayer.empty')} />
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {list.map((d) => (
        <button key={d.opponentKey} type="button" onClick={() => onOpen(d.opponentKey)}
          className="space-y-1 rounded-lg border border-hextech-border-dim bg-hextech-dark/50 p-4 text-left transition-colors hover:border-hextech-border hover:bg-hextech-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hextech-gold">
          <p className="flex items-center gap-2">
            {d.tag && <span className="rounded bg-hextech-gold/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-hextech-gold">{d.tag}</span>}
            <span className="truncate text-sm font-semibold text-hextech-text-bright">{d.name}</span>
          </p>
          <p className="text-xs text-hextech-text-dim">
            {t('scoutingPlayer.published', {
              date: new Date(d.publishedAt).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short' }),
              name: d.publishedByName ?? (d.publishedBy ? nameOf(d.publishedBy) : '—'),
            })}
          </p>
          {(d.record.wins + d.record.losses) > 0 && (
            <p className="font-mono text-xs text-hextech-text">{t('scoutingPlayer.record', { wins: d.record.wins, losses: d.record.losses })}</p>
          )}
        </button>
      ))}
    </div>
  )
}
