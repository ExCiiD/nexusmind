import { useTranslation } from 'react-i18next'
import { Loader2, X, Database, Search, Wand2 } from 'lucide-react'
import { useBackgroundJobsStore, type BackgroundJobKind } from '@/store/useBackgroundJobsStore'
import { cn } from '@/lib/utils'

/**
 * Persistent corner pill that shows every background job currently running
 * (auto-fill loops, scout loops). Mounted at the app root so it survives
 * page navigation — the whole point of moving the loops out of the
 * originating tabs is that the user can switch from Scouting to Stats Flex
 * without aborting the work.
 *
 * Renders nothing when no jobs are active to stay invisible in the common
 * case.
 */
const KIND_ICON: Record<BackgroundJobKind, typeof Database> = {
  autoFill: Wand2,
  scoutAll: Search,
  scoutOne: Search,
}

const KIND_COLOR: Record<BackgroundJobKind, string> = {
  autoFill: 'border-hextech-gold/60 bg-hextech-dark/95',
  scoutAll: 'border-red-500/60 bg-hextech-dark/95',
  scoutOne: 'border-red-500/60 bg-hextech-dark/95',
}

export function BackgroundJobsIndicator() {
  const jobs = useBackgroundJobsStore((s) => s.jobs)
  const cancel = useBackgroundJobsStore((s) => s.cancelJob)
  const { t } = useTranslation()

  if (jobs.length === 0) return null

  return (
    // Bottom-right, above the toast slot. z-50 to clear the AppLayout
    // headers; pointer-events on inner pills only so the empty wrapper
    // doesn't intercept clicks on whatever's behind it.
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      {jobs.map((job) => {
        const Icon = KIND_ICON[job.kind]
        // Progress can briefly be > total if a loop completes its last
        // iteration before the removal effect fires — clamp to total to
        // keep the bar from overflowing.
        const done = Math.min(job.done, job.total)
        const pct = job.total > 0 ? Math.round((done / job.total) * 100) : 0
        const elapsed = Math.round((Date.now() - job.startedAt) / 1000)
        return (
          <div
            key={job.id}
            className={cn(
              'pointer-events-auto rounded-lg border shadow-xl px-3 py-2 min-w-[260px] max-w-[360px] space-y-1.5 backdrop-blur-md',
              KIND_COLOR[job.kind],
            )}
          >
            <div className="flex items-center gap-2">
              <Icon className="h-3.5 w-3.5 text-hextech-gold shrink-0" />
              <Loader2 className="h-3 w-3 text-hextech-gold animate-spin shrink-0" />
              <span className="text-xs font-semibold text-hextech-text-bright truncate flex-1">
                {job.label}
              </span>
              <button
                onClick={() => cancel(job.id)}
                title={t('jobs.cancel', { defaultValue: 'Cancel after current player' })}
                disabled={job.cancelled}
                className="text-hextech-text-dim hover:text-red-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="flex items-center justify-between text-[10px] text-hextech-text-dim">
              <span className="truncate">
                {job.currentName
                  ? t('jobs.progress', {
                      defaultValue: '{{name}} · {{done}}/{{total}}',
                      name: job.currentName,
                      done: done + (job.total > 1 ? 1 : 0),
                      total: job.total,
                    })
                  : t('jobs.starting', { defaultValue: 'Starting…' })}
              </span>
              <span className="shrink-0 ml-2">{elapsed}s</span>
            </div>

            {/* Determinate bar — gives users a sense of speed and ETA
                without needing a numeric timer. Width transitions are
                gentle (300ms) so the bar doesn't snap between members. */}
            <div className="h-1 bg-black/40 rounded overflow-hidden">
              <div
                className="h-full bg-hextech-gold transition-all duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>

            {job.cancelled && (
              <p className="text-[10px] text-amber-300 italic">
                {t('jobs.cancelling', { defaultValue: 'Stopping after current player…' })}
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}
