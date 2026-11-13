import { describe, it, expect, vi } from 'vitest'
import {
  listSessions, createSession, addComment, addActionItem, setActionItemDone, setAssignment, setAssignmentStatus,
} from '../../src/lib/vodReviewCore'

function chain(result: unknown) {
  const c: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'order']) c[m] = vi.fn().mockReturnValue(c)
  c.then = (resolve: (v: unknown) => void) => resolve(result)
  return c
}

describe('listSessions', () => {
  it('hydrates a session with its comments, action items and assignments', async () => {
    const sessions = chain({
      data: [{ id: 's1', group_id: 'g1', scrim_id: null, title: 'Scrim review', vod_url: 'https://x', created_by: 'u1', created_at: 't', updated_at: 't' }],
      error: null,
    })
    const comments = chain({ data: [{ id: 'c1', session_id: 's1', author_id: 'u1', video_time_sec: 90, team_tag: 'rotation', body: 'bad rotation', created_at: 't' }], error: null })
    const items = chain({ data: [{ id: 'a1', session_id: 's1', text: 'practice baron', done: false, done_by: null, done_at: null, created_by: 'u1', created_at: 't' }], error: null })
    const assignments = chain({ data: [{ id: 'as1', session_id: 's1', player_id: 'u2', range_start_sec: 60, range_end_sec: 180, status: 'pending', created_at: 't', updated_at: 't' }], error: null })
    const sb = {
      from: vi.fn((t: string) => ({
        vod_review_sessions: sessions, vod_review_comments: comments, vod_review_action_items: items, vod_review_assignments: assignments,
      }[t])),
    } as never

    const out = await listSessions(sb, 'g1')
    expect(out).toHaveLength(1)
    expect(out[0].title).toBe('Scrim review')
    expect(out[0].comments).toEqual([{ id: 'c1', sessionId: 's1', authorId: 'u1', videoTimeSec: 90, teamTag: 'rotation', body: 'bad rotation', createdAt: 't' }])
    expect(out[0].actionItems[0].text).toBe('practice baron')
    expect(out[0].assignments[0]).toEqual({ id: 'as1', sessionId: 's1', playerId: 'u2', rangeStartSec: 60, rangeEndSec: 180, status: 'pending', createdAt: 't', updatedAt: 't' })
  })

  it('throws on a read error', async () => {
    const sb = { from: vi.fn(() => chain({ data: null, error: { message: 'boom' } })) } as never
    await expect(listSessions(sb, 'g1')).rejects.toThrow('boom')
  })

  it('maps a permission error to FORBIDDEN', async () => {
    const sb = { from: vi.fn(() => chain({ data: null, error: { message: 'permission denied', code: '42501' } })) } as never
    await expect(listSessions(sb, 'g1')).rejects.toThrow('FORBIDDEN')
  })
})

describe('createSession / addComment / addActionItem', () => {
  it('createSession inserts with the given fields', async () => {
    const insert = vi.fn(() => ({ select: () => ({ single: () => Promise.resolve({ data: { id: 's1' }, error: null }) }) }))
    const sb = { from: vi.fn(() => ({ insert })) } as never
    const id = await createSession(sb, 'g1', { title: 'Review', vodUrl: 'https://x' })
    expect(id).toBe('s1')
    expect(insert).toHaveBeenCalledWith({ group_id: 'g1', scrim_id: null, title: 'Review', vod_url: 'https://x' })
  })

  it('addComment inserts a timestamped comment', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null })
    const sb = { from: vi.fn(() => ({ insert })) } as never
    await addComment(sb, 's1', { videoTimeSec: 42, teamTag: 'communication', body: 'missed call' })
    expect(insert).toHaveBeenCalledWith({ session_id: 's1', video_time_sec: 42, team_tag: 'communication', body: 'missed call' })
  })

  it('addActionItem inserts just the text', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null })
    const sb = { from: vi.fn(() => ({ insert })) } as never
    await addActionItem(sb, 's1', 'practice baron setup')
    expect(insert).toHaveBeenCalledWith({ session_id: 's1', text: 'practice baron setup' })
  })
})

describe('setActionItemDone / setAssignment / setAssignmentStatus', () => {
  it('setActionItemDone(true) stamps done_by/done_at from the current user', async () => {
    const update = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) }))
    const sb = { from: vi.fn(() => ({ update })), auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) } } as never
    await setActionItemDone(sb, 'a1', true)
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ done: true, done_by: 'u1' }))
  })

  it('setActionItemDone(false) clears done_by/done_at', async () => {
    const update = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) }))
    const sb = { from: vi.fn(() => ({ update })), auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) } } as never
    await setActionItemDone(sb, 'a1', false)
    expect(update).toHaveBeenCalledWith({ done: false, done_by: null, done_at: null })
  })

  it('setAssignment inserts the watch range for a player', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null })
    const sb = { from: vi.fn(() => ({ insert })) } as never
    await setAssignment(sb, 's1', { playerId: 'u2', rangeStartSec: 60, rangeEndSec: 180 })
    expect(insert).toHaveBeenCalledWith({ session_id: 's1', player_id: 'u2', range_start_sec: 60, range_end_sec: 180 })
  })

  it('setAssignmentStatus updates the status', async () => {
    const update = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) }))
    const sb = { from: vi.fn(() => ({ update })) } as never
    await setAssignmentStatus(sb, 'as1', 'done')
    expect(update).toHaveBeenCalledWith({ status: 'done' })
  })
})
