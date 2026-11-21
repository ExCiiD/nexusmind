import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bot, Loader2, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast } from '@/hooks/useToast'
import { cn } from '@/lib/utils'
import { fmtClock } from '@/lib/mistakeInsights'
import { invalidateCached } from '@/lib/queryCache'
import { tagLabel } from '@/components/MicroReview/text'
import type { DetectedMistake, MistakeCorrectionReason, MistakeTag } from '@/lib/ipc'
import { TagAutocomplete } from '@/components/MicroReview/TagAutocomplete'
import { localizeDetectedNote, type Translate } from '@/lib/detectedMistakeNote'

const REASONS: MistakeCorrectionReason[] = ['not_a_mistake', 'wrong_tag', 'wrong_time', 'team_context', 'other']
const NOTE_MAX = 300

type Done = { kind: 'removed'; reason: MistakeCorrectionReason | null } | { kind: 'retagged'; label: string }

/**
 * Review « Erreurs détectées » (DECISIONS 21/11, approved; spec § 19 « Panneau Erreurs détectées »): opening it only
 * SHOWS the game's detected mistakes. Per line, « Modifier l'erreur » (a new tag, searched among the player's tags and
 * the Codex) and « Supprimer », one mistake at a time, each through the optional « Pourquoi ? » step (« Passer »
 * validates in one click; « Pas une erreur » preselected to delete, « Mauvais tag » to edit; a free note ≤ 300).
 * A corrected line stays greyed with its reason until the panel closes. Desktop only.
 */
