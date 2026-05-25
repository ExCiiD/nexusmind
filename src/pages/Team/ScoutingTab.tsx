import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/useToast'
import { Plus, Trash2, RefreshCw, Loader2, UserPlus, Eye, Wand2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useChampionIconUrl } from '@/hooks/useChampionIconUrl'
import type { Team, TeamMember, ChampionPoolEntry } from '@/lib/ipc'
import { BulkImportModal } from './BulkImportModal'

const ROLES = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'] as const

export function ScoutingTab() {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [opponents, setOpponents] = useState<Team[]>([])
  const [loading, setLoading] = useState(true)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [scoutingMemberId, setScoutingMemberId] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const list = await window.api.listTeams({ isOpponent: true })
      setOpponents(list)
      if (!activeId && list.length > 0) setActiveId(list[0].id)
    } catch (err) {
      console.error('[ScoutingTab] Failed to load:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [])

  const handleCreate = async () => {
    if (!newName.trim()) return
    try {
      const team = await window.api.createTeam({ name: newName.trim(), isOpponent: true })
      setNewName('')
      setCreating(false)
      setActiveId(team.id)
      await load()
    } catch (err) {
      toast({ title: 'Failed to create opponent team', description: (err as Error).message, variant: 'destructive' })
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this opponent team?')) return
    try {
      await window.api.deleteTeam(id)
      if (activeId === id) setActiveId(null)
      await load()
    } catch (err) {
      toast({ title: 'Failed to delete', description: (err as Error).message, variant: 'destructive' })
    }
  }

  const activeTeam = opponents.find((o) => o.id === activeId) ?? null

  const handleScout = async (memberId: string) => {
    setScoutingMemberId(memberId)
    try {
      const res = await window.api.scoutMember(memberId, 30)
      toast({
        title: t('team.scouting.done', { defaultValue: 'Scouting complete' }),
        description: `${res.upserted} champion entries from last ${res.totalMatches ?? '?'} matches.`,
      })
      await load()
    } catch (err) {
      toast({
        title: t('team.scouting.failed', { defaultValue: 'Scouting failed' }),
        description: (err as Error).message,
        variant: 'destructive',
      })
    } finally {
      setScoutingMemberId(null)
    }
  }

  // Sequentially scout every member of a team. Done one at a time to stay
  // friendly with Riot's per-call rate limits (each scout already triggers
  // ~30+ match fetches in parallel internally). Surfaces per-member progress
  // through `scoutingMemberId` so the row spinner reflects who is being
  // fetched right now.
  const handleScoutAll = async (team: Team) => {
    const eligible = (team.members ?? []).filter((m) => m.ign && m.tagLine && m.region)
    const skipped = (team.members ?? []).length - eligible.length
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
    let ok = 0
    let totalChampions = 0
    let failed: string[] = []
    for (const member of eligible) {
      setScoutingMemberId(member.id)
      try {
        const res = await window.api.scoutMember(member.id, 30)
        totalChampions += res.upserted
        ok++
      } catch (err) {
        console.warn('[ScoutingTab] scout failed for', member.displayName, err)
        failed.push(member.displayName)
      }
    }
    setScoutingMemberId(null)
    await load()
    if (failed.length === 0) {
      toast({
        title: t('team.scouting.allDone', { defaultValue: 'Scouted all {{count}} members', count: ok }),
        description: t('team.scouting.allDoneDesc', {
          defaultValue: '{{champions}} champion entries · {{skipped}} skipped (missing Riot ID)',
          champions: totalChampions,
          skipped,
        }),
      })
    } else {
      toast({
        title: t('team.scouting.partial', { defaultValue: '{{ok}}/{{total}} scouted', ok, total: eligible.length }),
        description: t('team.scouting.partialDesc', {
          defaultValue: 'Failed: {{names}}',
          names: failed.join(', '),
        }),
        variant: 'destructive',
      })
    }
  }

  return (
    <div className="space-y-3">
      {/* Opponent team selector + create */}
      <Card className="p-3 flex items-center gap-2 flex-wrap">
        <span className="text-xs uppercase tracking-wider text-hextech-text-dim font-semibold">Opponents:</span>
        {opponents.length === 0 && !loading && (
          <span className="text-sm text-hextech-text-dim italic">
            {t('team.scouting.empty', { defaultValue: 'No opponent teams scouted yet.' })}
          </span>
        )}
        {opponents.map((team) => (
          <button
            key={team.id}
            onClick={() => setActiveId(team.id)}
            className={cn(
              'px-3 py-1 rounded-md text-sm font-medium transition-colors group flex items-center gap-1',
              team.id === activeId
                ? 'bg-red-500/20 text-red-300 border border-red-500/40'
                : 'bg-white/5 text-hextech-text hover:bg-white/10',
            )}
          >
            <Eye className="h-3 w-3" />
            {team.name}
            <button
              onClick={(e) => { e.stopPropagation(); handleDelete(team.id) }}
              className="opacity-0 group-hover:opacity-100 transition-opacity hover:text-red-400 ml-1"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </button>
        ))}
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
              placeholder="Opponent team name…"
              className="bg-hextech-dark border border-hextech-border rounded px-2 py-1 text-sm"
            />
            <Button size="sm" onClick={handleCreate}>Add</Button>
          </div>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
            <Plus className="h-3 w-3 mr-1" />
            New opponent
          </Button>
        )}
      </Card>

      {activeTeam ? (
        <OpponentDetail
          team={activeTeam}
          onChange={load}
          scoutingMemberId={scoutingMemberId}
          onScout={handleScout}
          onScoutAll={() => handleScoutAll(activeTeam)}
        />
      ) : (
        <Card className="p-6 text-center text-hextech-text-dim">
          {t('team.scouting.selectPrompt', { defaultValue: 'Select or create an opponent team to start scouting.' })}
        </Card>
      )}
    </div>
  )
}

