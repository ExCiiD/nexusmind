import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * Data-state templates (Graphic Design, docs/DESIGN_STATE.md § 7, Penpot
 * "Design System" → "États des données"). Apply them to states that already
 * exist; do not invent new ones.
 */

/** Shared frame: `dark` panel, `border-dim` outline, padding 32, centred. */
function StateFrame({ tone, icon: Icon, title, description, children, className, role }: {
  tone: 'gold' | 'red'
  icon: LucideIcon
  title: string
  description?: ReactNode
  children?: ReactNode
  className?: string
  role?: 'status' | 'alert'
}) {
  return (
    <div role={role} className={cn('rounded-lg border border-hextech-border-dim bg-hextech-dark p-8 text-center', className)}>
      <span
        aria-hidden
        className={cn(
          'mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg border',
          tone === 'gold' ? 'border-hextech-gold/25 bg-hextech-gold/10 text-hextech-gold' : 'border-hextech-red/25 bg-hextech-red/10 text-hextech-red',
        )}
      >
        <Icon className="h-5 w-5" />
      </span>
      <h3 className="font-display text-base text-hextech-text-bright">{title}</h3>
      {description && <p className="mx-auto mt-1 max-w-md text-sm text-hextech-text">{description}</p>}
      {children}
    </div>
  )
}

/**
 * Empty state: icon chip, card title, one sentence saying what to do next,
 * then the main action (+ an optional secondary one in outline). With two
 * buttons the row needs ≥ 460 px: below that the buttons wrap and stack full
 * width (FR labels overflow at 380 px). Pure CSS — each button has a 226 px
 * basis and grows, inside a row capped at 520 px, so two fit side by side
 * from 460 px (226 + 8 + 226) and wrap below.
 */
export function EmptyState({ icon, title, description, action, secondaryAction, className }: {
  icon: LucideIcon
  title: string
  description?: ReactNode
  action?: { label: string; onClick: () => void; icon?: LucideIcon }
  secondaryAction?: { label: string; onClick: () => void; icon?: LucideIcon }
  className?: string
}) {
  const two = !!(action && secondaryAction)
  return (
    <StateFrame tone="gold" icon={icon} title={title} description={description} className={className} role="status">
      {action && (
        <div className={cn('mt-5 flex justify-center gap-2', two && 'mx-auto max-w-[520px] flex-wrap')}>
          <Button onClick={action.onClick} className={cn('gap-2', two && 'grow basis-[226px]')}>
            {action.icon && <action.icon className="h-4 w-4" aria-hidden />}
            {action.label}
          </Button>
          {secondaryAction && (
            <Button variant="outline" onClick={secondaryAction.onClick} className="gap-2 grow basis-[226px]">
              {secondaryAction.icon && <secondaryAction.icon className="h-4 w-4" aria-hidden />}
              {secondaryAction.label}
            </Button>
          )}
        </div>
      )}
    </StateFrame>
  )
}

/** Error state: same frame, red chip, the cause in plain words, what is still possible, "Retry" in outline. */
export function ErrorState({ title, cause, hint, onRetry, className }: {
  title: string
  cause: ReactNode
  hint?: ReactNode
  onRetry?: () => void
  className?: string
}) {
  const { t } = useTranslation()
  return (
    <StateFrame tone="red" icon={AlertTriangle} title={title} className={className} role="alert"
      description={<>{cause}{hint && <span className="mt-1 block text-hextech-text-dim">{hint}</span>}</>}
    >
      {onRetry && (
        <Button variant="outline" onClick={onRetry} className="mt-5 gap-2">
          <RefreshCw className="h-4 w-4" aria-hidden />
          {t('dataState.retry')}
        </Button>
      )}
    </StateFrame>
  )
}

/** Loading placeholder: `elevated`, radius 4, sized like the content it stands for. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('animate-pulse rounded bg-hextech-elevated', className)} />
}

/** A list of skeleton rows (history-like lists), announced once as "Loading…". */
export function SkeletonRows({ rows = 5, className }: { rows?: number; className?: string }) {
  const { t } = useTranslation()
  return (
    <div role="status" aria-label={t('common.loading')} className={cn('space-y-2', className)}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-lg border border-hextech-border-dim bg-hextech-dark p-3">
          <Skeleton className="h-10 w-10 shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-2.5 w-64 max-w-full" />
          </div>
          <Skeleton className="h-6 w-16 shrink-0" />
        </div>
      ))}
    </div>
  )
}

/** KPI tile skeleton (label 80×10, chip 28×28, value 96×22, foot 120×8). */
export function SkeletonKpiTiles({ count = 4, className }: { count?: number; className?: string }) {
  const { t } = useTranslation()
  return (
    <div role="status" aria-label={t('common.loading')} className={cn('grid grid-cols-2 gap-3 lg:grid-cols-4', className)}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="space-y-3 rounded-lg border border-hextech-border-dim bg-hextech-dark p-4">
          <div className="flex items-center justify-between">
            <Skeleton className="h-2.5 w-20" />
            <Skeleton className="h-7 w-7" />
          </div>
          <Skeleton className="h-[22px] w-24" />
          <Skeleton className="h-2 w-[120px]" />
        </div>
      ))}
    </div>
  )
}
