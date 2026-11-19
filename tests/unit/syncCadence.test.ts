import { describe, it, expect, vi } from 'vitest'

// Item I (19/11/2026): Supabase budget of ≤ 3 requests a minute at rest. The sync service sends 2 per cycle.
vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] }, app: { on: () => {}, getPath: () => '' } }))
vi.mock('../../electron/main/database', () => ({ getPrisma: () => { throw new Error('not used') } }))
vi.mock('../../electron/main/cloud/supabase', () => ({ getSupabase: () => ({}), isCloudConfigured: () => false, getSessionUserId: async () => null }))

const { nextSyncDelay } = await import('../../electron/main/sync/syncService')

describe('sync cadence', () => {
  it('60 s at rest, 15 s while a team session is live', () => {
    expect(nextSyncDelay(true, false)).toBe(60_000)
    expect(nextSyncDelay(true, true)).toBe(15_000)
  })
  it('window hidden: 5 min, or 60 s while a team session is live (end-of-game flow)', () => {
    expect(nextSyncDelay(false, false)).toBe(5 * 60_000)
    expect(nextSyncDelay(false, true)).toBe(60_000)
  })
  it('at rest, visible: 2 requests per cycle stay within 3 a minute', () => {
    const perMinute = (2 * 60_000) / nextSyncDelay(true, false)
    expect(perMinute).toBeLessThanOrEqual(3)
  })
})