function OpponentDetail({ team, onChange, scoutingMemberId, onScout, onScoutAll }: {
  team: Team
  onChange: () => void
  scoutingMemberId: string | null
  onScout: (memberId: string) => void
  onScoutAll: () => void
}) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [addingMember, setAddingMember] = useState(false)
  const [bulkImportOpen, setBulkImportOpen] = useState(false)
  const [autoScoutAfterImport, setAutoScoutAfterImport] = useState(true)
  const [form, setForm] = useState({
    displayName: '', ign: '', tagLine: '', region: 'EUW1', role: 'TOP' as typeof ROLES[number],
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
      toast({ title: 'Failed to add', description: (err as Error).message, variant: 'destructive' })
    }
  }

  const handleRemove = async (memberId: string) => {
    if (!confirm('Remove this opponent member?')) return
    try {
      await window.api.removeTeamMember(memberId)
      onChange()
    } catch (err) {
      toast({ title: 'Failed to remove', description: (err as Error).message, variant: 'destructive' })
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
                placeholder="Display"
                value={form.displayName}
                onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
                className="bg-hextech-dark border border-hextech-border rounded px-2 py-1 text-xs w-24"
              />
              <input
                placeholder="IGN"
                value={form.ign}
                onChange={(e) => setForm((f) => ({ ...f, ign: e.target.value }))}
                className="bg-hextech-dark border border-hextech-border rounded px-2 py-1 text-xs w-24"
              />
              <input
                placeholder="Tag"
                value={form.tagLine}
                onChange={(e) => setForm((f) => ({ ...f, tagLine: e.target.value }))}
                className="bg-hextech-dark border border-hextech-border rounded px-2 py-1 text-xs w-16"
              />
              <select
                value={form.region}
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
                onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as typeof ROLES[number] }))}
                className="bg-hextech-dark border border-hextech-border rounded px-1 py-1 text-xs"
              >
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
              <Button size="sm" onClick={handleAdd}>Save</Button>
              <Button size="sm" variant="outline" onClick={() => setAddingMember(false)}>Cancel</Button>
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
                <UserPlus className="h-3 w-3 mr-1" />Add member
              </Button>
              <Button
                size="sm"
                variant="default"
                onClick={onScoutAll}
                disabled={!!scoutingMemberId || members.length === 0}
                title={t('team.scouting.scoutAllHint', {
                  defaultValue: 'Re-fetch the last ~60 games for every member of this opponent team',
                })}
              >
                {scoutingMemberId
                  ? <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  : <RefreshCw className="h-3 w-3 mr-1" />}
                {scoutingMemberId
                  ? t('team.scouting.scoutingMember', { defaultValue: 'Scouting…' })
                  : t('team.scouting.scoutAll', { defaultValue: 'Scout all ({{count}})', count: members.length })}
              </Button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
          {byRole.map(({ role, member }) => (
            <div key={role} className="border border-hextech-border rounded p-2 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-hextech-text-dim">{role}</span>
                {member && (
                  <div className="flex gap-1">
                    <button
                      onClick={() => onScout(member.id)}
                      disabled={!!scoutingMemberId}
                      title="Scout: fetch last 30 games"
                      className="text-hextech-gold hover:text-hextech-gold-bright disabled:opacity-30"
                    >
                      {scoutingMemberId === member.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                    </button>
                    <button
                      onClick={() => handleRemove(member.id)}
                      className="text-hextech-text-dim hover:text-red-400"
                    >
                      <Trash2 className="h-3 w-3" />
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
                  <MemberPoolPreview member={member} />
                </>
              ) : (
                <p className="text-[10px] text-hextech-text-dim italic text-center py-3">Empty</p>
              )}
            </div>
          ))}
        </div>
      </Card>

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
              await window.api.scoutMember(member.id, 30)
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

function MemberPoolPreview({ member }: { member: TeamMember }) {
  const [pool, setPool] = useState<ChampionPoolEntry[]>([])

  useEffect(() => {
    let cancelled = false
    window.api.listChampionPool(member.id)
      .then((res) => { if (!cancelled) setPool(res) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [member.id])

  if (pool.length === 0) {
    return <p className="text-[9px] text-hextech-text-dim italic mt-1">No data — click ⟳ to scout</p>
  }

  // Show top 5 by playRate
  const top = [...pool]
    .sort((a, b) => (b.playRate ?? 0) - (a.playRate ?? 0))
    .slice(0, 5)

  return (
    <div className="space-y-0.5 mt-1">
      <p className="text-[9px] uppercase tracking-wider text-hextech-text-dim">Top {top.length}:</p>
      <div className="flex gap-0.5 flex-wrap">
        {top.map((e) => <TinyChampIcon key={e.id} championKey={e.championKey} count={e.playRate ?? 0} />)}
      </div>
    </div>
  )
}

function TinyChampIcon({ championKey, count }: { championKey: string; count: number }) {
  const iconUrl = useChampionIconUrl(championKey)
  return (
    <div className="relative" title={`${championKey} (${count} games)`}>
      {iconUrl && <img src={iconUrl} alt={championKey} className="h-6 w-6 rounded" />}
      <span className="absolute -bottom-0.5 -right-0.5 text-[8px] bg-black/80 text-hextech-gold px-0.5 rounded font-mono leading-none">
        {count}
      </span>
    </div>
  )
}
