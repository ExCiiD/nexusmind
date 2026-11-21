import { useId, useMemo, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import type { MistakeTag } from '@/lib/ipc'
import { tagLabel } from './text'

const MAX_SUGGESTIONS = 8

/** Tags matching a query: the translated name or the slug contains it, names starting with it first. Pure, tested. */
export function matchTags(tags: MistakeTag[], query: string, labelOf: (t: MistakeTag) => string, exclude: ReadonlySet<string> = new Set()): MistakeTag[] {
  const q = query.trim().toLowerCase()
  const usable = tags.filter((x) => !x.archivedAt && !exclude.has(x.slug))
  if (!q) return usable.slice(0, MAX_SUGGESTIONS)
  const hits = usable.filter((x) => labelOf(x).toLowerCase().includes(q) || x.slug.includes(q))
  const starts = (x: MistakeTag) => (labelOf(x).toLowerCase().startsWith(q) ? 0 : 1)
  return hits.sort((a, b) => starts(a) - starts(b)).slice(0, MAX_SUGGESTIONS)
}

/**
 * Tag search with auto-completion (beta.20 feedback, instead of the scrolling list): type, the matching tags show
 * under the field; ↑ ↓ to move, Entrée to pick, Échap to close. The player's tags and the Codex's (the Lab's list).
 */
export function TagAutocomplete({ tags, onPick, placeholder, exclude, autoFocus, value, className }: {
  tags: MistakeTag[]
  onPick: (tag: MistakeTag) => void
  placeholder?: string
  /** Slugs not offered (already picked, or the mistake's own tag). */
  exclude?: ReadonlySet<string>
  autoFocus?: boolean
  /** A single choice shows its name in the field once picked. */
  value?: MistakeTag | null
  className?: string
}) {
  const { t } = useTranslation()
  const id = useId()
  const labelOf = (x: MistakeTag) => tagLabel(t, x.slug, x.label)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const matches = useMemo(() => matchTags(tags, query, labelOf, exclude), [tags, query, exclude]) // eslint-disable-line react-hooks/exhaustive-deps -- labelOf follows t

  const pick = (tag: MistakeTag) => {
    onPick(tag)
    setQuery('')
    setOpen(false)
    setActive(0)
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((i) => Math.min(matches.length - 1, i + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)) }
    else if (e.key === 'Enter') {
      if (open && matches[active]) { e.preventDefault(); e.stopPropagation(); pick(matches[active]) }
    } else if (e.key === 'Escape' && open) { e.preventDefault(); e.stopPropagation(); setOpen(false) }
  }

  return (
    <div className={cn('relative', className)}>
      <input
        type="text" role="combobox" aria-expanded={open} aria-controls={`${id}-list`} aria-autocomplete="list"
        aria-activedescendant={open && matches[active] ? `${id}-${matches[active].id}` : undefined}
        autoFocus={autoFocus} value={query} placeholder={value ? labelOf(value) : placeholder ?? t('review.detected.searchTag')}
        aria-label={placeholder ?? t('review.detected.searchTag')}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); setActive(0) }}
        onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 120)} onKeyDown={onKey}
        className={cn('w-full rounded-md border bg-hextech-black px-2.5 py-1.5 text-sm text-hextech-text focus:border-hextech-gold focus:outline-none',
          value ? 'border-hextech-gold/60 placeholder:text-hextech-text-bright' : 'border-hextech-border-dim placeholder:text-hextech-text-dim')}
        data-testid="tag-autocomplete" />
      {open && matches.length > 0 && (
        <ul id={`${id}-list`} role="listbox" className="absolute left-0 right-0 top-full z-50 mt-1 max-h-60 overflow-y-auto rounded-md border border-hextech-border bg-hextech-elevated py-1 shadow-xl">
          {matches.map((x, i) => (
            <li key={x.id} id={`${id}-${x.id}`} role="option" aria-selected={i === active}
              onMouseDown={(e) => { e.preventDefault(); pick(x) }} onMouseEnter={() => setActive(i)}
              className={cn('flex cursor-pointer items-center justify-between gap-2 px-2.5 py-1 text-sm',
                i === active ? 'bg-hextech-gold/15 text-hextech-gold-bright' : 'text-hextech-text')}>
              <span className="truncate">{labelOf(x)}</span>
              <span className="shrink-0 text-[10px] capitalize text-hextech-text-dim">{x.category}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
