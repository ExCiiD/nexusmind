import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Bloc-notes (DECISIONS 21/11, spec § 19 point 5): full-width card, a free text area of 160 px at least that grows
 * with its content, saved automatically (« Enregistré · il y a 3 s »). No time, no add button: you write, that's all.
 * The notes guide sits under it, folded (`guide`).
 */
export function NotepadCard({ value, onChange, savedAt, guide }: { value: string; onChange: (v: string) => void; savedAt: number | null; guide?: ReactNode }) {
  const { t } = useTranslation()
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.max(160, el.scrollHeight)}px`
  }, [value])
  // « il y a N s » keeps counting.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (savedAt == null) return
    const id = setInterval(() => setNow(Date.now()), 5_000)
    return () => clearInterval(id)
  }, [savedAt])
  const ago = savedAt == null ? null : Math.max(0, Math.round((Math.max(now, savedAt) - savedAt) / 1000))

  return (
    <section className="space-y-2 rounded-lg border border-hextech-border-dim bg-hextech-dark p-4" data-testid="review-notepad-card">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold text-hextech-text-bright">{t('review.notepad.title')}</h3>
        {ago != null && (
          <span className="font-mono text-[10px] text-hextech-text-dim">
            {ago < 60 ? t('review.notepad.savedSec', { n: ago }) : t('review.notepad.savedMin', { n: Math.round(ago / 60) })}
          </span>
        )}
      </div>
      <p className="text-xs text-hextech-text">{t('review.notepad.hint')}</p>
      <textarea ref={ref} value={value} onChange={(e) => onChange(e.target.value)} placeholder={t('review.notepad.placeholder')}
        aria-label={t('review.notepad.title')} data-testid="review-notepad"
        className="min-h-[160px] w-full resize-none overflow-hidden rounded-md border border-hextech-border-dim bg-hextech-elevated px-3 py-2.5 text-sm text-hextech-text placeholder:text-hextech-text-dim focus:border-hextech-gold focus:outline-none" />
      {guide}
    </section>
  )
}
