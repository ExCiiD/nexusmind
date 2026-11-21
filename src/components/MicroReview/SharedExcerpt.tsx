import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Scissors } from 'lucide-react'
import { cn } from '@/lib/utils'
import { fmtClock } from '@/lib/mistakeInsights'
import { clipWindow } from '@/lib/microReview/vodTiming'
import type { CriticalMoment } from '@/lib/microReview/anomalyDetector'
import { useReviewPlayerStore } from '@/store/useReviewPlayerStore'

const MARKER_COLOR = { error: '#E3A35B', consequence: 'var(--hextech-red)', conclusion: 'var(--hextech-text)' } as const

/**
 * « Parcourir dans le lecteur » (DECISIONS 21/11 « Un seul lecteur vidéo »; spec § 20 point 1 bis, § 23): the micro-
 * review has no video of its own. It hands the moment's window and its 3 markers to the Review's player, which jumps
 * to the start of the window when another moment opens (not on the page's first display); the three pills Erreur ·
 * Conséquence · Conclusion jump to their time, the active one with a 2 px outline. « Clipper ce moment » opens the
 * player's clip mode on the window.
 */
export function SharedExcerpt({ moment }: { moment: CriticalMoment }) {
  const { t } = useTranslation()
  const setClip = useReviewPlayerStore((s) => s.setClip)
  const requestSeek = useReviewPlayerStore((s) => s.requestSeek)
  const requestClip = useReviewPlayerStore((s) => s.requestClip)
  const win = clipWindow(moment)
  const first = useRef(true)
  const [active, setActive] = useState<'error' | 'consequence' | 'conclusion' | null>(null)

  useEffect(() => {
    setClip({ momentKey: moment.key, startSec: win.startSec, endSec: win.endSec, markers: win.markers })
    setActive(null)
    if (first.current) first.current = false
    else requestSeek(win.startSec)
  }, [moment.key]) // eslint-disable-line react-hooks/exhaustive-deps -- once per moment
  useEffect(() => () => setClip(null), [setClip])

  const marks = (['error', 'consequence', 'conclusion'] as const).flatMap((k) => {
    const sec = win.markers[k]
    return sec == null ? [] : [{ k, sec }]
  })
  return (
    <div className="space-y-1.5" data-testid="micro-review-shared-excerpt">
      <p className="font-mono text-[10px] uppercase tracking-wider text-hextech-text-dim">{t('microReview.vod.browse')}</p>
      <div className="flex flex-wrap gap-1.5" data-testid="micro-review-markers">
        {marks.map(({ k, sec }) => (
          <button key={k} type="button" aria-pressed={active === k} onClick={() => { setActive(k); requestSeek(sec) }}
            className={cn('flex items-center gap-1.5 rounded-full bg-hextech-black px-2.5 py-1 text-[11px] text-hextech-text-bright transition-colors',
              active === k ? 'border-2' : 'border hover:bg-white/5')}
            style={{ borderColor: MARKER_COLOR[k] }}>
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: MARKER_COLOR[k] }} />
            {t(`microReview.vod.markers.${k}`)} <span className="font-mono text-hextech-text-dim">{fmtClock(sec)}</span>
          </button>
        ))}
      </div>
      <button type="button" onClick={() => requestClip({ startSec: win.startSec, endSec: win.endSec })} data-testid="clip-this-moment"
        className="flex items-center gap-1 text-[11px] text-hextech-text-dim hover:text-hextech-gold">
        <Scissors className="h-3 w-3" />{t('recording.clip.thisMoment')}
      </button>
    </div>
  )
}
