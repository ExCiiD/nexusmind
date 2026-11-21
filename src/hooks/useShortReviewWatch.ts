import { useEffect, useRef, type RefObject } from 'react'
import { SHORT_REVIEW_WATCH_SEC, addWatched } from '@/lib/shortReview'
import { invalidateCached } from '@/lib/queryCache'

/**
 * « Review courte » from the player: once 60 s of the game's recording were played (seeks don't count), the game is
 * marked as short-reviewed, once per opening. Listens to the <video> inside `containerRef` (media events don't
 * bubble, so in the capture phase). Desktop only: the API is optional.
 */
export function useShortReviewWatch(containerRef: RefObject<HTMLElement>, gameId: string | null) {
  const done = useRef(false)
  useEffect(() => {
    done.current = false
    const el = containerRef.current
    if (!el || !gameId) return
    let total = 0
    let prev: number | null = null
    const onTime = (e: Event) => {
      const v = e.target
      if (done.current || !(v instanceof HTMLVideoElement)) return
      total = addWatched(total, v.paused ? null : prev, v.currentTime)
      prev = v.currentTime
      if (total < SHORT_REVIEW_WATCH_SEC) return
      done.current = true
      window.api.gameMarkShortReview?.(gameId, 'player')
        .then(() => invalidateCached('games:'))
        .catch(() => { done.current = false })
    }
    const onSeek = (e: Event) => { if (e.target instanceof HTMLVideoElement) prev = e.target.currentTime }
    el.addEventListener('timeupdate', onTime, true)
    el.addEventListener('seeked', onSeek, true)
    return () => {
      el.removeEventListener('timeupdate', onTime, true)
      el.removeEventListener('seeked', onSeek, true)
    }
  }, [containerRef, gameId])
}
