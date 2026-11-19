import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Hourglass } from 'lucide-react'
import { EmptyState } from '@/components/ui/data-state'
import { useToast } from '@/hooks/useToast'
import type { OpponentDossierInput, OpponentDossierView } from '@/lib/analyst'
import { dossierToDiscordText } from '@/lib/opponentDossierCore'
import { DossierView, type DossierState } from './DossierView'
import { analystErrorText, isMissingTableError } from './analystErrors'
import { useAnalystCanEdit } from './useAnalystAccess'

/**
 * #40 · 3/3, Coaching → Scouting → « Dossier »: loads the opponent's dossier view, and saves / publishes / refreshes
 * it through window.api (desktop IPC or the web adapter). Players see a published dossier, read only.
 */
export function OpponentDossierPage({ groupId, opponentKey, opponentName, onBack }: {
  groupId: string
  opponentKey: string
  /** For the header while the first load runs. */
  opponentName: string
  onBack: () => void
}) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const canEdit = useAnalystCanEdit(groupId)
  const [view, setView] = useState<OpponentDossierView | null>(null)
  const [state, setState] = useState<DossierState>({ kind: 'loading', header: { opponentName, opponentTag: null, dossier: null }, done: 0, total: 0 })
  const [missingTable, setMissingTable] = useState(false)
  const [attempt, setAttempt] = useState(0)

  const fail = useCallback((err: unknown) => {
    setMissingTable(isMissingTableError(err))
    setState({ kind: 'error', cause: analystErrorText(err, t) })
  }, [t])

  useEffect(() => {
    let alive = true
    window.api.opponentDossierGet(groupId, opponentKey)
      .then((v) => { if (alive) { setView(v); setState({ kind: 'ready', view: v }) } })
      .catch((err) => { if (alive) fail(err) })
    return () => { alive = false }
  }, [groupId, opponentKey, attempt, fail])

  const show = (v: OpponentDossierView) => { setView(v); setState({ kind: 'ready', view: v }) }
  const actionFailed = (err: unknown) => toast({ title: t('analyst.dossier.actionFailed'), description: analystErrorText(err, t), variant: 'destructive' })

  const save = async (input: OpponentDossierInput) => {
    if (!view) return
    try { show({ ...view, dossier: await window.api.opponentDossierSave(groupId, opponentKey, input) }) }
    catch (err) { actionFailed(err) }
  }
  const setStatus = async (publish: boolean) => {
    if (!view) return
    try {
      const dossier = publish ? await window.api.opponentDossierPublish(groupId, opponentKey) : await window.api.opponentDossierUnpublish(groupId, opponentKey)
      show({ ...view, dossier })
      toast({ title: t(publish ? 'analyst.dossier.publishedToast' : 'analyst.dossier.unpublishedToast', { name: view.opponentName }) })
    } catch (err) { actionFailed(err) }
  }
  const refresh = async () => {
    if (!view) return
    setState({ kind: 'loading', header: view, done: 0, total: 0 })
    try { show(await window.api.opponentDossierRefresh(groupId, opponentKey)) }
    catch (err) { actionFailed(err); show(view) }
  }
  const copy = async () => {
    if (!view) return
    try {
      await navigator.clipboard.writeText(dossierToDiscordText(view))
      toast({ title: t('analyst.dossier.copied') })
    } catch (err) { actionFailed(err) }
  }

  if (missingTable) {
    return (
      <div className="space-y-4">
        <button type="button" onClick={onBack} className="flex items-center gap-1 text-xs text-hextech-text-dim hover:text-hextech-text-bright"><ArrowLeft className="h-3.5 w-3.5" />{t('analyst.dossier.back')}</button>
        <EmptyState icon={Hourglass} title={t('analyst.common.notDeployedTitle')} description={t('analyst.common.notDeployed')} />
      </div>
    )
  }
  return (
    <DossierView
      state={state}
      canEdit={canEdit}
      onBack={onBack}
      onRetry={() => setAttempt((n) => n + 1)}
      onRefresh={() => { void refresh() }}
      onCopy={() => { void copy() }}
      onPublish={() => { void setStatus(true) }}
      onUnpublish={() => { void setStatus(false) }}
      onSave={(input) => { void save(input) }}
      // The roster form lives on the scouting screen.
      onAddPlayers={onBack}
      onFixPlayer={onBack}
    />
  )
}
