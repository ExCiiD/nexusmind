/** 21/11/2026: the player's timeline filters (saved, synced, never reset) and the clip mode rules. */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DEFAULT_PLAYER_FILTERS, normalizePlayerFilters, PLAYER_FILTERS_KEY } from '../../src/lib/playerFilters'
import { assertClipRange, isInsideDirs, CLIP_MAX_MS } from '../../electron/main/clipCore'
import { SYNC_TABLES } from '../../electron/main/sync/syncSchema'

const h = vi.hoisted(() => ({ rows: new Map<string, string>() }))
vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))
vi.mock('../../electron/main/database', () => ({
  getPrisma: () => ({
    user: { findFirst: async () => ({ id: 'u1' }) },
    userPreference: {
      findUnique: async ({ where }: any) => { const v = h.rows.get(`${where.userId_key.userId}:${where.userId_key.key}`); return v ? { value: v } : null },
      upsert: async ({ where, create, update }: any) => { const k = `${where.userId_key.userId}:${where.userId_key.key}`; h.rows.set(k, h.rows.has(k) ? update.value : create.value); return {} },
    },
  }),
}))
import { getPlayerFilters, getReviewPanel, reviewPanelSchema, setPlayerFilters, setReviewPanel } from '../../electron/main/ipc/preferences.ipc'
import { DEFAULT_REVIEW_PANEL, normalizeReviewPanel, REVIEW_PANEL_KEY } from '../../src/lib/reviewPanelPref'
import { userUpdateSchema } from '../../electron/main/ipc/validate'

beforeEach(() => h.rows.clear())

describe('player filters', () => {
  it('first launch: my notes and the micro-review only', async () => {
    expect(DEFAULT_PLAYER_FILTERS).toMatchObject({ notes: true, microReview: true, mistakes: false, deaths: false, dragon: false, turrets: false, fights: false, zoom: 1 })
    expect(await getPlayerFilters()).toEqual(DEFAULT_PLAYER_FILTERS)
  })
  it('each change is saved and kept: never reset by a later read', async () => {
    await setPlayerFilters({ deaths: true, dragon: true })
    await setPlayerFilters({ zoom: 2.6 })
    const stored = await getPlayerFilters()
    expect(stored).toMatchObject({ notes: true, deaths: true, dragon: true, zoom: 2.5 })
    expect(h.rows.has(`u1:${PLAYER_FILTERS_KEY}`)).toBe(true)
  })
  it('a bad stored value or unknown keys never break the player', () => {
    expect(normalizePlayerFilters('{broken')).toEqual(DEFAULT_PLAYER_FILTERS)
    expect(normalizePlayerFilters({ notes: 'yes', hacked: true, zoom: 99 })).toEqual({ ...DEFAULT_PLAYER_FILTERS, zoom: 8 })
  })
  it('synced to the player\'s devices, one row per user and key', () => {
    expect(SYNC_TABLES.find((t) => t.table === 'UserPreference')).toEqual({ table: 'UserPreference', userColumns: ['userId'], naturalKey: ['userId', 'key'] })
  })
})

describe('clip mode', () => {
  it('1 s to 2 min, start before end', () => {
    expect(() => assertClipRange(9 * 60_000, 9 * 60_000 + 30_000)).not.toThrow()
    expect(() => assertClipRange(0, CLIP_MAX_MS)).not.toThrow()
    expect(() => assertClipRange(0, CLIP_MAX_MS + 1)).toThrow('CLIP_TOO_LONG')
    expect(() => assertClipRange(5000, 5000)).toThrow('BAD_CLIP_RANGE')
    expect(() => assertClipRange(-1, 5000)).toThrow('BAD_CLIP_RANGE')
  })
  it('files are only deleted from the recordings folders', () => {
    const dirs = ['D:/Nexusmind/records', null]
    expect(isInsideDirs('D:/Nexusmind/records/clips/a.mp4', dirs, 'win32')).toBe(true)
    expect(isInsideDirs('d:/NEXUSMIND/records/a.mp4', dirs, 'win32')).toBe(true)
    expect(isInsideDirs('D:/Nexusmind/records-other/a.mp4', dirs, 'win32')).toBe(false)
    expect(isInsideDirs('D:/Nexusmind/records/../secrets.txt', dirs, 'win32')).toBe(false)
    expect(isInsideDirs('C:/Windows/system32/x.dll', dirs, 'win32')).toBe(false)
  })
})

describe('review panel place (§ 19 « Coin de la vidéo », 21/11/2026)', () => {
  it('default: shown, on the right', async () => {
    expect(DEFAULT_REVIEW_PANEL).toEqual({ hidden: false, side: 'right' })
    expect(await getReviewPanel()).toEqual(DEFAULT_REVIEW_PANEL)
  })
  it('each change is kept, never reset by a later read, in its own synced row', async () => {
    await setReviewPanel({ side: 'left' })
    await setReviewPanel({ hidden: true })
    expect(await getReviewPanel()).toEqual({ hidden: true, side: 'left' })
    expect(await getReviewPanel()).toEqual({ hidden: true, side: 'left' })
    expect(h.rows.has(`u1:${REVIEW_PANEL_KEY}`)).toBe(true)
    expect(await getPlayerFilters()).toEqual(DEFAULT_PLAYER_FILTERS)
  })
  it('unknown keys and bad values are ignored', () => {
    expect(normalizeReviewPanel('{broken')).toEqual(DEFAULT_REVIEW_PANEL)
    expect(normalizeReviewPanel({ hidden: 'yes', side: 'top', extra: 1 })).toEqual(DEFAULT_REVIEW_PANEL)
    expect(reviewPanelSchema.parse({ side: 'left', extra: 1 })).toEqual({ side: 'left' })
    expect(userUpdateSchema.parse({ reviewPanel: { hidden: true, extra: 1 } })).toEqual({ reviewPanel: { hidden: true } })
    expect(() => userUpdateSchema.parse({ reviewPanel: { side: 'top' } })).toThrow()
  })
})
