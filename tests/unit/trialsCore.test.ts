import { describe, it, expect, vi } from 'vitest'
import { listCandidates, createCandidate, setCandidateStatus, addEvaluation } from '../../src/lib/trialsCore'

function chain(result: unknown) {
  const c: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'order']) c[m] = vi.fn().mockReturnValue(c)
  c.then = (resolve: (v: unknown) => void) => resolve(result)
  return c
}

describe('listCandidates', () => {
  it('hydrates a candidate with its evaluations', async () => {
    const candidates = chain({
      data: [{ id: 'c1', group_id: 'g1', display_name: 'Jg Candidate', role: 'JUNGLE', user_id: null, status: 'trialing', period_start: '2026-11-14', period_end: '2026-11-28', notes: null, created_by: 'u1', created_at: 't', updated_at: 't' }],
      error: null,
    })
    const evaluations = chain({ data: [{ id: 'e1', candidate_id: 'c1', criterion: 'Macro', score: 4, note: null, created_by: 'u1', created_at: 't' }], error: null })
    const sb = { from: vi.fn((t: string) => ({ trial_candidates: candidates, trial_evaluations: evaluations }[t])) } as never

    const out = await listCandidates(sb, 'g1')
    expect(out).toHaveLength(1)
    expect(out[0].displayName).toBe('Jg Candidate')
    expect(out[0].evaluations).toEqual([{ id: 'e1', candidateId: 'c1', criterion: 'Macro', score: 4, note: null, createdBy: 'u1', createdAt: 't' }])
  })

  it('throws on a read error', async () => {
    const sb = { from: vi.fn(() => chain({ data: null, error: { message: 'boom' } })) } as never
    await expect(listCandidates(sb, 'g1')).rejects.toThrow('boom')
  })

  it('maps a permission error to FORBIDDEN', async () => {
    const sb = { from: vi.fn(() => chain({ data: null, error: { message: 'permission denied', code: '42501' } })) } as never
    await expect(listCandidates(sb, 'g1')).rejects.toThrow('FORBIDDEN')
  })
})

describe('createCandidate / setCandidateStatus / addEvaluation', () => {
  it('createCandidate inserts with null defaults for optional fields', async () => {
    const insert = vi.fn(() => ({ select: () => ({ single: () => Promise.resolve({ data: { id: 'c1' }, error: null }) }) }))
    const sb = { from: vi.fn(() => ({ insert })) } as never
    const id = await createCandidate(sb, 'g1', { displayName: 'Candidate X', role: 'TOP' })
    expect(id).toBe('c1')
    expect(insert).toHaveBeenCalledWith({ group_id: 'g1', display_name: 'Candidate X', role: 'TOP', period_start: null, period_end: null, notes: null })
  })

  it('setCandidateStatus updates the status', async () => {
    const update = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) }))
    const sb = { from: vi.fn(() => ({ update })) } as never
    await setCandidateStatus(sb, 'c1', 'kept')
    expect(update).toHaveBeenCalledWith({ status: 'kept' })
  })

  it('addEvaluation inserts the criterion/score/note', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null })
    const sb = { from: vi.fn(() => ({ insert })) } as never
    await addEvaluation(sb, 'c1', { criterion: 'Macro', score: 4 })
    expect(insert).toHaveBeenCalledWith({ candidate_id: 'c1', criterion: 'Macro', score: 4, note: null })
  })
})
