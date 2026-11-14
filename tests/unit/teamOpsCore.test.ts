import { describe, it, expect, vi } from 'vitest'
import {
  listAnnouncements, createAnnouncement, setAnnouncementPinned, listTasks, createTask, setTaskStatus,
  listStaffNotes, addStaffNote,
} from '../../src/lib/teamOpsCore'

function chain(result: unknown) {
  const c: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'order']) c[m] = vi.fn().mockReturnValue(c)
  c.then = (resolve: (v: unknown) => void) => resolve(result)
  return c
}

describe('announcements', () => {
  it('listAnnouncements maps rows', async () => {
    const sb = { from: vi.fn(() => chain({
      data: [{ id: 'a1', group_id: 'g1', title: 'Hi', body: 'Welcome', pinned: true, created_by: 'u1', created_at: 't', updated_at: 't' }],
      error: null,
    })) } as never
    const out = await listAnnouncements(sb, 'g1')
    expect(out).toEqual([{ id: 'a1', groupId: 'g1', title: 'Hi', body: 'Welcome', pinned: true, createdBy: 'u1', createdAt: 't', updatedAt: 't' }])
  })

  it('createAnnouncement inserts with pinned defaulting to false', async () => {
    const insert = vi.fn(() => ({ select: () => ({ single: () => Promise.resolve({ data: { id: 'a1' }, error: null }) }) }))
    const sb = { from: vi.fn(() => ({ insert })) } as never
    const id = await createAnnouncement(sb, 'g1', { title: 'Hi', body: 'Welcome' })
    expect(id).toBe('a1')
    expect(insert).toHaveBeenCalledWith({ group_id: 'g1', title: 'Hi', body: 'Welcome', pinned: false })
  })

  it('setAnnouncementPinned updates the pinned flag', async () => {
    const update = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) }))
    const sb = { from: vi.fn(() => ({ update })) } as never
    await setAnnouncementPinned(sb, 'a1', true)
    expect(update).toHaveBeenCalledWith({ pinned: true })
  })

  it('throws on a read error', async () => {
    const sb = { from: vi.fn(() => chain({ data: null, error: { message: 'boom' } })) } as never
    await expect(listAnnouncements(sb, 'g1')).rejects.toThrow('boom')
  })
})

describe('tasks', () => {
  it('listTasks maps rows', async () => {
    const sb = { from: vi.fn(() => chain({
      data: [{ id: 't1', group_id: 'g1', title: 'Scout Rival', assignee_id: 'u2', due_date: '2026-11-20', status: 'open', created_by: 'u1', created_at: 't', updated_at: 't' }],
      error: null,
    })) } as never
    const out = await listTasks(sb, 'g1')
    expect(out).toEqual([{ id: 't1', groupId: 'g1', title: 'Scout Rival', assigneeId: 'u2', dueDate: '2026-11-20', status: 'open', createdBy: 'u1', createdAt: 't', updatedAt: 't' }])
  })

  it('createTask inserts with null defaults for optional fields', async () => {
    const insert = vi.fn(() => ({ select: () => ({ single: () => Promise.resolve({ data: { id: 't1' }, error: null }) }) }))
    const sb = { from: vi.fn(() => ({ insert })) } as never
    const id = await createTask(sb, 'g1', { title: 'Scout Rival' })
    expect(id).toBe('t1')
    expect(insert).toHaveBeenCalledWith({ group_id: 'g1', title: 'Scout Rival', assignee_id: null, due_date: null })
  })

  it('setTaskStatus updates the status', async () => {
    const update = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) }))
    const sb = { from: vi.fn(() => ({ update })) } as never
    await setTaskStatus(sb, 't1', 'done')
    expect(update).toHaveBeenCalledWith({ status: 'done' })
  })
})

describe('staff notes', () => {
  it('listStaffNotes scopes by group and player', async () => {
    const sb = { from: vi.fn(() => chain({
      data: [{ id: 'n1', group_id: 'g1', player_id: 'p1', body: 'note', created_by: 'u1', created_at: 't', updated_at: 't' }],
      error: null,
    })) } as never
    const out = await listStaffNotes(sb, 'g1', 'p1')
    expect(out).toEqual([{ id: 'n1', groupId: 'g1', playerId: 'p1', body: 'note', createdBy: 'u1', createdAt: 't', updatedAt: 't' }])
  })

  it('addStaffNote inserts the group/player/body', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null })
    const sb = { from: vi.fn(() => ({ insert })) } as never
    await addStaffNote(sb, 'g1', 'p1', 'watch his tilt')
    expect(insert).toHaveBeenCalledWith({ group_id: 'g1', player_id: 'p1', body: 'watch his tilt' })
  })

  it('maps a permission error to FORBIDDEN (player trying to read their own notes)', async () => {
    const sb = { from: vi.fn(() => chain({ data: null, error: { message: 'permission denied', code: '42501' } })) } as never
    await expect(listStaffNotes(sb, 'g1', 'p1')).rejects.toThrow('FORBIDDEN')
  })
})
