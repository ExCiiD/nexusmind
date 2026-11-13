import { describe, it, expect, vi } from 'vitest'
import {
  listNotifications,
  countUnreadNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from '../../src/lib/notificationsCore'

function chainable(result: { data?: unknown; error?: unknown; count?: number }) {
  const chain: Record<string, unknown> = {}
  const methods = ['select', 'eq', 'order', 'limit', 'update']
  for (const m of methods) chain[m] = vi.fn().mockReturnValue(chain)
  // Any await on the chain resolves with `result` (mimics supabase-js's thenable builder).
  chain.then = (resolve: (v: unknown) => void) => resolve(result)
  return chain
}

describe('listNotifications', () => {
  it('maps rows and filters by user, optionally unread-only', async () => {
    const rows = [
      { id: '1', type: 'review_comment', data: { a: 1 }, link: '/review', read: false, created_at: '2026-01-01' },
    ]
    const chain = chainable({ data: rows, error: null })
    const sb = { from: vi.fn().mockReturnValue(chain) } as never
    const out = await listNotifications(sb, 'u1', { onlyUnread: true })
    expect(out).toEqual([{ id: '1', type: 'review_comment', data: { a: 1 }, link: '/review', read: false, createdAt: '2026-01-01' }])
    expect(chain.eq).toHaveBeenCalledWith('user_id', 'u1')
    expect(chain.eq).toHaveBeenCalledWith('read', false)
  })

  it('defaults data to {} when null', async () => {
    const rows = [{ id: '1', type: 'player_inactive', data: null, link: null, read: true, created_at: '2026-01-01' }]
    const sb = { from: vi.fn().mockReturnValue(chainable({ data: rows, error: null })) } as never
    const out = await listNotifications(sb, 'u1')
    expect(out[0].data).toEqual({})
  })

  it('throws on error', async () => {
    const sb = { from: vi.fn().mockReturnValue(chainable({ data: null, error: { message: 'boom' } })) } as never
    await expect(listNotifications(sb, 'u1')).rejects.toThrow('boom')
  })
})

describe('countUnreadNotifications', () => {
  it('returns the count', async () => {
    const sb = { from: vi.fn().mockReturnValue(chainable({ count: 3, error: null })) } as never
    await expect(countUnreadNotifications(sb, 'u1')).resolves.toBe(3)
  })
  it('defaults to 0 when count is null', async () => {
    const sb = { from: vi.fn().mockReturnValue(chainable({ count: undefined, error: null })) } as never
    await expect(countUnreadNotifications(sb, 'u1')).resolves.toBe(0)
  })
})

describe('markNotificationRead / markAllNotificationsRead', () => {
  it('updates a single notification by id', async () => {
    const chain = chainable({ error: null })
    const sb = { from: vi.fn().mockReturnValue(chain) } as never
    await markNotificationRead(sb, 'n1')
    expect(chain.update).toHaveBeenCalledWith({ read: true })
    expect(chain.eq).toHaveBeenCalledWith('id', 'n1')
  })

  it('updates all unread notifications for a user', async () => {
    const chain = chainable({ error: null })
    const sb = { from: vi.fn().mockReturnValue(chain) } as never
    await markAllNotificationsRead(sb, 'u1')
    expect(chain.update).toHaveBeenCalledWith({ read: true })
    expect(chain.eq).toHaveBeenCalledWith('user_id', 'u1')
    expect(chain.eq).toHaveBeenCalledWith('read', false)
  })
})
