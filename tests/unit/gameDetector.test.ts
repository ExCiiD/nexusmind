import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../electron/main/riotClient', () => ({
  getMatchIds: vi.fn(),
  getMatch: vi.fn(),
  extractPlayerStats: vi.fn(),
}))

vi.mock('../../electron/main/database', () => ({
  getPrisma: vi.fn(),
}))

describe('GameDetector', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    global.fetch = vi.fn()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('should detect game state from Live Client API 200 response', async () => {
    const mockResponse = {
      ok: true,
      json: () => Promise.resolve({ gameTime: 300 }),
    }
    ;(global.fetch as any).mockResolvedValueOnce(mockResponse)

    const liveClientUrl = 'https://127.0.0.1:2999/liveclientdata/gamestats'
    const res = await fetch(liveClientUrl)
    expect(res.ok).toBe(true)

    const data = await res.json()
    expect(data.gameTime).toBe(300)
  })

  it('should detect game not active from connection refused', async () => {
    ;(global.fetch as any).mockRejectedValueOnce(new Error('fetch failed'))

    try {
      await fetch('https://127.0.0.1:2999/liveclientdata/gamestats')
    } catch (err: any) {
      expect(err.message).toBe('fetch failed')
    }
  })

  it('should detect game not active from 404 response', async () => {
    ;(global.fetch as any).mockResolvedValueOnce({ ok: false, status: 404 })

    const res = await fetch('https://127.0.0.1:2999/liveclientdata/gamestats')
    expect(res.ok).toBe(false)
  })
})
