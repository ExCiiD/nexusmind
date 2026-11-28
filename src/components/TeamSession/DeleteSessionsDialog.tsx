import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Loader2, X, Minus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { TEAM_SESSION_DELETE_MAX, type TeamSessionDeleteResult } from '@/lib/teamSessionHistory'
import { cn } from '@/lib/utils'

export interface DeleteTarget { sessionId: string; title: string; when: string }

/** Sends the ids in chunks of the server's limit; one answer per id, in order. Throws if a call is rejected. */
export async function deleteInChunks(
  ids: string[],
  call: (chunk: string[]) => Promise<TeamSessionDeleteResult[]>,
): Promise<TeamSessionDeleteResult[]> {
  const out: TeamSessionDeleteResult[] = []
  for (let i = 0; i < ids.length; i += TEAM_SESSION_DELETE_MAX) out.push(...await call(ids.slice(i, i + TEAM_SESSION_DELETE_MAX)))
  return out
}

type Phase = 'confirm' | 'running' | 'done'

/**
 * Deletes several team sessions at once (DECISIONS 28/11): one confirmation that says it applies to the whole team and
 * that the players' games stay, then the outcome session by session (deleted, refused, not found).
 */
export function DeleteSessionsDialog({ targets, run, onClose }: {
  /** Null = closed. */
  targets: DeleteTarget[] | null
  run: (ids: string[]) => Promise<TeamSessionDeleteResult[]>
  /** Called when the dialog closes, with the ids that were deleted (to refresh the list and drop them from the selection). */
  onClose: (deletedIds: string[]) => void
}) {
  const { t } = useTranslation()
  const [phase, setPhase] = useState<Phase>('confirm')
  const [results, setResults] = useState<TeamSessionDeleteResult[]>([])
  const [failure, setFailure] = useState<string | null>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const open = targets !== null
  const list = targets ?? []

  const close = () => {
    if (phase === 'running') return
    const deleted = results.filter((r) => r.status === 'deleted').map((r) => r.sessionId)
    setPhase('confirm'); setResults([]); setFailure(null)
    onClose(deleted)
  }
  const confirm = async () => {
    setPhase('running'); setFailure(null)
    try {
      setResults(await run(list.map((x) => x.sessionId)))
      setPhase('done')
    } catch (e) {
      const m = (e as Error)?.message ?? ''
      setFailure(/NOT_AVAILABLE/.test(m) ? t('teamSessions.delete.notAvailable') : /FORBIDDEN/.test(m) ? t('teamSessions.delete.forbidden') : t('teamSessions.delete.failed'))
      setPhase('confirm')
    }
  }

  const count = (s: TeamSessionDeleteResult['status']) => results.filter((r) => r.status === s).length
  const titleOf = (id: string) => list.find((x) => x.sessionId === id)
  const label = (r: TeamSessionDeleteResult) =>
    r.status === 'deleted' ? t('teamSessions.delete.status.deleted')
      : r.status === 'not_found' ? t('teamSessions.delete.status.notFound')
        : t(`teamSessions.delete.status.refused_${r.reason ?? 'error'}`)

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close() }}>
      <DialogContent
        className="max-w-md"
        onOpenAutoFocus={(e) => { if (phase === 'confirm') { e.preventDefault(); cancelRef.current?.focus() } }}
        onInteractOutside={(e) => { if (phase === 'running') e.preventDefault() }}
      >
        {phase === 'done' ? (
          <>
            <DialogHeader>
              <DialogTitle>{t('teamSessions.delete.doneTitle', { deleted: count('deleted'), total: results.length })}</DialogTitle>
              <DialogDescription>{t('teamSessions.delete.doneHint')}</DialogDescription>
            </DialogHeader>
            <ul className="max-h-64 space-y-1 overflow-y-auto" aria-label={t('teamSessions.delete.results')}>
              {results.map((r) => {
                const row = titleOf(r.sessionId)
                const ok = r.status === 'deleted'
                return (
                  <li key={r.sessionId} className="flex items-center gap-2 rounded border border-hextech-border-dim bg-hextech-dark/40 px-2.5 py-1.5 text-xs">
                    {ok ? <Check className="h-3.5 w-3.5 shrink-0 text-hextech-green" aria-hidden />
                      : r.status === 'not_found' ? <Minus className="h-3.5 w-3.5 shrink-0 text-hextech-text-dim" aria-hidden />
                        : <X className="h-3.5 w-3.5 shrink-0 text-hextech-red" aria-hidden />}
                    <span className="min-w-0 flex-1 truncate text-hextech-text-bright">{row?.title ?? r.sessionId}<span className="ml-1.5 font-mono text-[10px] text-hextech-text-dim">{row?.when}</span></span>
                    <span className={cn('shrink-0 font-medium', ok ? 'text-hextech-green' : r.status === 'not_found' ? 'text-hextech-text-dim' : 'text-hextech-red')}>{label(r)}</span>
                  </li>
                )
              })}
            </ul>
            <DialogFooter><Button onClick={close}>{t('common.close')}</Button></DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{t('teamSessions.delete.confirmTitle', { count: list.length })}</DialogTitle>
              <DialogDescription>{t('teamSessions.delete.confirmDesc')}</DialogDescription>
            </DialogHeader>
            <ul className="max-h-40 space-y-0.5 overflow-y-auto text-xs text-hextech-text" aria-label={t('teamSessions.delete.sessions')}>
              {list.map((x) => <li key={x.sessionId} className="truncate">{x.title}<span className="ml-1.5 font-mono text-[10px] text-hextech-text-dim">{x.when}</span></li>)}
            </ul>
            <p className="rounded-md border border-hextech-border-dim bg-hextech-elevated/50 px-3 py-2 text-xs text-hextech-text">{t('teamSessions.delete.keeps')}</p>
            {failure && <p role="alert" className="text-xs text-hextech-red">{failure}</p>}
            <DialogFooter className="gap-2 sm:gap-0">
              <Button ref={cancelRef} variant="outline" onClick={close} disabled={phase === 'running'}>{t('common.cancel')}</Button>
              <Button variant="destructive" onClick={() => { void confirm() }} disabled={phase === 'running'}>
                {phase === 'running' && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                {t('teamSessions.delete.confirmAction', { count: list.length })}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