export function DetectedMistakesButton({ gameId }: { gameId: string }) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [list, setList] = useState<DetectedMistake[] | null>(null)
  const [tags, setTags] = useState<MistakeTag[]>([])
  const [editing, setEditing] = useState<{ id: string; mode: 'remove' | 'retag' } | null>(null)
  const [newTag, setNewTag] = useState('')
  const [reason, setReason] = useState<MistakeCorrectionReason | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<Record<string, Done>>({})
  // « Annuler » (spec § 19): until the panel closes; hidden once the server says it can't (NOT_UNDOABLE).
  const [undoing, setUndoing] = useState<string | null>(null)
  const [noUndo, setNoUndo] = useState<Set<string>>(new Set())
  const undo = async (id: string) => {
    setUndoing(id)
    try {
      const res = await window.api.undoMistakeCorrection?.(id)
      if (!res?.success) throw new Error('NOT_UNDOABLE')
      setDone((d) => { const next = { ...d }; delete next[id]; return next })
      invalidateCached('games:')
      void load()
    } catch (err) {
      if (((err as Error)?.message ?? '').includes('NOT_UNDOABLE')) setNoUndo((s) => new Set(s).add(id))
      else toast({ title: t('review.detected.undoFailed'), variant: 'destructive' })
    } finally {
      setUndoing(null)
    }
  }

  const load = useCallback(async () => {
    try {
      const all = (await window.api.listDetectedMistakes?.(gameId)) ?? []
      setList([...all].sort((a, b) => a.gameTimeSec - b.gameTimeSec))
    } catch { setList([]) }
  }, [gameId])
  // The count on the button: « Erreurs détectées · N ».
  useEffect(() => { setList(null); setDone({}); void load() }, [load])
  useEffect(() => {
    if (!open) { setDone({}); setNoUndo(new Set()); void load(); return } // closing drops the greyed lines
    setEditing(null)
    window.api.listMistakeTags().then(setTags).catch(() => setTags([]))
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps -- on open / close

  const start = (id: string, mode: 'remove' | 'retag') => {
    setEditing({ id, mode }); setNewTag(''); setNote('')
    setReason(mode === 'remove' ? 'not_a_mistake' : 'wrong_tag')
  }

  const confirm = async (withReason: boolean) => {
    if (!editing) return
    const m = list?.find((x) => x.id === editing.id)
    if (!m) return
    if (editing.mode === 'retag' && (!newTag || newTag === m.tagSlug)) return
    const why = withReason ? { reason, note: note.trim().slice(0, NOTE_MAX) || null } : undefined
    setBusy(true)
    try {
      if (editing.mode === 'remove') {
        const res = await window.api.dismissDetectedMistake?.(m.id, why)
        if (!res?.success) throw new Error('NOT_DONE')
        setDone((d) => ({ ...d, [m.id]: { kind: 'removed', reason: why?.reason ?? null } }))
      } else {
        const res = await window.api.retagMistake?.(m.id, { tagSlug: newTag }, why)
        if (!res?.success) throw new Error('NOT_DONE')
        const tag = tags.find((x) => x.slug === newTag)
        setDone((d) => ({ ...d, [m.id]: { kind: 'retagged', label: tagLabel(t, newTag, tag?.label) } }))
      }
      setEditing(null)
      invalidateCached('games:')
    } catch {
      toast({ title: t(editing.mode === 'remove' ? 'review.detected.deleteFailed' : 'review.detected.retagFailed'), variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  const count = list?.length ?? 0
  const removed = Object.values(done).filter((d) => d.kind === 'removed').length
  const retagged = Object.values(done).filter((d) => d.kind === 'retagged').length
  const active = tags.filter((x) => !x.archivedAt)

  return (
    <>
      <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setOpen(true)} data-testid="detected-mistakes-button">
        <Bot className="h-4 w-4" />{t('review.detected.button')}{list ? ` · ${count}` : ''}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[480px]">
          <DialogHeader>
            <DialogTitle>{t('review.detected.title')}</DialogTitle>
            <DialogDescription>{t('review.detected.desc')}</DialogDescription>
          </DialogHeader>
          {list === null ? (
            <Loader2 className="h-5 w-5 animate-spin text-hextech-gold" />
          ) : list.length === 0 ? (
            <p className="text-sm text-hextech-text-dim">{t('review.detected.empty')}</p>
          ) : (
            <ul className="max-h-[60vh] space-y-2 overflow-y-auto pr-1" data-testid="detected-mistakes-list">
              {list.map((m) => {
                const isEditing = editing?.id === m.id
                const d = done[m.id]
                return (
                  <li key={m.id} className={cn('rounded-md border p-2.5 transition-colors',
                    isEditing ? (editing!.mode === 'remove' ? 'border-hextech-red bg-hextech-elevated' : 'border-hextech-gold bg-hextech-elevated') : 'border-hextech-border-dim',
                    d?.kind === 'removed' && 'opacity-55')}>
                    <div className="flex items-start gap-3">
                      <span className="shrink-0 font-mono text-xs text-hextech-gold">{fmtClock(m.gameTimeSec)}</span>
                      <span className="min-w-0 flex-1">
                        <span className={cn('block text-sm text-hextech-text-bright', d?.kind === 'removed' && 'line-through')}>
                          {d?.kind === 'retagged' ? d.label : tagLabel(t, m.tagSlug, m.tagLabel)}
                        </span>
                        {d?.kind === 'removed' ? (
                          <span className="block font-mono text-[10px] text-hextech-text-dim">{t('review.detected.removedAs', { reason: d.reason ? t(`review.detected.reasons.${d.reason}`) : t('review.detected.noReason') })}</span>
                        ) : d?.kind === 'retagged' ? (
                          <span className="block font-mono text-[10px] text-hextech-text-dim">{t('review.detected.retaggedFrom', { tag: tagLabel(t, m.tagSlug, m.tagLabel) })}</span>
                        ) : m.note ? <span className="block font-mono text-[10px] text-hextech-text-dim">{localizeDetectedNote(m.note, t as Translate)}</span> : null}
                      </span>
                      {d && window.api.undoMistakeCorrection && !noUndo.has(m.id) && (
                        <Button size="sm" variant="ghost" className="h-7 shrink-0 px-2 text-xs text-hextech-gold opacity-100" disabled={undoing === m.id}
                          onClick={() => void undo(m.id)} data-testid="detected-undo">
                          {undoing === m.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t('review.detected.undo')}
                        </Button>
                      )}
                      {!isEditing && !d && (
                        <span className="flex shrink-0 gap-0.5">
                          <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs text-hextech-gold hover:text-hextech-gold-bright" onClick={() => start(m.id, 'retag')}>
                            <Pencil className="h-3.5 w-3.5" />{t('review.detected.retag')}
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs text-hextech-red hover:text-hextech-red" onClick={() => start(m.id, 'remove')}>
                            <Trash2 className="h-3.5 w-3.5" />{t('review.detected.wrong')}
                          </Button>
                        </span>
                      )}
                    </div>
                    {isEditing && editing && (
                      <div className="mt-2 space-y-2.5" data-testid="detected-correction">
                        {editing.mode === 'retag' && (
                          <div className="space-y-1.5">
                            <p className="font-mono text-[10px] uppercase tracking-wider text-hextech-text-dim">{t('review.detected.newTag')}</p>
                            <TagAutocomplete tags={active} autoFocus exclude={new Set([m.tagSlug])}
                              value={active.find((x) => x.slug === newTag) ?? null} onPick={(x) => setNewTag(x.slug)} />
                          </div>
                        )}
                        {/* « Pourquoi ? (facultatif) » — never blocking: « Passer » does the action without a reason. */}
                        <div className="space-y-2 rounded-md bg-hextech-gold/[0.08] p-2.5">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-hextech-text-bright">{t('review.detected.why')}</span>
                            <button type="button" className="text-xs text-hextech-gold hover:underline disabled:opacity-40" data-testid="why-skip"
                              disabled={busy || (editing.mode === 'retag' && !newTag)} onClick={() => void confirm(false)}>
                              {t('review.detected.skip')}
                            </button>
                          </div>
                          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t('review.detected.why')}>
                            {REASONS.map((r) => (
                              <button key={r} type="button" role="radio" aria-checked={reason === r} onClick={() => setReason(reason === r ? null : r)}
                                className={cn('rounded-full border px-2.5 py-0.5 text-[11px] transition-colors',
                                  reason === r ? 'border-hextech-gold bg-hextech-gold/[0.18] text-hextech-gold-bright' : 'border-hextech-border-dim text-hextech-text hover:border-hextech-gold/50')}>
                                {t(`review.detected.reasons.${r}`)}
                              </button>
                            ))}
                          </div>
                          <div className="relative">
                            <textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, NOTE_MAX))} rows={2} placeholder={t('review.detected.whyNote')} aria-label={t('review.detected.whyNote')}
                              className="w-full resize-none rounded-md border border-hextech-border-dim bg-hextech-black px-2.5 py-1.5 pr-14 text-sm text-hextech-text focus:border-hextech-gold focus:outline-none" />
                            <span className="pointer-events-none absolute bottom-2 right-2 font-mono text-[10px] text-hextech-text-dim">{note.length} / {NOTE_MAX}</span>
                          </div>
                        </div>
                        <div className="flex justify-end gap-1.5">
                          <Button size="sm" variant="ghost" onClick={() => setEditing(null)} disabled={busy}>{t('common.cancel')}</Button>
                          <Button size="sm" variant={editing.mode === 'remove' ? 'outline' : 'default'} onClick={() => void confirm(true)}
                            className={cn(editing.mode === 'remove' && 'border-hextech-red text-hextech-red hover:bg-hextech-red/10')}
                            disabled={busy || (editing.mode === 'retag' && !newTag)}>
                            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t(editing.mode === 'remove' ? 'review.detected.confirm' : 'review.detected.confirmRetag')}
                          </Button>
                        </div>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
          {(removed > 0 || retagged > 0) && (
            <p className="font-mono text-[11px] text-hextech-text-dim" data-testid="detected-footer">
              {t('review.detected.footer', { removed, retagged })}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
