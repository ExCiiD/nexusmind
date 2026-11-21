import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { formatMs } from '@/lib/mediaCore'
import { fmtClock } from '@/lib/mistakeInsights'
import { isMicroReviewBookmark } from '@/lib/playerLayers'
import { MicroReviewPanel } from '@/components/MicroReview/MicroReviewPanel'
import { useReviewPlayerStore, type ReviewPanelTab } from '@/store/useReviewPlayerStore'

/**
 * The Review player's right panel (DECISIONS 21/11, spec § 19 point 3, § 20): 360 px next to the player, a two-
 * segment selector « Micro-review 2 / 3 · Notes marquées 4 ». By default the micro-review while a moment is left to
 * answer, else the marked notes. Gold outline in micro-review mode. « Je fais mes reviews moi-même »: no selector,
 * the marked notes only.
 */
export function ReviewSidePanel({ gameId, selfReview, onAnswered }: { gameId: string; selfReview: boolean; onAnswered: () => void }) {
  const { t } = useTranslation()
  const bookmarks = useReviewPlayerStore((s) => s.bookmarks)
  const count = useReviewPlayerStore((s) => s.microReviewCount)
  const tab = useReviewPlayerStore((s) => s.panelTab)
  const playerHeight = useReviewPlayerStore((s) => s.playerHeight)
  // « AUTO » on: the detected mistakes come after the notes.
  const autoOn = useReviewPlayerStore((s) => s.layers.mistakes)
  const detected = useReviewPlayerStore((s) => s.detectedMistakes)
  const requestSeek = useReviewPlayerStore((s) => s.requestSeek)
  const shownDetected = autoOn ? detected : []
  const setTab = useReviewPlayerStore((s) => s.setPanelTab)
  const requestVideoSeek = useReviewPlayerStore((s) => s.requestVideoSeek)
  const reloadBookmarks = useReviewPlayerStore((s) => s.reloadBookmarks)
  // A new game: back to the default choice.
  useEffect(() => { useReviewPlayerStore.setState({ panelTab: null, microReviewCount: null }) }, [gameId])

  const defaultTab: ReviewPanelTab = !selfReview && (!count || count.done < count.total) ? 'microReview' : 'notes'
  const current: ReviewPanelTab = selfReview ? 'notes' : tab ?? defaultTab
  const notes = [...bookmarks].sort((a, b) => a.videoTimeMs - b.videoTimeMs)
  // The player's micro-review mode follows the tab shown (spec § 19: back to 100 % when leaving the micro-review).
  useEffect(() => { useReviewPlayerStore.setState({ activeTab: current }) }, [current])
  useEffect(() => () => useReviewPlayerStore.setState({ activeTab: null }), [])

  const segment = (id: ReviewPanelTab, label: string, counter: string) => (
    <button type="button" role="tab" aria-selected={current === id} onClick={() => setTab(id)}
      className={cn('flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs transition-colors',
        current === id ? 'border border-hextech-gold bg-hextech-elevated text-hextech-gold-bright' : 'border border-transparent text-hextech-text hover:text-hextech-text-bright')}>
      {label}<span className="font-mono text-[10px] text-hextech-text-dim">{counter}</span>
    </button>
  )

  return (
    <aside data-testid="review-side-panel"
      // Beta.20: the same height as the player beside it (lg, side by side); stacked under it, at most 80 % of the screen.
      style={playerHeight ? ({ '--player-h': `${playerHeight}px` } as React.CSSProperties) : undefined}
      className={cn('flex max-h-[80vh] min-h-0 flex-col gap-3 overflow-y-auto rounded-lg border bg-hextech-dark p-4',
        playerHeight && 'lg:h-[var(--player-h)] lg:max-h-none',
        current === 'microReview' ? 'border-hextech-gold' : 'border-hextech-border-dim')}>
      {!selfReview && (
        <div role="tablist" aria-label={t('review.panel.label')} className="flex w-full max-w-[328px] gap-1 rounded-lg border border-hextech-border-dim bg-hextech-black p-1">
          {segment('microReview', t('review.panel.microReview'), count ? `${count.done} / ${count.total}` : '')}
          {segment('notes', t('review.panel.notes'), String(notes.length))}
        </div>
      )}
      {/* Kept mounted: its answers, extras and the player's window survive a switch to the notes. */}
      {!selfReview && (
        <div className={cn(current !== 'microReview' && 'hidden')}>
          <MicroReviewPanel gameId={gameId} sharedPlayer onAnswered={() => { reloadBookmarks(); onAnswered() }} onFinish={() => setTab('notes')} />
        </div>
      )}
      {current === 'notes' && shownDetected.length > 0 && notes.length === 0 ? null : current === 'notes' && (
        notes.length === 0 ? (
          <p className="text-sm text-hextech-text-dim" data-testid="marked-notes-empty">{t('review.panel.notesEmpty')}</p>
        ) : (
          <ul className="space-y-1" data-testid="marked-notes">
            {notes.map((b) => {
              const mr = isMicroReviewBookmark(b)
              return (
                <li key={b.id}>
                  <button type="button" onClick={() => requestVideoSeek(b.videoTimeMs)}
                    className="w-full rounded-md px-2 py-2 text-left transition-colors hover:bg-white/5">
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-xs text-hextech-gold">{formatMs(b.videoTimeMs)}</span>
                      <span className={cn('rounded px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-wider',
                        mr ? 'bg-[#E66556]/15 text-[#E66556]' : 'bg-hextech-gold/15 text-hextech-gold')}>
                        {t(mr ? 'review.panel.sourceMicroReview' : 'review.panel.sourceNote')}
                      </span>
                    </span>
                    <span className="mt-0.5 block break-words text-sm text-hextech-text-bright">{b.label || t('record.player.unlabeled')}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        )
      )}
      {current === 'notes' && shownDetected.length > 0 && (
        <div className="space-y-1" data-testid="panel-detected">
          <p className="px-2 font-mono text-[10px] uppercase tracking-wider text-hextech-text-dim">{t('review.panel.detectedTitle')}</p>
          <ul className="space-y-1">
            {shownDetected.map((m) => (
              <li key={m.id}>
                <button type="button" onClick={() => (m.videoTimeMs != null ? requestVideoSeek(m.videoTimeMs) : requestSeek(m.gameTimeSec))}
                  className="w-full rounded-md px-2 py-2 text-left transition-colors hover:bg-white/5">
                  <span className="flex items-center gap-2">
                    <span className="font-mono text-xs text-amber-400">{fmtClock(m.gameTimeSec)}</span>
                    <span className="rounded bg-amber-500/15 px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-wider text-amber-400">{t('review.panel.sourceAuto')}</span>
                  </span>
                  <span className="mt-0.5 block break-words text-sm text-hextech-text-bright">{m.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  )
}
