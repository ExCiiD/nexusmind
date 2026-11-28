/**
 * Health check of 28/11/2026, on a throw-away SQLite database with every migration applied: plain timelines are
 * compressed without changing what readers get, and the retention reads clips / bookmarks / tagged mistakes /
 * reviews correctly (a recording with any of them is never deleted).
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { rmSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'

const h = vi.hoisted(() => {
  const { mkdtempSync } = require('fs') as typeof import('fs')
  const { tmpdir } = require('os') as typeof import('os')
  const { join } = require('path') as typeof import('path')
  const root = mkdtempSync(join(tmpdir(), 'nxm-storage-db-'))
  process.env.NEXUSMIND_DB_PATH = join(root, 'data', 'test.db')
  return { root, deleted: [] as string[], dismissed: [] as string[] }
})

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => join(h.root, 'userData'), getAppPath: () => process.cwd(), getVersion: () => '0.0.0-test' },
}))
vi.mock('../../electron/main/recorderBackend', () => ({
  getActiveRecorder: () => ({ getStatus: () => ({ isRecording: false, filePath: null }) }),
}))
vi.mock('../../electron/main/ipc/recording.ipc', () => ({
  deleteMediaFiles: (m: { filePath?: string | null }) => { if (m.filePath) h.deleted.push(m.filePath) },
  dismissPath: (p: string) => { h.dismissed.push(p) },
}))
vi.mock('../../electron/main/ipc/validate', () => ({ validatedHandle: () => undefined }))

import { initDatabase, closeDatabase, getPrisma } from '../../electron/main/database'
import { compressPlainTimelines, reclaimFreePages } from '../../electron/main/matchCachePurge'
import { readTimelineJson } from '../../electron/main/matchStore'
import { GZ_PREFIX } from '../../electron/main/matchStoreCore'
import { collectRecordingFacts, previewVideoPurge, readRetentionStatus, runVideoPurge } from '../../electron/main/videoRetention'

const timeline = JSON.stringify({ info: { frames: Array.from({ length: 40 }, (_, i) => ({ timestamp: i * 60_000, participantFrames: { 1: { totalGold: i * 400 } } })) } })
const files: Record<string, string> = {}

beforeAll(async () => {
  await initDatabase()
  const prisma = getPrisma()
  for (let i = 0; i < 11; i++) {
    await prisma.matchCache.create({ data: { matchId: `EUW1_${i}`, matchJson: '{"info":{}}', timelineJson: timeline } })
  }
  await prisma.matchCache.create({ data: { matchId: 'NO_TL', matchJson: '{"info":{}}' } })

  // Recordings: one per protection, plus one with nothing attached. All 60 days old.
  const user = await prisma.user.create({ data: { summonerName: 'P', puuid: 'p', region: 'EUW1', nextAssessmentAt: new Date() } })
  const session = await prisma.session.create({ data: { userId: user.id, objectiveId: 'x' } })
  const tag = await prisma.mistakeTag.findFirst() ?? await prisma.mistakeTag.create({ data: { slug: 't', label: 't', category: 'macro' } })
  const old = new Date(Date.now() - 60 * 86_400_000)
  mkdirSync(join(h.root, 'rec'), { recursive: true })
  mkdirSync(join(h.root, 'userData'), { recursive: true })
  const make = async (name: string) => {
    const game = await prisma.game.create({ data: { sessionId: session.id, matchId: `M_${name}`, champion: 'Ahri', role: 'MID', kills: 0, deaths: 0, assists: 0, cs: 0, visionScore: 0, duration: 1, win: true, gameEndAt: old } })
    const filePath = join(h.root, 'rec', `${name}.mp4`)
    writeFileSync(filePath, Buffer.alloc(1024))
    files[name] = filePath
    const r = await prisma.recording.create({ data: { gameId: game.id, filePath, createdAt: old } })
    return { game, r }
  }
  await make('plain')
  const autoOnly = await make('autoMistake')
  await prisma.mistake.create({ data: { gameId: autoOnly.game.id, tagId: tag.id, gameTimeSec: 60, autoDetected: true } })
  const clip = await make('clip')
  await prisma.clip.create({ data: { recordingId: clip.r.id, filePath: join(h.root, 'rec', 'c.mp4'), startMs: 0, endMs: 1000 } })
  const bm = await make('bookmark')
  await prisma.bookmark.create({ data: { recordingId: bm.r.id, videoTimeMs: 1000 } })
  const mk = await make('mistake')
  await prisma.mistake.create({ data: { gameId: mk.game.id, tagId: tag.id, gameTimeSec: 60, autoDetected: false } })
  const rv = await make('review')
  await prisma.review.create({ data: { gameId: rv.game.id, timelineNotes: '[]', kpiScores: '{}', objectiveRespected: true } })
  const mr = await make('micro')
  await prisma.microReviewAnswer.create({ data: { userId: user.id, gameId: mr.game.id, momentKey: 'k', trigger: 'critical-death', gameTimeSec: 60, outcome: 'mistake', role: 'MID', champion: 'Ahri' } })
}, 60_000)

afterAll(async () => {
  await closeDatabase()
  try { rmSync(h.root, { recursive: true, force: true }) } catch { /* Windows file lock */ }
})

