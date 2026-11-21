import { useCallback, useEffect, useState } from 'react'
import { parseQueue, type YoutubeQueueItem } from '@/lib/youtubeQueue'

/**
 * Back-end's automatic YouTube upload queue (DECISIONS 21/11): youtube:queue-list once, then the whole list pushed on
 * youtube:queue-changed; « Réessayer » through youtube:queue-retry. Desktop only (an empty list elsewhere).
 */
export function useYoutubeQueue(): { items: YoutubeQueueItem[]; retry: (id: string) => Promise<void>; reload: () => void } {
  const [items, setItems] = useState<YoutubeQueueItem[]>([])
  const reload = useCallback(() => {
    window.api.youtubeQueueList?.().then((l) => setItems(parseQueue(l))).catch(() => setItems([]))
  }, [])
  useEffect(() => {
    reload()
    return window.api.onYoutubeQueueChanged?.((l) => setItems(parseQueue(l)))
  }, [reload])
  const retry = useCallback(async (id: string) => {
    await window.api.youtubeQueueRetry?.(id).catch(() => undefined)
    reload()
  }, [reload])
  return { items, retry, reload }
}
