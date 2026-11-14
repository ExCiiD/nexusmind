import { describe, it, expect, vi } from 'vitest'
import { listScrimsForGroup } from '../../src/lib/scrimsCore'

function chain(result: unknown) {
  const c: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'order', 'limit']) c[m] = vi.fn().mockReturnValue(c)
  c.then = (resolve: (v: unknown) => void) => resolve(result)
  return c
}

describe('listScrimsForGroup', () => {
  it('maps rows to ScrimSummary', async () => {
    const sb = { from: vi.fn(() => chain({
      data: [{ id: 's1', title: 'Scrim night', opponent: 'Rival', scheduled_at: '2026-11-20T18:00:00Z', duration_min: 120 }],
      error: null,
    })) } as never
    const out = await listScrimsForGroup(sb, 'g1')
    expect(out).toEqual([{ id: 's1', title: 'Scrim night', opponent: 'Rival', scheduledAt: '2026-11-20T18:00:00Z', durationMin: 120 }])
  })

  it('throws on a read error', async () => {
    const sb = { from: vi.fn(() => chain({ data: null, error: { message: 'boom' } })) } as never
    await expect(listScrimsForGroup(sb, 'g1')).rejects.toThrow('boom')
  })

  it('maps a permission error to FORBIDDEN', async () => {
    const sb = { from: vi.fn(() => chain({ data: null, error: { message: 'permission denied', code: '42501' } })) } as never
    await expect(listScrimsForGroup(sb, 'g1')).rejects.toThrow('FORBIDDEN')
  })
})
