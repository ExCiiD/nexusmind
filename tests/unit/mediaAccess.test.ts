import { describe, it, expect, vi, beforeEach } from 'vitest'
import { join, resolve } from 'path'

const userData = resolve('/nxm-test/userData')

const prismaMock = {
  user: { findMany: vi.fn() },
  recording: { findMany: vi.fn() },
  clip: { findMany: vi.fn() },
  externalReview: { findMany: vi.fn() },
}

vi.mock('electron', () => ({ app: { getPath: () => userData } }))
vi.mock('../../electron/main/database', () => ({ getPrisma: () => prismaMock }))

async function load() {
  vi.resetModules()
  return import('../../electron/main/mediaAccess')
}

beforeEach(() => {
  prismaMock.user.findMany.mockResolvedValue([{ recordingPath: resolve('/Games/Clips'), externalRecordingPath: null }])
  prismaMock.recording.findMany.mockResolvedValue([{ filePath: resolve('/Elsewhere/linked.mp4'), thumbnailPath: null }])
  prismaMock.clip.findMany.mockResolvedValue([])
  prismaMock.externalReview.findMany.mockResolvedValue([])
})

describe('isUnderRoot', () => {
  it('accepts files below the root and rejects sibling prefixes', async () => {
    const { isUnderRoot, normalizeMediaPath } = await load()
    const root = normalizeMediaPath('/Games/Clips')
    expect(isUnderRoot(normalizeMediaPath('/Games/Clips/a.mp4'), root)).toBe(true)
    expect(isUnderRoot(normalizeMediaPath('/Games/ClipsEvil/a.mp4'), root)).toBe(false)
  })
})

describe('isMediaPathAllowed', () => {
  it('allows files in app-owned folders', async () => {
    const { isMediaPathAllowed } = await load()
    expect(await isMediaPathAllowed(join(userData, 'thumbnails', 't.jpg'))).toBe(true)
  })

  it('allows files in the user-configured recording folder (case-insensitive)', async () => {
    const { isMediaPathAllowed } = await load()
    expect(await isMediaPathAllowed(resolve('/games/clips/game1.mp4'))).toBe(true)
  })

  it('allows a file explicitly linked to a recording', async () => {
    const { isMediaPathAllowed } = await load()
    expect(await isMediaPathAllowed(resolve('/Elsewhere/linked.mp4'))).toBe(true)
  })

  it('denies arbitrary media files elsewhere on disk', async () => {
    const { isMediaPathAllowed } = await load()
    expect(await isMediaPathAllowed(resolve('/Users/someone/Pictures/private.jpg'))).toBe(false)
  })

  it('denies when the database lookup fails', async () => {
    prismaMock.recording.findMany.mockRejectedValue(new Error('db down'))
    const { isMediaPathAllowed } = await load()
    expect(await isMediaPathAllowed(resolve('/Elsewhere/linked.mp4'))).toBe(false)
  })
})
