import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/useToast'
import { UserPlus, Trash2, Edit2, Save, X, Shield, Wand2 } from 'lucide-react'
import type { Team, TeamMember } from '@/lib/ipc'
import { BulkImportModal } from './BulkImportModal'

const ROLES = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'] as const
type Role = (typeof ROLES)[number]

const ROLE_COLORS: Record<Role, string> = {
  TOP: 'bg-red-500/20 text-red-300 border-red-500/30',
  JUNGLE: 'bg-green-500/20 text-green-300 border-green-500/30',
  MID: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
  ADC: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  SUPPORT: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
}

interface RosterTabProps {
  team: Team | null
  loading: boolean
  onChange: () => void
}

export function RosterTab({ team, loading, onChange }: RosterTabProps) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [addingRole, setAddingRole] = useState<Role | null>(null)
  const [bulkImportOpen, setBulkImportOpen] = useState(false)
  const [form, setForm] = useState({
    displayName: '', ign: '', tagLine: '', region: 'EUW1', role: 'TOP' as Role,
  })

  if (loading) return <Card className="p-6 text-center text-hextech-text-dim">Loading…</Card>
  if (!team) {
    return (
      <Card className="p-6 text-center text-hextech-text-dim">
        {t('team.roster.noTeam', { defaultValue: 'Create a team above to start adding members.' })}
      </Card>
    )
  }

  const members = team.members ?? []
  const byRole: Record<Role, TeamMember | undefined> = {
    TOP: members.find((m) => m.role === 'TOP'),
    JUNGLE: members.find((m) => m.role === 'JUNGLE'),
    MID: members.find((m) => m.role === 'MID'),
    ADC: members.find((m) => m.role === 'ADC'),
    SUPPORT: members.find((m) => m.role === 'SUPPORT'),
  }

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
      setForm({ displayName: '', ign: '', tagLine: '', region: 'EUW1', role: 'TOP' })
      onChange()
      toast({ title: t('team.roster.memberAdded', { defaultValue: 'Member added' }) })
    } catch (err) {
      toast({ title: 'Failed to add member', description: (err as Error).message, variant: 'destructive' })
    }
  }

  const handleRemove = async (memberId: string) => {
    if (!confirm(t('team.roster.confirmRemove', { defaultValue: 'Remove this member from the roster?' }))) return
    try {
      await window.api.removeTeamMember(memberId)
      onChange()
    } catch (err) {
      toast({ title: 'Failed to remove member', description: (err as Error).message, variant: 'destructive' })
    }
  }

  return (
    <div className="space-y-3">
      {/* Top action bar — bulk import is the marquee action for fast setup */}
      <div className="flex justify-end gap-2">
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

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        {ROLES.map((role) => {
          const member = byRole[role]
          return (
            <Card key={role} className="p-4 flex flex-col gap-2 min-h-[180px]">
              <div className="flex items-center justify-between">
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-bold uppercase tracking-wider ${ROLE_COLORS[role]}`}>
                  <Shield className="h-3 w-3" />
                  {role}
                </span>
                {member && (
                  <button
                    onClick={() => handleRemove(member.id)}
                    title="Remove"
                    className="text-hextech-text-dim hover:text-red-400 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              {member ? (
                editingId === member.id ? (
                  <MemberEditForm
                    member={member}
                    onSave={() => { setEditingId(null); onChange() }}
                    onCancel={() => setEditingId(null)}
                  />
                ) : (
                  <>
                    <div className="flex-1">
                      <h3 className="text-base font-bold text-hextech-text-bright">{member.displayName}</h3>
                      {member.ign && (
                        <p className="text-xs text-hextech-text-dim mt-0.5 truncate">
                          {member.ign}{member.tagLine ? `#${member.tagLine}` : ''}
                        </p>
                      )}
                      {member.region && (
                        <p className="text-[10px] text-hextech-text-dim uppercase tracking-wider mt-0.5">{member.region}</p>
                      )}
                    </div>
                    <Button size="sm" variant="outline" className="w-full" onClick={() => setEditingId(member.id)}>
                      <Edit2 className="h-3 w-3 mr-1" />
                      Edit
                    </Button>
                  </>
                )
              ) : (
                <>
                  <div className="flex-1 flex items-center justify-center text-xs text-hextech-text-dim italic">
                    {t('team.roster.empty', { defaultValue: 'Empty slot' })}
                  </div>
                  {addingRole === role ? (
                    <div className="space-y-1.5">
                      <input
                        autoFocus
                        placeholder="Display name"
                        value={form.displayName}
                        onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
                        className="w-full bg-hextech-dark border border-hextech-border rounded px-2 py-1 text-xs"
                      />
                      <div className="flex gap-1">
                        <input
                          placeholder="IGN"
                          value={form.ign}
                          onChange={(e) => setForm((f) => ({ ...f, ign: e.target.value }))}
                          className="flex-1 bg-hextech-dark border border-hextech-border rounded px-2 py-1 text-xs"
                        />
                        <input
                          placeholder="Tag"
                          value={form.tagLine}
                          onChange={(e) => setForm((f) => ({ ...f, tagLine: e.target.value }))}
                          className="w-12 bg-hextech-dark border border-hextech-border rounded px-2 py-1 text-xs"
                        />
                      </div>
                      <div className="flex gap-1">
                        <Button size="sm" className="flex-1" onClick={() => { setForm((f) => ({ ...f, role })); handleAdd() }}>
                          <Save className="h-3 w-3 mr-1" />Save
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => { setAddingRole(null); setForm({ displayName: '', ign: '', tagLine: '', region: 'EUW1', role: 'TOP' }) }}>
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button size="sm" variant="outline" className="w-full" onClick={() => { setAddingRole(role); setForm((f) => ({ ...f, role })) }}>
                      <UserPlus className="h-3 w-3 mr-1" />
                      Add
                    </Button>
                  )}
                </>
              )}
            </Card>
          )
        })}
      </div>
    </div>
  )
}

function MemberEditForm({ member, onSave, onCancel }: {
  member: TeamMember
  onSave: () => void
  onCancel: () => void
}) {
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
      toast({ title: 'Failed to update', description: (err as Error).message, variant: 'destructive' })
    }
  }

  return (
    <div className="space-y-1.5">
      <input
        autoFocus
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        className="w-full bg-hextech-dark border border-hextech-border rounded px-2 py-1 text-xs"
      />
      <div className="flex gap-1">
        <input
          placeholder="IGN"
          value={ign}
          onChange={(e) => setIgn(e.target.value)}
          className="flex-1 bg-hextech-dark border border-hextech-border rounded px-2 py-1 text-xs"
        />
        <input
          placeholder="Tag"
          value={tagLine}
          onChange={(e) => setTagLine(e.target.value)}
          className="w-12 bg-hextech-dark border border-hextech-border rounded px-2 py-1 text-xs"
        />
      </div>
      <div className="flex gap-1">
        <Button size="sm" className="flex-1" onClick={save}>
          <Save className="h-3 w-3 mr-1" />Save
        </Button>
        <Button size="sm" variant="outline" onClick={onCancel}>
          <X className="h-3 w-3" />
        </Button>
      </div>
    </div>
  )
}
