import { describe, it, expect, vi } from 'vitest'
import { getDevPlanForPlayer, getMyDevPlan, createDevPlan, setAxisStatus, addCheckin, setProgress } from '../../src/lib/devPlanCore'

function chain(result: unknown) {
  const c: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'order', 'limit']) c[m] = vi.fn().mockReturnValue(c)
  c.maybeSingle = vi.fn().mockResolvedValue(result)
  c.then = (resolve: (v: unknown) => void) => resolve(result)
  return c
}

describe('getDevPlanForPlayer / getMyDevPlan', () => {
  it('returns null when no plan exists', async () => {
    const sb = { from: vi.fn(() => chain({ data: null, error: null })) } as never
    await expect(getDevPlanForPlayer(sb, 'g1', 'p1')).resolves.toBeNull()
  })

  it('hydrates axes, their progress, and check-ins for the found plan', async () => {
    const plans = chain({ data: { id: 'plan1', group_id: 'g1', player_id: 'p1', title: 'Q1 focus', period_start: null, period_end: null, created_at: 't', updated_at: 't' }, error: null })
    const axes = chain({
      data: [{ id: 'a1', plan_id: 'plan1', fundamental_id: 'wave_management', target_text: 'Freeze more', position: 1, status: 'active', created_at: 't', updated_at: 't' }],
      error: null,
    })
    const progress = chain({ data: [{ axis_id: 'a1', player_marked_done: true, player_note: 'going well', updated_at: 't' }], error: null })
    const checkins = chain({ data: [{ id: 'c1', plan_id: 'plan1', note: '1:1 note', created_by: 'coach1', created_at: 't' }], error: null })
    const sb = {
      from: vi.fn((t: string) => ({ dev_plans: plans, dev_plan_axes: axes, dev_plan_progress: progress, dev_plan_checkins: checkins }[t])),
    } as never

    const plan = await getMyDevPlan(sb, 'g1', 'p1')
    expect(plan?.title).toBe('Q1 focus')
    expect(plan?.axes).toHaveLength(1)
    expect(plan?.axes[0].progress).toEqual({ playerMarkedDone: true, playerNote: 'going well', updatedAt: 't' })
    expect(plan?.checkins[0].note).toBe('1:1 note')
  })

  it('throws on a read error', async () => {
    const sb = { from: vi.fn(() => chain({ data: null, error: { message: 'boom' } })) } as never
    await expect(getDevPlanForPlayer(sb, 'g1', 'p1')).rejects.toThrow('boom')
  })

  it('maps a permission error to FORBIDDEN', async () => {
    const sb = { from: vi.fn(() => chain({ data: null, error: { message: 'permission denied', code: '42501' } })) } as never
    await expect(getDevPlanForPlayer(sb, 'g1', 'p1')).rejects.toThrow('FORBIDDEN')
  })
})

describe('createDevPlan', () => {
  it('creates the plan then its axes, in order', async () => {
    const calls: string[] = []
    const tables: Record<string, any> = {
      dev_plans: {
        insert: vi.fn(() => { calls.push('insert-plan'); return { select: () => ({ single: () => Promise.resolve({ data: { id: 'plan1' }, error: null }) }) } }),
      },
      dev_plan_axes: {
        insert: vi.fn(() => { calls.push('insert-axes'); return Promise.resolve({ error: null }) }),
      },
    }
    const sb = { from: vi.fn((t: string) => tables[t]) } as never

    const id = await createDevPlan(sb, 'g1', 'p1', 'Q1 focus', [{ fundamentalId: 'tempo', targetText: 'Die less', position: 1 }])
    expect(id).toBe('plan1')
    expect(calls).toEqual(['insert-plan', 'insert-axes'])
  })
})

describe('setAxisStatus / addCheckin / setProgress', () => {
  it('setAxisStatus updates the axis row', async () => {
    const update = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) }))
    const sb = { from: vi.fn(() => ({ update })) } as never
    await setAxisStatus(sb, 'a1', 'done')
    expect(update).toHaveBeenCalledWith({ status: 'done' })
  })

  it('addCheckin inserts a row for the plan', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null })
    const sb = { from: vi.fn(() => ({ insert })) } as never
    await addCheckin(sb, 'plan1', 'good progress')
    expect(insert).toHaveBeenCalledWith({ plan_id: 'plan1', note: 'good progress' })
  })

  it('setProgress upserts only the provided fields', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null })
    const sb = { from: vi.fn(() => ({ upsert })) } as never
    await setProgress(sb, 'a1', { playerMarkedDone: true })
    expect(upsert).toHaveBeenCalledWith({ axis_id: 'a1', player_marked_done: true }, { onConflict: 'axis_id' })
  })
})
