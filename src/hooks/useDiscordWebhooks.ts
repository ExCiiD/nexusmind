import { useState, useEffect, useCallback } from 'react'
import type { DiscordWebhook } from '@/lib/ipc'

export type { DiscordWebhook }

export function useDiscordWebhooks() {
  const [webhooks, setWebhooks] = useState<DiscordWebhook[]>([])
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    try {
      const data = await window.api.listWebhooks()
      setWebhooks(data)
    } catch {
      // Non-critical — leave current state unchanged
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { reload() }, [reload])

  return { webhooks, loading, reload }
}
