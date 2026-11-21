import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Clock, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { MistakeTag } from '@/lib/ipc'
import { MAX_EXTRA_TAGS, preciseTimesOk, type AnswerExtras } from './answerExtras'
import { tagLabel } from './text'
import { TagAutocomplete } from './TagAutocomplete'
import { useReviewPlayerStore } from '@/store/useReviewPlayerStore'
import { fmtClock } from '@/lib/mistakeInsights'

let seq = 0
const REASONS_MAX = 300
const TAG_NOTE_MAX = 140

/**
 * Under « autre cause » (DECISIONS 21/11, spec § 20 points 3-4): folded by default in the narrow panel behind a dotted
 * line « ▸ Raisons d'après moi · autres tags d'erreur ». « Raisons de l'erreur d'après moi (facultatif) » (300) and
 * « Autres erreurs dans ce moment »: each added tag as a red pill with its optional description (140), « + Ajouter un
 * tag d'erreur » opening a search among the player's tags and the Codex's. Sent with the answer. Beta.20: open by
 * default, and « Définir les timestamps précis » in place of the automatic Erreur · Conséquence · Conclusion markers.
 */
/**
 * « Définir les timestamps précis » (beta.20): a discreet link revealing two optional fields, Erreur and Conséquence,
 * each set with one click at the Review player's current game time; one, the other or both. Without a player on the
 * page (no VOD), the link is not shown.
 */
function PreciseTimes({ value, onChange }: { value: AnswerExtras; onChange: (next: AnswerExtras) => void }) {
  const { t } = useTranslation()
  const playerGameTime = useReviewPlayerStore((s) => s.playerGameTime)
  const [shown, setShown] = useState(value.errorAtSec != null || value.consequenceAtSec != null)
  if (!playerGameTime) return null
  if (!shown) {
    return (
      <button type="button" onClick={() => setShown(true)} data-testid="precise-times-toggle"
        className="flex items-center gap-1 text-[11px] text-hextech-text-dim hover:text-hextech-gold">
        <Clock className="h-3 w-3" />{t('microReview.extras.precise.toggle')}
      </button>
    )
  }
  const row = (k: 'errorAtSec' | 'consequenceAtSec', label: string) => {
    const sec = value[k]
    return (
      <div className="flex items-center gap-2 text-xs" data-testid={`precise-${k}`}>
        <span className="w-24 shrink-0 font-medium text-hextech-text-bright">{label}</span>
        <span className={cn('w-12 shrink-0 font-mono', sec != null ? 'text-hextech-gold' : 'text-hextech-text-dim')}>{sec != null ? fmtClock(sec) : '—'}</span>
        <button type="button" onClick={() => onChange({ ...value, [k]: Math.max(0, Math.round(playerGameTime())) })}
          className="rounded-md border border-hextech-border-dim px-2 py-0.5 text-[11px] text-hextech-text hover:border-hextech-gold/60 hover:text-hextech-gold">
          {t('microReview.extras.precise.atPlayer')}
        </button>
        {sec != null && (
          <button type="button" onClick={() => onChange({ ...value, [k]: null })} aria-label={t('microReview.extras.precise.clear')}
            className="rounded p-0.5 text-hextech-text-dim hover:text-hextech-red"><X className="h-3 w-3" /></button>
        )}
      </div>
    )
  }
  return (
    <div className="space-y-1.5 rounded-md border border-hextech-border-dim/60 p-2" data-testid="precise-times">
      <p className="text-[11px] text-hextech-text-dim">{t('microReview.extras.precise.hint')}</p>
      {row('errorAtSec', t('microReview.extras.precise.error'))}
      {row('consequenceAtSec', t('microReview.extras.precise.consequence'))}
      {!preciseTimesOk(value) && <p className="text-[11px] text-hextech-red" role="alert" data-testid="precise-order">{t('microReview.extras.precise.order')}</p>}
    </div>
  )
}

