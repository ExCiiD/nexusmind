import { describe, it, expect, vi } from 'vitest'
import {
  listAnnouncements, createAnnouncement, setAnnouncementPinned, deleteAnnouncement,
  listMyDismissals, dismissAnnouncement, undismissedFor,
} from '../../src/lib/announcementsCore'
import type { Announcement, AnnouncementDismissal } from '../../src/lib/announcements'

function chain(result: unknown) {
  const c: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'order']) c[m] = vi.fn().mockReturnValue(c)
  c.then = (resolve: (v: unknown) => void) => resolve(result)
  return c
}

describe('listAnnouncements', () => {
  it('maps rows to Announcement', async () => {
    const sb = { from: vi.fn(() => chain({
      data: [{ id: 'a1', group_id: 'g1', title: 'Hi', body: 'Hello team', pinned: true, created_by: 'u1', created_at: 't', updated_at: 't' }],
      error: null,
    })) } as never
    const out = await listAnnouncements(sb, 'g1')
    expect(out).toEqual([{ id: 'a1', groupId: 'g1', title: 'Hi', body: 'Hello team', pinned: true, createdBy: 'u1', createdAt: 't', updatedAt: 't' }])
  })

  it('throws on a read error', async () => {
    const sb = { from: vi.fn(() => chain({ data: null, error: { message: 'boom' } })) } as never
    await expect(listAnnouncements(sb, 'g1')).rejects.toThrow('boom')
  })
})

describe('createAnnouncement / setAnnouncementPinned / deleteAnnouncement', () => {
  it('createAnnouncement inserts and returns the new id', async () => {
    const insert = vi.fn((row: unknown) => {
      expect(row).toEqual({ group_id: 'g1', title: 'Hi', body: 'Hello', pinned: false })
      return { select: () => ({ single: () => Promise.resolve({ data: { id: 'a1' }, error: null }) }) }
    })
    const sb = { from: vi.fn(() => ({ insert })) } as never
    const id = await createAnnouncement(sb, 'g1', { title: 'Hi', body: 'Hello' })
    expect(id).toBe('a1')
  })

  it('setAnnouncementPinned updates the pinned column', async () => {
    const update = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) }))
    const sb = { from: vi.fn(() => ({ update })) } as never
    await setAnnouncementPinned(sb, 'a1', true)
    expect(update).toHaveBeenCalledWith({ pinned: true })
  })

  it('deleteAnnouncement deletes by id', async () => {
    const del = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) }))
    const sb = { from: vi.fn(() => ({ delete: del })) } as never
    await deleteAnnouncement(sb, 'a1')
    expect(del).toHaveBeenCalled()
  })
})

describe('listMyDismissals / dismissAnnouncement', () => {
  it('listMyDismissals maps rows (RLS already scopes to the caller)', async () => {
    const sb = { from: vi.fn(() => chain({ data: [{ announcement_id: 'a1', user_id: 'u1', dismissed_at: 't' }], error: null })) } as never
    const out = await listMyDismissals(sb)
    expect(out).toEqual([{ announcementId: 'a1', userId: 'u1', dismissedAt: 't' }])
  })

  it('dismissAnnouncement upserts the given user id, without an auth round trip (item I)', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null })
    const getUser = vi.fn()
    const sb = { auth: { getUser }, from: vi.fn(() => ({ upsert })) } as never
    await dismissAnnouncement(sb, 'u1', 'a1')
    expect(upsert).toHaveBeenCalledWith({ announcement_id: 'a1', user_id: 'u1' })
    expect(getUser).not.toHaveBeenCalled()
  })
})

describe('undismissedFor', () => {
  const announcements: Announcement[] = [
    { id: 'a1', groupId: 'g1', title: 'A', body: 'x', pinned: false, createdBy: 'u1', createdAt: 't', updatedAt: 't' },
    { id: 'a2', groupId: 'g1', title: 'B', body: 'y', pinned: false, createdBy: 'u1', createdAt: 't', updatedAt: 't' },
  ]

  it('excludes announcements the user has dismissed', () => {
    const dismissals: AnnouncementDismissal[] = [{ announcementId: 'a1', userId: 'u1', dismissedAt: 't' }]
    expect(undismissedFor(announcements, dismissals, 'u1')).toEqual([announcements[1]])
  })

  it("ignores another user's dismissals", () => {
    const dismissals: AnnouncementDismissal[] = [{ announcementId: 'a1', userId: 'someone-else', dismissedAt: 't' }]
    expect(undismissedFor(announcements, dismissals, 'u1')).toEqual(announcements)
  })

  it('returns everything when nothing has been dismissed', () => {
    expect(undismissedFor(announcements, [], 'u1')).toEqual(announcements)
  })
})
