/**
 * Health check of 28/11/2026, PC storage: backup age rules, when to VACUUM, which recordings a retention setting
 * deletes, and the obsolete userData files.
 */
import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { planBackupRotation, PLAIN_MAX_DAYS, SECOND_COPY_MAX_DAYS } from '../../electron/main/backupRotationCore'
import { shouldVacuum, VACUUM_MIN_FREE_BYTES } from '../../electron/main/dbMaintenanceCore'
import {
  planVideoPurge, sanitizeSettings, keepReason, DEFAULT_VIDEO_RETENTION, MIN_KEEP_DAYS,
  type RecordingFacts, type VideoRetentionSettings,
} from '../../electron/main/videoRetentionCore'

const DAY = 86_400_000
const NOW = Date.UTC(2026, 10, 28, 12)
const GB = 1024 ** 3

describe('backup rotation, age rules', () => {
  const f = (name: string, daysAgo: number) => ({ name, mtimeMs: NOW - daysAgo * DAY })
  // The real folder on 28/11/2026.
  const real = [
    f('nexusmind-2026-11-20T08-01-19-090Z-before-delete-2025-matchcache.db.gz', 8),
    f('nexusmind-2026-11-21T09-18-01-467Z-before-20261121020000_micro_review_timestamps.db.gz', 7),
    f('nexusmind-2026-11-26T09-27-19-272Z-before-delete-15x-matchcache.db.gz', 2.1),
    f('nexusmind-2026-11-27T16-00-58-512Z-before-20261127120000_auto_session.db', 1),
  ]

  it('keeps a fresh newest snapshot plain, the one to copy back after a failed update', () => {
    expect(planBackupRotation(real, 2, NOW)).toEqual({ remove: [], compress: [] })
  })

  it(`compresses the newest too once it is ${PLAIN_MAX_DAYS} days old`, () => {
    const { compress } = planBackupRotation(real, 2, NOW + 2 * DAY)
    expect(compress).toEqual(['nexusmind-2026-11-27T16-00-58-512Z-before-20261127120000_auto_session.db'])
  })

  it(`drops a second copy past ${SECOND_COPY_MAX_DAYS} days, never the newest of a kind`, () => {
    const { remove } = planBackupRotation(real, 2, NOW + 8 * DAY)
    expect(remove.sort()).toEqual([
      'nexusmind-2026-11-20T08-01-19-090Z-before-delete-2025-matchcache.db.gz',
      'nexusmind-2026-11-21T09-18-01-467Z-before-20261121020000_micro_review_timestamps.db.gz',
    ])
    expect(planBackupRotation(real, 2, NOW + 400 * DAY).remove).toHaveLength(2)
  })

  it('without `now`, only the count rule applies (as before)', () => {
    expect(planBackupRotation(real, 2)).toEqual({ remove: [], compress: [] })
  })
})

describe('VACUUM threshold', () => {
  it('runs on the real database (139 MB free of 471 MB), not for a few free pages', () => {
    expect(shouldVacuum({ pageSize: 4096, pageCount: 120_562, freePages: 35_625 })).toBe(true)
    expect(shouldVacuum({ pageSize: 4096, pageCount: 120_562, freePages: 1_000 })).toBe(false)
    // Big enough in bytes but a small share of a large file.
    expect(shouldVacuum({ pageSize: 4096, pageCount: 2_000_000, freePages: VACUUM_MIN_FREE_BYTES / 4096 })).toBe(false)
    expect(shouldVacuum({ pageSize: 0, pageCount: 0, freePages: 0 })).toBe(false)
  })
})

