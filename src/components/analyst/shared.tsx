import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Progress } from '@/components/ui/progress'
import { useChampionIconUrl } from '@/hooks/useChampionIconUrl'
import type { TeamSide } from '@/lib/analyst'

/**
 * #40: building blocks shared by the three analyst screens (Objectifs, Journal des drafts, Dossier adverse).
 * Design System pieces (KPI tile, segmented control, chips, badges) in the app's tokens; Graphic Design will pass
 * over them against the Penpot boards.
 */

export const analystPanel = 'rounded-lg border border-hextech-border-dim bg-hextech-dark'

/** KPI tile: label, value (already coloured by the caller), foot line in mono. */
export function AnalystTile({ label, icon, value, valueClass, foot, note }: {
  label: string
  icon?: ReactNode
  value: string
  valueClass?: string
  foot?: ReactNode
  /** E.g. "échantillon faible". */
  note?: string
}) {
  return (
    <div className={cn(analystPanel, 'p-4')}>
      <div className="mb-2 flex items-center justify-between text-hextech-text">
        <span className="text-xs font-medium">{label}</span>
        {icon && <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-hextech-border-dim text-hextech-gold" aria-hidden>{icon}</span>}
      </div>
      <div className="flex items-baseline gap-2">
        <span className={cn('font-mono text-2xl font-extrabold tabular-nums', valueClass ?? 'text-hextech-text-bright')}>{value}</span>
        {note && <span className="text-[10px] text-hextech-text-dim">{note}</span>}
      </div>
      {foot && <div className="mt-2 border-t border-hextech-border-dim/50 pt-2 font-mono text-[11px] text-hextech-text-dim">{foot}</div>}
    </div>
  )
}

/** Segmented control (one choice), a radiogroup: one tab stop (the checked option), ← / → (or ↑ / ↓) move the choice. */
export function Segmented<T extends string>({ label, options, value, onChange }: {
  label: string
  options: Array<{ id: T; label: string }>
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-md border border-hextech-border-dim p-0.5">
      {options.map((o, i) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          tabIndex={value === o.id ? 0 : -1}
          onClick={() => onChange(o.id)}
          onKeyDown={(e) => {
            const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
            if (!d) return
            e.preventDefault()
            const next = options[(i + d + options.length) % options.length]
            onChange(next.id)
            const group = e.currentTarget.parentElement
            setTimeout(() => (group?.querySelectorAll<HTMLButtonElement>('[role=radio]')[options.indexOf(next)])?.focus(), 0)
          }}
          className={cn(
            'rounded px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hextech-gold',
            value === o.id ? 'bg-hextech-gold text-hextech-black' : 'text-hextech-text hover:text-hextech-text-bright',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Toggle chip (several can be on). */
export function FilterChip({ on, onToggle, children }: { on: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onToggle}
      className={cn(
        'rounded-full border px-2.5 py-0.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hextech-gold',
        on ? 'border-hextech-gold bg-hextech-gold/15 text-hextech-gold' : 'border-hextech-border-dim text-hextech-text hover:text-hextech-text-bright',
      )}
    >
      {children}
    </button>
  )
}

/** Blue / red side pill, with the word (never colour alone). */
export function SidePill({ side }: { side: TeamSide }) {
  const { t } = useTranslation()
  return (
    <span className={cn('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold',
      side === 'blue' ? 'bg-sky-500/15 text-sky-300' : 'bg-rose-500/15 text-rose-300')}>
      <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', side === 'blue' ? 'bg-sky-400' : 'bg-rose-400')} />
      {t(`analyst.common.side.${side}`)}
    </span>
  )
}

/** One game's result: a result, not a rate, so hextech green / red (§ 9 rule 3). null: not known (a hand-typed draft). */
export function ResultBadge({ win }: { win: boolean | null }) {
  const { t } = useTranslation()
  if (win === null) return <span className="text-[10px] text-hextech-text-dim">—</span>
  return (
    <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-bold uppercase',
      win ? 'bg-hextech-green/15 text-hextech-green' : 'bg-hextech-red/15 text-hextech-red')}>
      {t(win ? 'analyst.common.win' : 'analyst.common.loss')}
    </span>
  )
}

/** Champion icon; `banned` greys it and crosses it out diagonally. */
export function ChampIcon({ championKey, size = 28, banned = false, role }: { championKey: string; size?: number; banned?: boolean; role?: string }) {
  const url = useChampionIconUrl(championKey)
  return (
    <span className="relative inline-block shrink-0" style={{ width: size, height: size }} title={championKey}>
      {url
        ? <img src={url} alt={championKey} loading="lazy" decoding="async" className={cn('h-full w-full rounded object-cover', banned && 'opacity-40 grayscale')} />
        : <span className="block h-full w-full rounded bg-hextech-elevated" />}
      {banned && <span aria-hidden className="absolute left-1/2 top-1/2 h-[140%] w-px -translate-x-1/2 -translate-y-1/2 rotate-45 bg-hextech-red/80" />}
      {role && <sup className="absolute -right-1 -top-1 rounded bg-hextech-black/90 px-0.5 font-mono text-[8px] leading-tight text-hextech-text">{role}</sup>}
    </span>
  )
}

/** "Lecture des timelines : 12 / 18 games" style banner with a progress bar. */
export function ProgressBanner({ label, done, total }: { label: string; done: number; total: number }) {
  return (
    <div role="status" className={cn(analystPanel, 'space-y-2 p-3 text-sm text-hextech-text')}>
      <p>{label}</p>
      <Progress value={total > 0 ? (done / total) * 100 : 0} aria-hidden />
    </div>
  )
}

/** Gold (info) or amber (partial data) banner. */
export function NoticeBanner({ tone = 'gold', children }: { tone?: 'gold' | 'amber'; children: ReactNode }) {
  const Icon = tone === 'gold' ? Info : AlertTriangle
  return (
    <div role="status" className={cn('flex items-start gap-2 rounded-lg border p-3 text-xs',
      tone === 'gold' ? 'border-hextech-gold/40 bg-hextech-gold/5 text-hextech-gold' : 'border-amber-400/40 bg-amber-400/5 text-amber-200')}>
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <div>{children}</div>
    </div>
  )
}
