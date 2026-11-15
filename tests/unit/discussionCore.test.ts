import { describe, it, expect, vi } from 'vitest'
import { listDiscussion, addDiscussionComment, deleteDiscussionComment } from '../../src/lib/discussionCore'

function chain(result: unknown) {
  const c: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'order']) c[m] = vi.fn().mockReturnValue(c)
  c.then = (resolve: (v: unknown) => void) => resolve(result)
  return c
}

describe('listDiscussion', () => {
  it('maps rows to DiscussionComment, filtered by subject', async () => {
    const eqSpy = vi.fn().mockReturnThis()
    const c: Record<string, unknown> = { select: vi.fn().mockReturnThis(), eq: eqSpy, order: vi.fn().mockReturnThis() }
    c.then = (resolve: (v: unknown) => void) => resolve({
      data: [{ id: 'c1', group_id: 'g1', subject_type: 'scrim', subject_id: 's1', author_id: 'u1', body: 'gl hf', created_at: 't' }],
      error: null,
    })
    const sb = { from: vi.fn(() => c) } as never
    const out = await listDiscussion(sb, 'scrim', 's1')
    expect(out).toEqual([{ id: 'c1', groupId: 'g1', subjectType: 'scrim', subjectId: 's1', authorId: 'u1', body: 'gl hf', createdAt: 't' }])
    expect(eqSpy).toHaveBeenCalledWith('subject_type', 'scrim')
    expect(eqSpy).toHaveBeenCalledWith('subject_id', 's1')
  })

  it('throws on a read error', async () => {
    const sb = { from: vi.fn(() => chain({ data: null, error: { message: 'boom' } })) } as never
    await expect(listDiscussion(sb, 'draft', 'd1')).rejects.toThrow('boom')
  })
})

describe('addDiscussionComment', () => {
  it('inserts with the given fields and returns the new id', async () => {
    const insert = vi.fn((row: unknown) => {
      expect(row).toEqual({ group_id: 'g1', subject_type: 'draft', subject_id: 'd1', body: 'nice pick' })
      return { select: () => ({ single: () => Promise.resolve({ data: { id: 'c1' }, error: null }) }) }
    })
    const sb = { from: vi.fn(() => ({ insert })) } as never
    const id = await addDiscussionComment(sb, 'g1', 'draft', 'd1', 'nice pick')
    expect(id).toBe('c1')
  })

  it('maps a permission error to FORBIDDEN', async () => {
    const insert = vi.fn(() => ({ select: () => ({ single: () => Promise.resolve({ data: null, error: { message: 'permission denied', code: '42501' } }) }) }))
    const sb = { from: vi.fn(() => ({ insert })) } as never
    await expect(addDiscussionComment(sb, 'g1', 'scrim', 's1', 'x')).rejects.toThrow('FORBIDDEN')
  })
})

describe('deleteDiscussionComment', () => {
  it('deletes by id', async () => {
    const del = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) }))
    const sb = { from: vi.fn(() => ({ delete: del })) } as never
    await deleteDiscussionComment(sb, 'c1')
    expect(del).toHaveBeenCalled()
  })
})