describe('video retention', () => {
  const rec = (id: string, daysAgo: number, gb: number, extra: Partial<RecordingFacts> = {}): RecordingFacts => ({
    id, filePath: `D:/rec/${id}.mp4`, sizeBytes: gb * GB, createdAtMs: NOW - daysAgo * DAY,
    clips: 0, bookmarks: 0, manualMistakes: 0, reviewed: false, capturing: false, ...extra,
  })
  const on = (s: Partial<VideoRetentionSettings>): VideoRetentionSettings => ({ ...DEFAULT_VIDEO_RETENTION, enabled: true, ...s })
  const library = [
    rec('old-plain', 40, 1),
    rec('old-clip', 50, 1, { clips: 1 }),
    rec('old-bookmark', 45, 1, { bookmarks: 2 }),
    rec('old-mistake', 44, 1, { manualMistakes: 1 }),
    rec('old-review', 43, 1, { reviewed: true }),
    rec('mid', 20, 1),
    rec('young', 10, 1),
    rec('today', 0.5, 1),
  ]

  it('deletes nothing while the setting is off or empty', () => {
    expect(planVideoPurge(library, DEFAULT_VIDEO_RETENTION, NOW).remove).toEqual([])
    expect(planVideoPurge(library, on({}), NOW).remove).toEqual([])
  })

  it('by age: only the old recordings with nothing attached', () => {
    const plan = planVideoPurge(library, on({ maxAgeDays: 30 }), NOW)
    expect(plan.remove.map((r) => [r.id, r.why])).toEqual([['old-plain', 'age']])
    expect(plan.kept.map((k) => k.reason).sort()).toEqual(['bookmark', 'clip', 'mistake', 'recent', 'review'])
  })

  it('by size: the oldest first until under the cap, never a protected or recent one', () => {
    const plan = planVideoPurge(library, on({ maxTotalGb: 6 }), NOW)
    expect(plan.remove.map((r) => r.id)).toEqual(['old-plain', 'mid'])
    expect(plan.totalBytes - plan.removeBytes).toBe(6 * GB)
    expect(plan.capUnreachable).toBe(false)
    // The disk bar: count, protected bytes, kept-by-limits bytes.
    expect(plan.totalCount).toBe(8)
    const protectedBytes = plan.kept.reduce((n, k) => n + k.sizeBytes, 0)
    expect(protectedBytes).toBe(5 * GB)
    expect(plan.totalBytes - plan.removeBytes - protectedBytes).toBe(1 * GB)
  })

  it('says when the kept recordings alone pass the cap', () => {
    const plan = planVideoPurge(library, on({ maxTotalGb: 2 }), NOW)
    expect(plan.remove.map((r) => r.id)).toEqual(['old-plain', 'mid', 'young'])
    expect(plan.capUnreachable).toBe(true)
  })

  it('age and size together never delete a recording twice', () => {
    const plan = planVideoPurge(library, on({ maxAgeDays: 30, maxTotalGb: 6 }), NOW)
    expect(plan.remove.map((r) => [r.id, r.why])).toEqual([['old-plain', 'age'], ['mid', 'size']])
  })

  it('keeps the one being recorded and the recent ones', () => {
    expect(keepReason(rec('x', 100, 1, { capturing: true }), NOW)).toBe('recording')
    expect(keepReason(rec('x', MIN_KEEP_DAYS - 0.1, 1), NOW)).toBe('recent')
    expect(keepReason(rec('x', MIN_KEEP_DAYS + 0.1, 1), NOW)).toBeNull()
  })

  it('clamps what the renderer sends and never lets it set the confirmation', () => {
    const prev = { ...DEFAULT_VIDEO_RETENTION, confirmedAt: '2026-11-28T00:00:00Z' }
    expect(sanitizeSettings({ enabled: true, maxAgeDays: 1, maxTotalGb: 99999, confirmedAt: 'x' } as any, prev))
      .toEqual({ enabled: true, maxAgeDays: 7, maxTotalGb: 2000, confirmedAt: '2026-11-28T00:00:00Z' })
    expect(sanitizeSettings({ maxAgeDays: null }, { ...prev, maxAgeDays: 30 }).maxAgeDays).toBeNull()
    expect(sanitizeSettings({}, { ...prev, maxAgeDays: 30 }).maxAgeDays).toBe(30)
  })
})

describe('obsolete userData files', () => {
  it('removes the two cut-out models and the cut-out cache, nothing else', async () => {
    const { vi } = await import('vitest')
    vi.doMock('electron', () => ({ app: { getPath: () => tmpdir() } }))
    const { removeObsoleteFiles } = await import('../../electron/main/storageCleanup')
    const root = mkdtempSync(join(tmpdir(), 'nxm-storage-'))
    mkdirSync(join(root, 'models'))
    for (const n of ['birefnet-general-512-216.onnx', 'birefnet-lite-general-232.onnx', 'birefnet-lite-general-232.onnx.part', 'whisper-base.bin']) {
      writeFileSync(join(root, 'models', n), 'x')
    }
    mkdirSync(join(root, 'champion-cutouts', 'v3'), { recursive: true })
    writeFileSync(join(root, 'champion-cutouts', 'v3', 'Jinx_0.png'), 'x')
    expect(removeObsoleteFiles(root)).toHaveLength(4)
    expect(readdirSync(join(root, 'models'))).toEqual(['whisper-base.bin'])
    expect(existsSync(join(root, 'champion-cutouts'))).toBe(false)
    // An empty models folder goes too.
    const bare = mkdtempSync(join(tmpdir(), 'nxm-storage-'))
    mkdirSync(join(bare, 'models'))
    writeFileSync(join(bare, 'models', 'birefnet-x.onnx'), 'x')
    removeObsoleteFiles(bare)
    expect(existsSync(join(bare, 'models'))).toBe(false)
  })
})
