import { useEffect, useId, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { completeTitle } from '@/lib/planningView'

export interface SuggestGroup {
  id: string
  label: string
  icon: ComponentType<{ className?: string }>
}

export interface SuggestOption {
  /** What the form stores (a slug, an id). */
  value: string
  /** What the user reads and types. */
  label: string
  group: string
}

/**
 * A text field that replaces a long dropdown: the user types, an inline
 * completion is accepted with Tab or Enter (same gesture as the planning's
 * slot title), and a row of icons above the field shows the suggestions of
 * one family when it is hovered, focused or clicked. Picking a suggestion
 * writes its label in the field.
 *
 * The field only holds text: the caller decides what the text resolves to
 * (a known option, or a new value when free text is allowed).
 */
export function SuggestField({
  label, placeholder, value, onChange, groups, options, hint, invalid, maxLength = 80,
  completionHint, suggestionsLabel, emptyGroupLabel, testId,
}: {
  label: string
  placeholder: string
  value: string
  onChange: (text: string) => void
  groups: SuggestGroup[]
  options: SuggestOption[]
  /** Line under the field: what the typed text means (known value, new value, error). */
  hint?: ReactNode
  invalid?: boolean
  maxLength?: number
  completionHint: (completion: string) => string
  /** Accessible name of a family icon. */
  suggestionsLabel: (group: string) => string
  emptyGroupLabel: string
  testId?: string
}) {
  const id = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout>>()
  const [open, setOpen] = useState<string | null>(null)
  const labels = useMemo(() => options.map((o) => o.label), [options])
  const completion = completeTitle(value, labels)
  const shown = open ? options.filter((o) => o.group === open) : []
  const openGroup = groups.find((g) => g.id === open)

  useEffect(() => () => clearTimeout(closeTimer.current), [])

  const show = (group: string) => { clearTimeout(closeTimer.current); setOpen(group) }
  // A short delay: the pointer crosses the field between the icons and the list.
  const hideSoon = () => { clearTimeout(closeTimer.current); closeTimer.current = setTimeout(() => setOpen(null), 180) }
  const pick = (text: string) => { onChange(text); setOpen(null); inputRef.current?.focus() }

  return (
    <div
      className="relative"
      data-testid={testId}
      onMouseLeave={hideSoon}
      onMouseEnter={() => clearTimeout(closeTimer.current)}
      onKeyDown={(e) => { if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(null) } }}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) hideSoon() }}
    >
      {/* Label, then the icons on their own row: two fields side by side keep
          their inputs aligned whatever the number of families. */}
      <div className="mb-1.5">
        <label htmlFor={id} className="block font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-hextech-text-dim">{label}</label>
        <div className="mt-1 flex flex-wrap gap-1" role="group" aria-label={label}>
          {groups.map((g) => {
            const Icon = g.icon
            const active = open === g.id
            return (
              <button
                key={g.id}
                type="button"
                title={g.label}
                aria-label={suggestionsLabel(g.label)}
                aria-expanded={active}
                aria-controls={`${id}-list`}
                onMouseEnter={() => show(g.id)}
                onFocus={() => show(g.id)}
                onClick={() => (active ? setOpen(null) : show(g.id))}
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded border transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-hextech-gold',
                  active
                    ? 'border-hextech-gold bg-hextech-gold/15 text-hextech-gold-bright'
                    : 'border-hextech-border-dim text-hextech-text hover:border-hextech-border hover:text-hextech-text-bright',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
              </button>
            )
          })}
        </div>
      </div>

      <div className={cn('relative rounded-md bg-hextech-elevated', invalid && 'ring-1 ring-hextech-red/70')}>
        {/* Ghost completion behind the (transparent) input: the typed text is kept
            invisible for alignment, the rest is greyed out. */}
        {completion && (
          <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center overflow-hidden whitespace-pre px-3 text-sm">
            <span className="invisible">{value}</span>
            <span className="text-hextech-text-dim">{completion.slice(value.length)}</span>
          </div>
        )}
        <input
          id={id}
          ref={inputRef}
          value={value}
          maxLength={maxLength}
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder}
          aria-invalid={invalid || undefined}
          aria-describedby={`${id}-hint`}
          onFocus={() => setOpen(null)}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if ((e.key === 'Tab' || e.key === 'Enter') && completion) { e.preventDefault(); onChange(completion) }
            else if (e.key === 'Enter') e.preventDefault()
          }}
          className="relative z-10 h-9 w-full rounded-md border border-hextech-border-dim bg-transparent px-3 text-sm text-hextech-text-bright outline-none placeholder:text-hextech-text-dim focus:border-hextech-gold"
        />
      </div>
      <p id={`${id}-hint`} className="mt-1 min-h-4 text-[11px] leading-4 text-hextech-text-dim">
        {completion ? completionHint(completion) : hint}
      </p>

      {openGroup && (
        <div
          id={`${id}-list`}
          role="listbox"
          aria-label={suggestionsLabel(openGroup.label)}
          className="absolute inset-x-0 top-full z-30 -mt-1 rounded-md border border-hextech-border bg-hextech-dark p-2.5 shadow-lg"
          onMouseEnter={() => clearTimeout(closeTimer.current)}
        >
          <p className="mb-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-hextech-gold">{openGroup.label}</p>
          {shown.length === 0 ? (
            <p className="text-[11px] text-hextech-text-dim">{emptyGroupLabel}</p>
          ) : (
            <div className="flex max-h-44 flex-wrap gap-1.5 overflow-y-auto">
              {shown.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  aria-selected={o.label === value}
                  onClick={() => pick(o.label)}
                  className={cn(
                    'rounded border px-2 py-1 text-left text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-hextech-gold',
                    o.label === value
                      ? 'border-hextech-gold bg-hextech-gold/15 text-hextech-gold-bright'
                      : 'border-hextech-border-dim text-hextech-text-bright hover:border-hextech-gold/60',
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
