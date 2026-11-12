import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Zap, Database, Clock, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

/**
 * Scope of a fetch (champion-pool fill, opponent scout):
 *   - "quick"    : last ~100 games, ~2 min on a Riot Personal API key.
 *                   Default — covers ranked tiers' main/comfort thresholds
 *                   without burning the rate-limit budget.
 *   - "complete" : every season game Riot exposes (capped at 2500). On a
 *                   Personal key this takes 20–30 min per player, so the
 *                   dialog warns explicitly before launching it. On a
 *                   Production key it's near-instant.
 */
export type FetchScope = 'quick' | 'complete'

interface Props {
  open: boolean
  /** Number of players that will be processed sequentially with this scope.
   *  Used to show a more accurate time estimate (5 × ~2 min ≠ 1 × ~2 min). */
  playerCount?: number
  /** Optional verb shown in the title. Defaults to "Fetch". */
  actionLabel?: string
  onCancel: () => void
  onConfirm: (scope: FetchScope) => void
}

export function ScopeDialog({ open, playerCount = 1, actionLabel, onCancel, onConfirm }: Props) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState<FetchScope | null>(null)

  // Rough time hints based on a Personal key (100 req per 120s). These
  // numbers don't need to be exact — they exist so the user can make an
  // informed choice between "I want it now" and "I want everything".
  // Per-player numbers come from observed dev-runs in v0.2.0-beta.39.
  const quickPerPlayer = 2 // minutes
  const completePerPlayer = 20 // minutes worst-case
  const quickTotal = quickPerPlayer * Math.max(1, playerCount)
  const completeTotal = completePerPlayer * Math.max(1, playerCount)

  const handleChoose = (scope: FetchScope) => {
    setBusy(scope)
    // Defer the close to the next tick so the spinner has time to render
    // — otherwise large auto-fills can feel like nothing happened on click.
    setTimeout(() => {
      onConfirm(scope)
      setBusy(null)
    }, 0)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !busy) onCancel() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Database className="h-4 w-4 text-hextech-gold" />
            {actionLabel ?? t('team.scope.title', { defaultValue: 'How thorough should we fetch?' })}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {t('team.scope.desc', {
              defaultValue: 'Riot caps free API keys at ~100 requests per 2 minutes. Pick how deep you want this fetch to go.',
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <ScopeOption
            disabled={!!busy}
            active={busy === 'quick'}
            icon={<Zap className="h-4 w-4 text-emerald-400" />}
            title={t('team.scope.quickTitle', { defaultValue: 'Quick (recommended)' })}
            subtitle={t('team.scope.quickSubtitle', {
              defaultValue: 'Last ~100 games per player · enough for the main/comfort tier thresholds',
            })}
            time={t('team.scope.timeEstimate', {
              defaultValue: '~{{min}} min total ({{perPlayer}} min × {{count}} player(s))',
              min: quickTotal,
              perPlayer: quickPerPlayer,
              count: Math.max(1, playerCount),
            })}
            accent="emerald"
            onClick={() => handleChoose('quick')}
          />

          <ScopeOption
            disabled={!!busy}
            active={busy === 'complete'}
            icon={<Database className="h-4 w-4 text-amber-400" />}
            title={t('team.scope.completeTitle', { defaultValue: 'Complete season' })}
            subtitle={t('team.scope.completeSubtitle', {
              defaultValue: 'Every season game Riot still has on record · most accurate game counts',
            })}
            time={t('team.scope.completeTimeEstimate', {
              defaultValue: '~{{min}} min total ({{perPlayer}} min × {{count}} player(s)) — much faster on a Production key',
              min: completeTotal,
              perPlayer: completePerPlayer,
              count: Math.max(1, playerCount),
            })}
            warning={t('team.scope.completeWarning', {
              defaultValue: 'You can keep using the rest of the app, but new Riot calls (other scouts, dashboard refresh) will queue behind this one.',
            })}
            accent="amber"
            onClick={() => handleChoose('complete')}
          />
        </div>

        <div className="text-[10px] text-hextech-text-dim italic flex items-start gap-1.5">
          <Clock className="h-3 w-3 shrink-0 mt-px" />
          <span>
            {t('team.scope.cacheNote', {
              defaultValue: 'Previously-scanned matches are cached on disk — every subsequent fetch is near-instant.',
            })}
          </span>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onCancel} disabled={!!busy}>
            {t('common.cancel', { defaultValue: 'Cancel' })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ScopeOption({
  icon, title, subtitle, time, warning, accent, onClick, disabled, active,
}: {
  icon: React.ReactNode
  title: string
  subtitle: string
  time: string
  warning?: string
  accent: 'emerald' | 'amber'
  onClick: () => void
  disabled?: boolean
  active?: boolean
}) {
  // Per-accent border + hover colors. Kept inline so the option is fully
  // self-contained and Tailwind's purge picks up the classes.
  const accentClasses = accent === 'emerald'
    ? 'hover:border-emerald-500/70 hover:bg-emerald-500/5 focus:ring-emerald-500/40'
    : 'hover:border-amber-500/70 hover:bg-amber-500/5 focus:ring-amber-500/40'

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'w-full text-left border border-hextech-border rounded-lg p-3 transition-colors focus:outline-none focus:ring-2 disabled:opacity-50 disabled:cursor-not-allowed',
        accentClasses,
        active && (accent === 'emerald' ? 'border-emerald-500 bg-emerald-500/10' : 'border-amber-500 bg-amber-500/10'),
      )}
    >
      <div className="flex items-start gap-2">
        <div className="mt-0.5 shrink-0">
          {active ? <Loader2 className="h-4 w-4 animate-spin text-hextech-gold" /> : icon}
        </div>
        <div className="flex-1 min-w-0 space-y-1">
          <p className="text-sm font-bold text-hextech-text-bright">{title}</p>
          <p className="text-[11px] text-hextech-text-dim leading-snug">{subtitle}</p>
          <p className="text-[10px] text-hextech-text-dim/70 italic flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {time}
          </p>
          {warning && (
            <p className="text-[10px] text-amber-300/90 leading-snug border-l-2 border-amber-400/40 pl-1.5 mt-1.5">
              {warning}
            </p>
          )}
        </div>
      </div>
    </button>
  )
}

/** Maps the scope picked in the dialog to the `matchCount` value the IPC
 *  layer expects. Centralized so frontend callers don't reinvent the
 *  mapping (and so we can bump the "quick" default in one place). */
export function scopeToMatchCount(scope: FetchScope): number {
  return scope === 'quick' ? 100 : -1 // -1 = no cap, fetch entire season
}
