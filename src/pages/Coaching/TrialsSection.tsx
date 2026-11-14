import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Plus, Trash2, UserPlus } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/useToast'
import { collabErrorKey, type Group } from '@/lib/collab'
import type { SharedRosterMember } from '@/lib/team'
import type { TrialCandidate, TrialRole, TrialStatus } from '@/lib/trials'

const ROLES: TrialRole[] = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT']

/** E10 (docs/PLAN_GESTION_EQUIPE.md): trial candidates with a 1-5 evaluation grid, staff-only. */
export function TrialsSection({ staffGroups }: { staffGroups: Group[] }) {
  const { t, i18n } = useTranslation()
  const { toast } = useToast()
  const [groupId, setGroupId] = useState(staffGroups[0]?.id ?? null)
  const [candidates, setCandidates] = useState<TrialCandidate[] | null>(null)
  const [roster, setRoster] = useState<SharedRosterMember[]>([])

  const load = useCallback(async () => {
    if (!groupId) return
    setCandidates(null)
    try {
      const [list, shared] = await Promise.all([
        window.api.trialsList(groupId),
        window.api.teamGetShared(groupId).catch(() => ({ roster: [] as SharedRosterMember[] })),
      ])
      setCandidates(list)
      setRoster(shared.roster)
    } catch (err) {
      setCandidates([])
      toast({ title: t(collabErrorKey(err)), variant: 'destructive' })
    }
  }, [groupId, t, toast])

  useEffect(() => { load() }, [load])

  if (staffGroups.length === 0) return null

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <UserPlus className="h-5 w-5 text-hextech-gold" />{t('trials.title', { defaultValue: 'Trials' })}
          </CardTitle>
          {staffGroups.length > 1 && (
            <select value={groupId ?? ''} onChange={(e) => setGroupId(e.target.value)}
              className="rounded border border-hextech-border-dim bg-hextech-elevated px-2 py-1 text-xs text-hextech-text">
              {staffGroups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          )}
        </div>
        <CardDescription>{t('trials.desc', { defaultValue: 'Candidates on trial, with a 1-5 evaluation grid and the current starter for that role as reference.' })}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {groupId && <NewCandidateForm groupId={groupId} onCreated={load} />}
        {candidates === null ? (
          <Loader2 className="h-5 w-5 animate-spin text-hextech-text-dim" />
        ) : candidates.length === 0 ? (
          <p className="text-sm text-hextech-text-dim">{t('trials.none', { defaultValue: 'No trial candidates yet.' })}</p>
        ) : (
          <ul className="space-y-3">
            {candidates.map((c) => (
              <CandidateCard key={c.id} candidate={c} starters={roster.filter((m) => m.role === c.role && m.status === 'starter')} locale={i18n.language} onChanged={load} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function NewCandidateForm({ groupId, onCreated }: { groupId: string; onCreated: () => void }) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [displayName, setDisplayName] = useState('')
  const [role, setRole] = useState<TrialRole>('TOP')
  const [periodStart, setPeriodStart] = useState('')
  const [periodEnd, setPeriodEnd] = useState('')
  const [creating, setCreating] = useState(false)

  const create = async () => {
    if (!displayName.trim()) return
    setCreating(true)
    try {
      await window.api.trialsCreate(groupId, { displayName: displayName.trim(), role, periodStart: periodStart || null, periodEnd: periodEnd || null })
      setDisplayName(''); setPeriodStart(''); setPeriodEnd('')
      onCreated()
    } catch (err) { toast({ title: t(collabErrorKey(err)), variant: 'destructive' }) }
    finally { setCreating(false) }
  }

  return (
    <div className="flex flex-wrap gap-2 rounded-lg border border-hextech-border-dim p-3">
      <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={64} className="flex-1 min-w-[10rem]" placeholder={t('trials.namePlaceholder', { defaultValue: 'Candidate name…' })} />
      <Select value={role} onValueChange={(v) => setRole(v as TrialRole)}>
        <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
        <SelectContent>
          {ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
        </SelectContent>
      </Select>
      <Input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} className="w-40" aria-label={t('trials.periodStart', { defaultValue: 'Trial start' })} />
      <Input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} className="w-40" aria-label={t('trials.periodEnd', { defaultValue: 'Trial end' })} />
      <Button size="sm" onClick={create} disabled={!displayName.trim() || creating}>
        {creating && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}{t('trials.addCandidate', { defaultValue: 'Add candidate' })}
      </Button>
    </div>
  )
}

function CandidateCard({ candidate, starters, locale, onChanged }: {
  candidate: TrialCandidate; starters: SharedRosterMember[]; locale: string; onChanged: () => void
}) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [criterion, setCriterion] = useState('')
  const [score, setScore] = useState('3')
  const [adding, setAdding] = useState(false)

  const avgScore = candidate.evaluations.length > 0
    ? Math.round((candidate.evaluations.reduce((sum, e) => sum + e.score, 0) / candidate.evaluations.length) * 10) / 10
    : null

  const setStatus = async (status: TrialStatus) => {
    try { await window.api.trialsSetStatus(candidate.id, status); onChanged() }
    catch (err) { toast({ title: t(collabErrorKey(err)), variant: 'destructive' }) }
  }
  const remove = async () => {
    try { await window.api.trialsDelete(candidate.id); onChanged() }
    catch (err) { toast({ title: t(collabErrorKey(err)), variant: 'destructive' }) }
  }
  const addEval = async () => {
    if (!criterion.trim()) return
    setAdding(true)
    try {
      await window.api.trialsAddEvaluation(candidate.id, { criterion: criterion.trim(), score: Number(score) })
      setCriterion(''); setScore('3')
      onChanged()
    } catch (err) { toast({ title: t(collabErrorKey(err)), variant: 'destructive' }) }
    finally { setAdding(false) }
  }
  const removeEval = async (id: string) => {
    try { await window.api.trialsDeleteEvaluation(id); onChanged() }
    catch (err) { toast({ title: t(collabErrorKey(err)), variant: 'destructive' }) }
  }

  return (
    <li className="space-y-2 rounded-lg border border-hextech-border-dim p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="font-medium text-hextech-text-bright">{candidate.displayName}</span>
          <span className="ml-2 text-xs uppercase text-hextech-text-dim">{candidate.role}</span>
          {avgScore !== null && <span className="ml-2 text-xs text-hextech-gold">{t('trials.avgScore', { defaultValue: 'avg {{score}}/5', score: avgScore })}</span>}
          {(candidate.periodStart || candidate.periodEnd) && (
            <span className="ml-2 text-xs text-hextech-text-dim">
              {candidate.periodStart ? new Date(candidate.periodStart).toLocaleDateString(locale) : '…'} → {candidate.periodEnd ? new Date(candidate.periodEnd).toLocaleDateString(locale) : '…'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Select value={candidate.status} onValueChange={(v) => setStatus(v as TrialStatus)}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="trialing">{t('trials.status.trialing', { defaultValue: 'Trialing' })}</SelectItem>
              <SelectItem value="kept">{t('trials.status.kept', { defaultValue: 'Kept' })}</SelectItem>
              <SelectItem value="rejected">{t('trials.status.rejected', { defaultValue: 'Rejected' })}</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" variant="ghost" onClick={remove}><Trash2 className="h-3.5 w-3.5 text-hextech-text-dim" /></Button>
        </div>
      </div>

      {starters.length > 0 && (
        <p className="text-xs text-hextech-text-dim">
          {t('trials.currentStarter', { defaultValue: 'Current starter for {{role}}: {{names}}', role: candidate.role, names: starters.map((s) => s.displayName).join(', ') })}
        </p>
      )}

      {candidate.evaluations.length > 0 && (
        <ul className="space-y-1">
          {candidate.evaluations.map((e) => (
            <li key={e.id} className="flex items-center justify-between text-sm text-hextech-text">
              <span>{e.criterion}: <span className="font-medium text-hextech-gold">{e.score}/5</span>{e.note ? ` — ${e.note}` : ''}</span>
              <Button size="sm" variant="ghost" onClick={() => removeEval(e.id)}><Trash2 className="h-3.5 w-3.5 text-hextech-text-dim" /></Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <Input value={criterion} onChange={(e) => setCriterion(e.target.value)} maxLength={80} className="flex-1 min-w-[8rem]" placeholder={t('trials.criterionPlaceholder', { defaultValue: 'e.g. Macro, Communication…' })} />
        <Select value={score} onValueChange={setScore}>
          <SelectTrigger className="w-20"><SelectValue /></SelectTrigger>
          <SelectContent>
            {[1, 2, 3, 4, 5].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" onClick={addEval} disabled={!criterion.trim() || adding}>
          {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
        </Button>
      </div>
      {candidate.notes && <p className="text-xs italic text-hextech-text-dim">{candidate.notes}</p>}
    </li>
  )
}