export function AnswerExtrasEditor({ value, onChange, tags, answered, onSaveAnswered, busy }: {
  value: AnswerExtras
  onChange: (next: AnswerExtras) => void
  tags: MistakeTag[]
  /** The moment already has an answer: the additions are saved with « Enregistrer mes ajouts ». */
  answered: boolean
  onSaveAnswered: () => void
  busy: boolean
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(true)
  const [picking, setPicking] = useState(false)
  const active = tags.filter((x) => !x.archivedAt)
  const chosen = new Set(value.extraTags.map((x) => x.tagSlug))
  const labelOf = (slug: string) => tagLabel(t, slug, active.find((x) => x.slug === slug)?.label)
  const add = (slug: string) => {
    if (value.extraTags.length >= MAX_EXTRA_TAGS) return
    onChange({ ...value, extraTags: [...value.extraTags, { key: `x${++seq}`, tagSlug: slug, note: '' }] })
  }

  return (
    <div data-testid="answer-extras">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
        className="flex w-full items-center gap-1.5 border-t border-dashed border-hextech-border-dim pt-2 text-left text-xs text-hextech-text-dim hover:text-hextech-gold">
        <span className={cn('transition-transform', open && 'rotate-90')}>▸</span>{t('microReview.extras.toggle')}
      </button>
      {open && (
        <div className="mt-2 space-y-3">
          <div className="space-y-1">
            <label htmlFor="mr-reasons" className="text-xs font-medium text-hextech-text-bright">{t('microReview.extras.reasons')}</label>
            <textarea id="mr-reasons" value={value.reasons} onChange={(e) => onChange({ ...value, reasons: e.target.value.slice(0, REASONS_MAX) })} maxLength={REASONS_MAX}
              placeholder={t('microReview.extras.reasonsPlaceholder')}
              className="h-16 w-full resize-none rounded-md border border-hextech-border-dim bg-hextech-black px-2.5 py-2 text-sm text-hextech-text placeholder:text-hextech-text-dim focus:border-hextech-gold focus:outline-none" />
          </div>
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-hextech-text-bright">{t('microReview.extras.moreTags')}</p>
            {value.extraTags.map((x) => (
              <div key={x.key} className="flex items-center gap-1.5">
                <span className="shrink-0 rounded-full border border-hextech-red/50 bg-hextech-red/[0.14] px-2 py-0.5 text-[11px] text-hextech-text-bright">{labelOf(x.tagSlug)}</span>
                <input value={x.note} maxLength={TAG_NOTE_MAX} placeholder={t('microReview.extras.tagNote')} aria-label={t('microReview.extras.tagNote')}
                  onChange={(e) => onChange({ ...value, extraTags: value.extraTags.map((y) => (y.key === x.key ? { ...y, note: e.target.value } : y)) })}
                  className="min-w-0 flex-1 rounded-md border border-hextech-border-dim bg-hextech-black px-2 py-1 text-xs text-hextech-text focus:border-hextech-gold focus:outline-none" />
                <button type="button" onClick={() => onChange({ ...value, extraTags: value.extraTags.filter((y) => y.key !== x.key) })}
                  aria-label={t('microReview.extras.removeTag')} className="shrink-0 rounded p-1 text-hextech-text-dim hover:text-hextech-red">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            {value.extraTags.length < MAX_EXTRA_TAGS && (
              <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={() => setPicking((v) => !v)} aria-expanded={picking}>
                <Plus className="h-3.5 w-3.5" />{t('microReview.extras.addTag')}
              </Button>
            )}
            {picking && (
              <div className="space-y-1.5 rounded-md border border-hextech-border-dim bg-hextech-black p-2" data-testid="extras-tag-picker">
                <TagAutocomplete tags={active} autoFocus exclude={chosen} onPick={(x) => add(x.slug)} />
              </div>
            )}
          </div>
          <PreciseTimes value={value} onChange={onChange} />
          {answered ? (
            <Button size="sm" className="w-full" disabled={busy} onClick={onSaveAnswered}>{t('microReview.extras.save')}</Button>
          ) : (
            <p className="text-[11px] text-hextech-text-dim">{t('microReview.extras.sentWithAnswer')}</p>
          )}
        </div>
      )}
    </div>
  )
}
