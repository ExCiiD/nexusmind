import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Pencil, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { formatMs } from '@/lib/mediaCore'
import { tagLabel } from '@/components/MicroReview/text'
import type { MistakeTag } from '@/lib/ipc'

/**
 * « Prise de note » pop-over (DECISIONS 21/11, spec § 21): opens above the bar on the right, the video paused; the
 * current time, a text (focused), optional tags (the Mistake Lab's), « Entrée enregistre · Échap annule ».
 */
export function NotePopover({ timeSec, tags, onSave, onCancel }: {
  timeSec: number
  tags: MistakeTag[]
  onSave: (note: { text: string; tagSlugs: string[] }) => Promise<void> | void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [picking, setPicking] = useState(false)
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { ref.current?.focus() }, [])
  // Échap closes it wherever the focus is inside (« Entrée enregistre · Échap annule »).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onCancel])

  const canSave = text.trim().length > 0 || picked.length > 0
  const save = async () => {
    if (!canSave || saving) return
    setSaving(true)
    try { await onSave({ text: text.trim(), tagSlugs: picked }) } finally { setSaving(false) }
  }
  const active = tags.filter((x) => !x.archivedAt)
  const matches = active.filter((x) => !picked.includes(x.slug) && tagLabel(t, x.slug, x.label).toLowerCase().includes(query.trim().toLowerCase())).slice(0, 8)

  return (
    <div role="dialog" aria-label={t('recording.note.button')} data-testid="note-popover"
      className="absolute bottom-full right-3 z-40 mb-2 w-[360px] max-w-[calc(100%-1.5rem)] space-y-2 rounded-lg border border-hextech-gold bg-hextech-elevated p-3 shadow-2xl">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-hextech-text-bright"><Pencil className="h-4 w-4 text-hextech-gold" />{t('recording.note.button')}</span>
        <span className="font-mono text-xs text-hextech-gold">{formatMs(timeSec * 1000)}</span>
      </div>
      <textarea ref={ref} value={text} onChange={(e) => setText(e.target.value)} maxLength={280} rows={3} aria-label={t('recording.note.text')}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); void save() } }}
        placeholder={t('recording.note.placeholder')}
        className="h-16 w-full resize-none rounded-md border border-hextech-border-dim bg-hextech-black px-2.5 py-2 text-sm text-hextech-text placeholder:text-hextech-text-dim focus:border-hextech-gold focus:outline-none" />
      <div className="flex flex-wrap items-center gap-1.5">
        {picked.map((slug) => (
          <span key={slug} className="flex items-center gap-1 rounded-full border border-hextech-red/50 bg-hextech-red/[0.14] px-2 py-0.5 text-[11px] text-hextech-text-bright">
            {tagLabel(t, slug, active.find((x) => x.slug === slug)?.label)}
            <button type="button" aria-label={t('microReview.extras.removeTag')} onClick={() => setPicked(picked.filter((x) => x !== slug))}><X className="h-3 w-3" /></button>
          </span>
        ))}
        <button type="button" onClick={() => setPicking((v) => !v)} aria-expanded={picking}
          className="flex items-center gap-0.5 rounded-full border border-dashed border-hextech-border px-2 py-0.5 text-[11px] text-hextech-text-dim hover:border-hextech-gold/60 hover:text-hextech-gold">
          <Plus className="h-3 w-3" />{t('recording.note.tag')}
        </button>
      </div>
      {picking && (
        <div className="space-y-1.5">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('recording.note.searchTag')} aria-label={t('recording.note.searchTag')}
            className="w-full rounded-md border border-hextech-border-dim bg-hextech-black px-2 py-1 text-xs text-hextech-text focus:border-hextech-gold focus:outline-none" />
          <div className="flex flex-wrap gap-1">
            {matches.map((x) => (
              <button key={x.id} type="button" onClick={() => { setPicked([...picked, x.slug]); setQuery('') }}
                className={cn('rounded-full border border-hextech-border-dim px-2 py-0.5 text-[11px] text-hextech-text hover:border-hextech-gold/60')}>
                {tagLabel(t, x.slug, x.label)}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="flex items-center justify-between gap-2 pt-1">
        <span className="font-mono text-[10px] text-hextech-text-dim">{t('recording.note.keys')}</span>
        <Button size="sm" onClick={() => void save()} disabled={!canSave || saving} data-testid="note-save">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t('recording.note.save')}
        </Button>
      </div>
    </div>
  )
}
