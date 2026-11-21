import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Scissors } from 'lucide-react'
import { clipWindow } from '@/lib/microReview/vodTiming'
import type { CriticalMoment } from '@/lib/microReview/anomalyDetector'
import { useReviewPlayerStore } from '@/store/useReviewPlayerStore'

/**
 * « Parcourir dans le lecteur » (DECISIONS 21/11 « Un seul lecteur vidéo »; spec § 20 point 1 bis, § 23): the micro-
 * review has no video of its own. It hands the moment's window to the Review's player, which jumps to the start of the
 * window when another moment opens (not on the page's first display). « Clipper ce moment » opens the player's clip
 * mode on the window. Beta.20: no automatic Erreur · Conséquence · Conclusion markers any more.
 */
export function SharedExcerpt({ moment }: { moment: CriticalMoment }) {
  const { t } = useTranslation()
  const setClip = useReviewPlayerStore((s) => s.setClip)
  const requestSeek = useReviewPlayerStore((s) => s.requestSeek)
  const requestClip = useReviewPlayerStore((s) => s.requestClip)
  const win = clipWindow(moment)
  const first = useRef(true)

  useEffect(() => {
    setClip({ momentKey: moment.key, startSec: win.startSec, endSec: win.endSec })
    if (first.current) first.current = false
    else requestSeek(win.startSec)
  }, [moment.key]) // eslint-disable-line react-hooks/exhaustive-deps -- once per moment
  useEffect(() => () => setClip(null), [setClip])

  return (
    <div className="space-y-1.5" data-testid="micro-review-shared-excerpt">
      <button type="button" onClick={() => requestClip({ startSec: win.startSec, endSec: win.endSec })} data-testid="clip-this-moment"
        className="flex items-center gap-1 text-[11px] text-hextech-text-dim hover:text-hextech-gold">
        <Scissors className="h-3 w-3" />{t('recording.clip.thisMoment')}
      </button>
    </div>
  )
}
