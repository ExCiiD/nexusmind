import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Plus, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { FAMILIES, FAMILY_COLOR, tagFamily, type MistakeFamily } from '@/lib/mistakeInsights'
import type { MistakeTag } from '@/lib/ipc'
import { tagLabel } from './text'

export interface OtherChoice {
  tagSlug?: string
  customLabel?: string
  note?: string
  /** "This was not a mistake": recorded as justified, creates no Mistake. */
  justified?: boolean
}

/**
 * The mandatory 4th button: every family and tag, a personal tag, a note for
 * the coach — and the way out that every card must have, whatever its three
 * buttons are: "this was not a mistake".
 */
export function OtherCausePicker({ tags, busy, onConfirm, onCancel }: {
  tags: MistakeTag[]
  busy: boolean
  onConfirm: (c: OtherChoice) => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const [family, setFamily] = useState<MistakeFamily>('deaths')
  const [slug, setSlug] = useState<string | null>(null)
  const [custom, setCustom] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const byFamily = useMemo(() => {
    const out: Record<MistakeFamily, MistakeTag[]> = { deaths: [], vision: [], tempo: [], mechanics: [] }
    for (const tag of tags) out[tagFamily(tag.slug, tag.category)].push(tag)
    return out
  }, [tags])
  const canConfirm = !!slug || !!custom?.trim()

  return (
    <div className="rounded-xl border border-hextech-border-dim bg-hextech-elevated/40 p-3" data-testid="other-cause">
      <p className="text-xs font-semibold text-hextech-text-bright">{t('microReview.otherTitle')}</p>
      <div className="mt-2 flex flex-wrap gap-1" role="tablist" aria-label={t('mistakeLab.families')}>
        {FAMILIES.map((f) => (
          <button key={f} role="tab" aria-selected={family === f} onClick={() => setFamily(f)}
            className={cn('flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium',
              family === f ? 'border-hextech-gold bg-hextech-gold/15 text-hextech-gold-bright' : 'border-hextech-border-dim text-hextech-text hover:border-hextech-border')}>
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: FAMILY_COLOR[f] }} />{t(`mistakeLab.family.${f}`)}
          </button>
        ))}
      </div>
      <div className="mt-2 flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
        {byFamily[family].map((tag) => (
          <button key={tag.id} onClick={() => { setSlug(tag.slug); setCustom(null) }} aria-pressed={slug === tag.slug}
            className={cn('rounded-md border px-2 py-1 text-[11px]',
              slug === tag.slug ? 'border-hextech-gold bg-hextech-gold/15 text-hextech-gold-bright' : 'border-hextech-border-dim text-hextech-text-bright hover:border-hextech-gold/50')}>
            {tagLabel(t, tag.isBuiltIn ? tag.slug : null, tag.label)}
          </button>
        ))}
        {custom === null ? (
          <button onClick={() => { setCustom(''); setSlug(null) }} className="flex items-center gap-1 rounded-md border border-dashed border-hextech-border px-2 py-1 text-[11px] text-hextech-text hover:border-hextech-gold/50">
            <Plus className="h-3 w-3" />{t('microReview.customTag')}
          </button>
        ) : (
          <input autoFocus value={custom} maxLength={60} onChange={(e) => setCustom(e.target.value)} placeholder={t('microReview.customPlaceholder')} aria-label={t('microReview.customPlaceholder')}
            className="h-7 w-44 rounded-md border border-hextech-gold/60 bg-hextech-black/40 px-2 text-[11px] text-hextech-text-bright placeholder:text-hextech-text-dim" />
        )}
      </div>
      <button disabled={busy} onClick={() => onConfirm({ justified: true, note: note.trim() || undefined })} data-testid="other-justified"
        className="mt-2.5 flex w-full items-center gap-2 rounded-md border border-hextech-green/30 bg-hextech-green/10 px-2.5 py-1.5 text-left text-[11px] text-hextech-text-bright transition-colors hover:border-hextech-green/60 disabled:opacity-60">
        <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-hextech-green" />
        <span className="min-w-0 flex-1">
          <span className="block font-medium">{t('microReview.otherJustified')}</span>
          <span className="block text-hextech-text-dim">{t('microReview.justifiedBadge')}</span>
        </span>
      </button>
      <label className="mt-2.5 block text-[11px] text-hextech-text-dim" htmlFor="mr-note">{t('microReview.coachNote')}</label>
      <Textarea id="mr-note" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} className="mt-1 text-xs" />
      <div className="mt-2.5 flex justify-end gap-2">
        <Button size="sm" variant="ghost" className="text-hextech-text hover:text-hextech-text-bright" onClick={onCancel}>{t('microReview.cancel')}</Button>
        <Button size="sm" disabled={!canConfirm || busy} onClick={() => onConfirm({ tagSlug: slug ?? undefined, customLabel: custom?.trim() || undefined, note: note.trim() || undefined })}>
          {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}{t('microReview.confirm')}
        </Button>
      </div>
    </div>
  )
}
