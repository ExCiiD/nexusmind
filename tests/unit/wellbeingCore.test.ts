import { describe, it, expect, vi } from 'vitest'
import { addCheckin, listMine, listForGroup, computeMoodDeclineAlert, computeEnergyWinrateCorrelation } from '../../src/lib/wellbeingCore'
import type { WellbeingCheckin } from '../../src/lib/wellbeing'

function chain(result: unknown) {
  const c: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'order', 'limit']) c[m] = vi.fn().mockReturnValue(c)
  c.then = (resolve: (v: unknown) => void) => resolve(result)
  return c
}

describe('addCheckin / listMine / listForGroup', () => {
  it('addCheckin inserts the four fields', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null })
    const sb = { from: vi.fn(() => ({ insert })) } as never
    await addCheckin(sb, { energy: 4, mood: 3, sleep: 5, note: 'ok' })
    expect(insert).toHaveBeenCalledWith({ energy: 4, mood: 3, sleep: 5, note: 'ok' })
  })

  it('listMine maps rows for the given user', async () => {
    const sb = { from: vi.fn(() => chain({ data: [{ id: 'c1', user_id: 'u1', energy: 3, mood: 4, sleep: 5, note: null, created_at: 't' }], error: null })) } as never
    const out = await listMine(sb, 'u1')
    expect(out).toEqual([{ id: 'c1', userId: 'u1', energy: 3, mood: 4, sleep: 5, note: null, createdAt: 't' }])
  })

  it('listForGroup returns [] without hitting the network for an empty player list', async () => {
    const from = vi.fn()
    const sb = { from } as never
    const out = await listForGroup(sb, [])
    expect(out).toEqual([])
    expect(from).not.toHaveBeenCalled()
  })

  it('throws on a read error', async () => {
    const sb = { from: vi.fn(() => chain({ data: null, error: { message: 'boom' } })) } as never
    await expect(listMine(sb, 'u1')).rejects.toThrow('boom')
  })
})

describe('computeMoodDeclineAlert', () => {
  const mk = (day: string, mood: number): WellbeingCheckin => ({ id: day, userId: 'u1', energy: 3, mood, sleep: 3, note: null, createdAt: `${day}T12:00:00Z` })

  it('flags a strictly decreasing mood over the last 3 days with a check-in', () => {
    const checkins = [mk('2026-11-10', 5), mk('2026-11-11', 4), mk('2026-11-12', 2)]
    expect(computeMoodDeclineAlert(checkins)).toBe(true)
  })

  it('does not flag when mood is flat or improving', () => {
    const checkins = [mk('2026-11-10', 2), mk('2026-11-11', 3), mk('2026-11-12', 4)]
    expect(computeMoodDeclineAlert(checkins)).toBe(false)
  })

  it('does not flag with fewer than 3 distinct days', () => {
    expect(computeMoodDeclineAlert([mk('2026-11-11', 4), mk('2026-11-12', 2)])).toBe(false)
  })
})

describe('computeEnergyWinrateCorrelation', () => {
  it('splits win rate by whether that day\'s average energy was low (<=2)', () => {
    const checkins: WellbeingCheckin[] = [
      { id: 'c1', userId: 'u1', energy: 1, mood: 3, sleep: 3, note: null, createdAt: '2026-11-10T09:00:00Z' },
      { id: 'c2', userId: 'u1', energy: 5, mood: 3, sleep: 3, note: null, createdAt: '2026-11-11T09:00:00Z' },
    ]
    const games = [
      { win: true, gameEndAt: '2026-11-10T20:00:00Z' },
      { win: false, gameEndAt: '2026-11-10T21:00:00Z' },
      { win: true, gameEndAt: '2026-11-11T20:00:00Z' },
      { win: true, gameEndAt: '2026-11-12T20:00:00Z' }, // no check-in that day -> ignored
    ]
    const out = computeEnergyWinrateCorrelation(checkins, games)
    expect(out).toEqual({ lowEnergyGames: 2, lowEnergyWinrate: 50, otherGames: 1, otherWinrate: 100 })
  })

  it('returns nulls when there is no matching data', () => {
    expect(computeEnergyWinrateCorrelation([], [])).toEqual({ lowEnergyGames: 0, lowEnergyWinrate: null, otherGames: 0, otherWinrate: null })
  })
})
