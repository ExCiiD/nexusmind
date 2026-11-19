import { describe, it, expect, vi } from 'vitest'
import { describeMatch, listScrimsForGroup } from '../../src/lib/scrimsCore'

function chain(result: unknown) {
  const c: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'order', 'limit']) c[m] = vi.fn().mockReturnValue(c)
  c.then = (resolve: (v: unknown) => void) => resolve(result)
  return c
}

describe('listScrimsForGroup', () => {
  it('maps rows to ScrimSummary, with the #49 slot, kind and opponent key', async () => {
    const sb = { from: vi.fn(() => chain({
      data: [{ id: 's1', title: 'Scrim night', opponent: 'Rival', scheduled_at: '2026-11-20T18:00:00Z', duration_min: 120, bo_format: 'bo3',
        opponent_scouting_id: 't1', calendar_event_id: 'e1', kind: 'official', opponent_key: 'rival' }],
      error: null,
    })) } as never
    const out = await listScrimsForGroup(sb, 'g1')
    expect(out).toEqual([{ id: 's1', title: 'Scrim night', opponent: 'Rival', scheduledAt: '2026-11-20T18:00:00Z', durationMin: 120, boFormat: 'bo3',
      opponentScoutingId: 't1', calendarEventId: 'e1', kind: 'official', opponentKey: 'rival' }])
  })

  it('before the #49 migration: reads again without the new columns, a plain scrim without a slot', async () => {
    const selects: string[] = []
    const sb = { from: vi.fn(() => {
      const c: Record<string, unknown> = {}
      let cols = ''
      c.select = vi.fn((s: string) => { cols = s; selects.push(s); return c })
      for (const m of ['eq', 'order', 'limit']) c[m] = vi.fn().mockReturnValue(c)
      c.then = (resolve: (v: unknown) => void) => resolve(cols.includes('calendar_event_id')
        ? { data: null, error: { code: '42703', message: 'column scrims.calendar_event_id does not exist' } }
        : { data: [{ id: 's1', title: 'T', opponent: null, scheduled_at: 'x', duration_min: 60, bo_format: null, opponent_scouting_id: null }], error: null })
      return c
    }) } as never
    const out = await listScrimsForGroup(sb, 'g1')
    expect(selects).toHaveLength(2)
    expect(out[0]).toMatchObject({ calendarEventId: null, kind: 'scrim', opponentKey: null })
  })

  it('describeMatch names a match the way the bot shows it', () => {
    expect(describeMatch({ kind: 'scrim', opponent: 'KCA', boFormat: 'bo3' })).toBe('Scrim vs KCA (BO3)')
    expect(describeMatch({ kind: 'official', opponentName: 'KCA', boFormat: null })).toBe('Official vs KCA')
    expect(describeMatch({ kind: null, opponent: null })).toBe('Scrim')
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
