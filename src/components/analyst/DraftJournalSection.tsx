import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { Hourglass, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/data-state'
import { useToast } from '@/hooks/useToast'
import type { DraftLogEntry, DraftLogInput } from '@/lib/analyst'
import { DraftLogView, type DraftLogState } from './DraftLogView'
import { DraftManualDialog } from './DraftManualDialog'
import { Segmented } from './shared'
import { analystErrorText, isMissingTableError } from './analystErrors'
import { useAnalystCanEdit } from './useAnalystAccess'

/**
 * #40 · 2/3, Coaching → Draft Sim: the « Préparation » (the Draft Sim, unchanged) and « Journal » sub-tabs, the
 * choice kept in the URL (?draftView=journal). The journal adds the group's team games not logged yet (staff, once
 * per opening), reads the log, and saves the analyst's notes.
 */
export function DraftSimSection({ groupId, preparation }: {
  groupId: string
  /** The Draft Sim; `openDraftId` opens a draft copied by « Ouvrir dans Préparation ». */
  preparation: (openDraftId: string | null) => ReactNode
}) {
  const { t } = useTranslation()
  const [params, setParams] = useSearchParams()
  const view = params.get('draftView') === 'journal' ? 'journal' : 'prep'
  const [openDraftId, setOpenDraftId] = useState<string | null>(null)
  const setView = (v: 'prep' | 'journal') => setParams((prev) => {
    const next = new URLSearchParams(prev)
    if (v === 'journal') next.set('draftView', 'journal'); else next.delete('draftView')
    return next
  })
  return (
    <div className="space-y-3">
      <Segmented label={t('analyst.draftLog.subTabs.label')} value={view} onChange={setView}
        options={[{ id: 'prep', label: t('analyst.draftLog.subTabs.prep') }, { id: 'journal', label: t('analyst.draftLog.subTabs.journal') }]} />
      {view === 'prep'
        ? <div key={openDraftId ?? 'prep'}>{preparation(openDraftId)}</div>
        : <DraftJournal groupId={groupId} onOpenedInPrep={(id) => { setOpenDraftId(id); setView('prep') }} />}
    </div>
  )
}

function DraftJournal({ groupId, onOpenedInPrep }: { groupId: string; onOpenedInPrep: (draftId: string) => void }) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [, setParams] = useSearchParams()
  const canEdit = useAnalystCanEdit(groupId)
  const [state, setState] = useState<DraftLogState>({ kind: 'loading' })
  const [missingTable, setMissingTable] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [manualOpen, setManualOpen] = useState(false)

  const load = useCallback(async () => {
    try {
      // Staff: the team games played since the last opening join the log first.
      if (canEdit) await window.api.draftLogSyncFromGames(groupId).catch((err) => { if (isMissingTableError(err)) throw err })
      setState({ kind: 'ready', entries: await window.api.draftLogList(groupId) })
    } catch (err) {
      setMissingTable(isMissingTableError(err))
      setState({ kind: 'error', cause: analystErrorText(err, t) })
    }
  }, [groupId, canEdit, t])

  useEffect(() => { setState({ kind: 'loading' }); void load() }, [load, attempt])

  const replace = (e: DraftLogEntry) => setState((s) => (s.kind === 'ready' ? { kind: 'ready', entries: s.entries.map((x) => (x.id === e.id ? e : x)) } : s))
  const failed = (err: unknown) => toast({ title: t('analyst.draftLog.actionFailed'), description: analystErrorText(err, t), variant: 'destructive' })

  const addManual = async (input: DraftLogInput) => {
    try {
      const created = await window.api.draftLogCreate(groupId, input)
      setState((s) => (s.kind === 'ready' ? { kind: 'ready', entries: [created, ...s.entries] } : { kind: 'ready', entries: [created] }))
    } catch (err) { failed(err); throw err }
  }
  // « Ouvrir dans Préparation »: a new Draft Sim draft with the same picks and bans, on our side.
  const openInPrep = async (e: DraftLogEntry) => {
    const ours = { picks: e.ourPicks.map((p) => p.champion), bans: e.ourBans ?? [] }
    const theirs = { picks: e.theirPicks.map((p) => p.champion), bans: e.theirBans ?? [] }
    const blue = e.side === 'blue' ? ours : theirs
    const red = e.side === 'blue' ? theirs : ours
    try {
      const created = await window.api.createDraft({
        name: t('analyst.draftLog.copyName', { name: e.opponentName ?? t('analyst.common.unknownOpponent'), date: new Date(e.playedAt).toLocaleDateString() }),
        bluePicks: blue.picks, blueBans: blue.bans, redPicks: red.picks, redBans: red.bans, myTeamSide: e.side, notes: e.notes ?? undefined,
      })
      onOpenedInPrep(created.id)
    } catch (err) { failed(err) }
  }
  const openOpponent = (key: string) => setParams((prev) => {
    const next = new URLSearchParams(prev)
    next.set('tab', 'scouting'); next.set('dossier', key); next.delete('draftView')
    return next
  })

  if (missingTable) return <EmptyState icon={Hourglass} title={t('analyst.common.notDeployedTitle')} description={t('analyst.common.notDeployed')} />
  return (
    <div className="space-y-3">
      {canEdit && state.kind === 'ready' && state.entries.length > 0 && (
        <div className="flex justify-end">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setManualOpen(true)}><Plus className="h-3.5 w-3.5" />{t('analyst.draftLog.empty.addManual')}</Button>
        </div>
      )}
      <DraftLogView
        state={state}
        canEdit={canEdit}
        onRetry={() => setAttempt((n) => n + 1)}
        onAddManual={() => setManualOpen(true)}
        onOpenOpponent={openOpponent}
        onSaveNotes={(id, notes) => { window.api.draftLogUpdate(id, { notes }).then(replace, failed) }}
        onSavePickOrder={(id, pickOrder) => {
          window.api.draftLogUpdate(id, { pickOrder }).then((e) => { replace(e); toast({ title: t(pickOrder ? 'analyst.draftLog.pickOrder.saved' : 'analyst.draftLog.pickOrder.cleared') }) }, failed)
        }}
        onOpenInPrep={(e) => { void openInPrep(e) }}
      />
      <DraftManualDialog open={manualOpen} onOpenChange={setManualOpen} onSubmit={addManual} />
    </div>
  )
}