describe('compressPlainTimelines', () => {
  it('compresses every plain timeline (across several batches) and readers get the same JSON', async () => {
    expect(await compressPlainTimelines(4)).toBe(11)
    const rows = await getPrisma().matchCache.findMany({ where: { timelineJson: { not: null } } })
    expect(rows.every((r) => r.timelineJson!.startsWith(GZ_PREFIX))).toBe(true)
    expect(await readTimelineJson(getPrisma(), 'EUW1_3')).toBe(timeline)
    expect(await compressPlainTimelines()).toBe(0)
  })

  it('does not VACUUM a small database', async () => {
    expect(await reclaimFreePages()).toBe(0)
  })
})

describe('video retention on the database', () => {
  it('sees what protects each recording', async () => {
    const facts = await collectRecordingFacts()
    const by = (name: string) => facts.find((f) => f.filePath === files[name])!
    expect(by('plain')).toMatchObject({ clips: 0, bookmarks: 0, manualMistakes: 0, reviewed: false, sizeBytes: 1024 })
    expect(by('autoMistake').manualMistakes).toBe(0)
    expect(by('clip').clips).toBe(1)
    expect(by('bookmark').bookmarks).toBe(1)
    expect(by('mistake').manualMistakes).toBe(1)
    expect(by('review').reviewed).toBe(true)
    expect(by('micro').reviewed).toBe(true)
  })

  it('previews only the unprotected ones, and deletes nothing before the first confirmation', async () => {
    writeFileSync(join(h.root, 'userData', 'video-retention.json'), JSON.stringify({ enabled: true, maxAgeDays: 30, maxTotalGb: null, confirmedAt: null }))
    const plan = await previewVideoPurge()
    expect(plan.remove.map((r) => r.filePath).sort()).toEqual([files.autoMistake, files.plain].sort())
    expect(await runVideoPurge()).toEqual({ removed: 0, freedBytes: 0 })
    expect(h.deleted).toEqual([])
  })

  it('once confirmed, deletes only the video files: rows, games and mistakes stay, marked "video deleted"', async () => {
    writeFileSync(join(h.root, 'userData', 'video-retention.json'), JSON.stringify({ enabled: true, maxAgeDays: 30, maxTotalGb: null, confirmedAt: '2026-11-28T00:00:00Z' }))
    expect(readRetentionStatus().lastRunAt).toBeNull()
    const result = await runVideoPurge()
    expect(result).toEqual({ removed: 2, freedBytes: 2048 })
    expect(h.deleted.sort()).toEqual([files.autoMistake, files.plain].sort())
    expect(h.dismissed.sort()).toEqual([files.autoMistake, files.plain].sort())
    const prisma = getPrisma()
    expect(await prisma.recording.count()).toBe(7)
    const gone = await prisma.recording.findMany({ where: { videoDeletedAt: { not: null } }, include: { game: true } })
    expect(gone).toHaveLength(2)
    expect(gone.every((r) => r.filePath === null && r.thumbnailPath === null && r.game !== null)).toBe(true)
    expect(await prisma.game.count()).toBe(7)
    expect(await prisma.mistake.count({ where: { autoDetected: true } })).toBe(1)
    expect(existsSync(files.clip)).toBe(true)
    // The "Last cleanup on …" line.
    expect(readRetentionStatus()).toMatchObject({ lastRemoved: 2, lastFreedBytes: 2048 })
    const firstRun = readRetentionStatus().lastRunAt
    expect(firstRun).not.toBeNull()
    // A later run with nothing to delete keeps the last cleanup and only moves the check date.
    expect((await runVideoPurge()).removed).toBe(0)
    expect(readRetentionStatus()).toMatchObject({ lastRunAt: firstRun, lastRemoved: 2 })
    expect(readRetentionStatus().lastCheckAt).not.toBeNull()
  })
})
