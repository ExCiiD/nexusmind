import { app } from 'electron'
import { existsSync, readFileSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import { z } from 'zod'
import { getPrisma } from './database'
import { getActiveRecorder } from './recorderBackend'
import { validatedHandle } from './ipc/validate'
import { deleteMediaFiles, dismissPath } from './ipc/recording.ipc'
import {
  DEFAULT_VIDEO_RETENTION, planVideoPurge, sanitizeSettings,
  type PurgePlan, type RecordingFacts, type VideoRetentionSettings,
} from './videoRetentionCore'

/**
 * Video retention (videoRetentionCore.ts has the rules). The setting lives in `userData/video-retention.json`: it is
 * about this PC's disk, so it is neither synced nor in the database. Runs 5 minutes after launch and every 6 hours,
 * never while a game is being recorded, and deletes nothing until the player confirmed the first purge.
 */

const RUN_EVERY_MS = 6 * 60 * 60_000
const settingsFile = (): string => join(app.getPath('userData'), 'video-retention.json')

export function readRetentionSettings(): VideoRetentionSettings {
  try {
    const raw = JSON.parse(readFileSync(settingsFile(), 'utf-8'))
    return { ...DEFAULT_VIDEO_RETENTION, ...sanitizeSettings(raw ?? {}, DEFAULT_VIDEO_RETENTION), confirmedAt: typeof raw?.confirmedAt === 'string' ? raw.confirmedAt : null }
  } catch {
    return { ...DEFAULT_VIDEO_RETENTION }
  }
}

function writeRetentionSettings(s: VideoRetentionSettings): void {
  writeFileSync(settingsFile(), JSON.stringify(s), 'utf-8')
}

/** Every recording with a file on disk, with what the rules need to know about it. */
export async function collectRecordingFacts(): Promise<RecordingFacts[]> {
  const status = getActiveRecorder().getStatus()
  const rows = await getPrisma().recording.findMany({
    where: { filePath: { not: null } },
    select: {
      id: true, filePath: true, createdAt: true,
      _count: { select: { clips: true, bookmarks: true, mistakes: { where: { autoDetected: false } } } },
      game: {
        select: {
          review: { select: { id: true } },
          _count: { select: { microReviewAnswers: true, mistakes: { where: { autoDetected: false } } } },
        },
      },
    },
  })
  const facts: RecordingFacts[] = []
  for (const r of rows) {
    if (!r.filePath || !existsSync(r.filePath)) continue
    let sizeBytes = 0
    try { sizeBytes = statSync(r.filePath).size } catch { continue }
    facts.push({
      id: r.id,
      filePath: r.filePath,
      sizeBytes,
      createdAtMs: r.createdAt.getTime(),
      clips: r._count.clips,
      bookmarks: r._count.bookmarks,
      manualMistakes: r._count.mistakes + (r.game?._count.mistakes ?? 0),
      reviewed: !!r.game?.review || (r.game?._count.microReviewAnswers ?? 0) > 0,
      capturing: !!status.isRecording && status.filePath === r.filePath,
    })
  }
  return facts
}

export async function previewVideoPurge(settings: VideoRetentionSettings = readRetentionSettings()): Promise<PurgePlan> {
  return planVideoPurge(await collectRecordingFacts(), settings, Date.now())
}

/**
 * The "Last cleanup on …" line (Settings › Recording): `lastRunAt` / `lastRemoved` / `lastFreedBytes` are the last
 * run that deleted at least one video; `lastCheckAt` is the last run at all (it may have found nothing to delete).
 */
export interface VideoRetentionStatus {
  lastRunAt: string | null
  lastRemoved: number
  lastFreedBytes: number
  lastCheckAt: string | null
}
const EMPTY_STATUS: VideoRetentionStatus = { lastRunAt: null, lastRemoved: 0, lastFreedBytes: 0, lastCheckAt: null }
const statusFile = (): string => join(app.getPath('userData'), 'video-retention-status.json')

export function readRetentionStatus(): VideoRetentionStatus {
  try {
    const raw = JSON.parse(readFileSync(statusFile(), 'utf-8'))
    return {
      lastRunAt: typeof raw?.lastRunAt === 'string' ? raw.lastRunAt : null,
      lastRemoved: Number.isFinite(raw?.lastRemoved) ? raw.lastRemoved : 0,
      lastFreedBytes: Number.isFinite(raw?.lastFreedBytes) ? raw.lastFreedBytes : 0,
      lastCheckAt: typeof raw?.lastCheckAt === 'string' ? raw.lastCheckAt : null,
    }
  } catch {
    return { ...EMPTY_STATUS }
  }
}

function recordRun(removed: number, freedBytes: number, at: Date = new Date()): void {
  const prev = readRetentionStatus()
  const next: VideoRetentionStatus = removed > 0
    ? { lastRunAt: at.toISOString(), lastRemoved: removed, lastFreedBytes: freedBytes, lastCheckAt: at.toISOString() }
    : { ...prev, lastCheckAt: at.toISOString() }
  try { writeFileSync(statusFile(), JSON.stringify(next), 'utf-8') } catch { /* only the status line */ }
}

/**
 * Deletes the VIDEO FILE of each recording the plan names, and only it (decision of 28/11, RETENTION_VIDEO.md):
 * the file and its thumbnail go, the path is remembered so the folder scan does not import it again, and the
 * recording row stays with `videoDeletedAt` set, so the game, its stats, reviews, notes, mistakes and bookmarks keep
 * their link and the page opens in a "video deleted" state. Only when the setting is on and the first purge was
 * confirmed, never while a game is recorded.
 */
export async function runVideoPurge(): Promise<{ removed: number; freedBytes: number }> {
  const settings = readRetentionSettings()
  if (!settings.enabled || !settings.confirmedAt) return { removed: 0, freedBytes: 0 }
  if (getActiveRecorder().getStatus().isRecording) return { removed: 0, freedBytes: 0 }
  const plan = await previewVideoPurge(settings)
  const prisma = getPrisma()
  let removed = 0
  let freedBytes = 0
  for (const item of plan.remove) {
    const rec = await prisma.recording.findUnique({ where: { id: item.id }, select: { id: true, filePath: true, thumbnailPath: true } })
    if (!rec || rec.filePath !== item.filePath) continue
    dismissPath(item.filePath)
    deleteMediaFiles(rec)
    await prisma.recording.update({
      where: { id: rec.id },
      data: { filePath: null, thumbnailPath: null, videoDeletedAt: new Date() },
    }).catch(() => undefined)
    removed++
    freedBytes += item.sizeBytes
  }
  recordRun(removed, freedBytes)
  if (removed > 0) console.log(`[video-retention] deleted ${removed} video file(s), ${Math.round(freedBytes / 1048576)} MB`)
  return { removed, freedBytes }
}

let soonTimer: NodeJS.Timeout | null = null
/** After a game's recording is finalised: one run a minute later (the "after each game" check). */
export function scheduleVideoPurgeSoon(delayMs = 60_000): void {
  if (soonTimer) clearTimeout(soonTimer)
  soonTimer = setTimeout(() => {
    soonTimer = null
    runVideoPurge().catch((err) => console.warn('[video-retention] failed:', (err as Error)?.message))
  }, delayMs)
}

const settingsInput = z.object({
  enabled: z.boolean().optional(),
  maxAgeDays: z.number().int().nullable().optional(),
  maxTotalGb: z.number().nullable().optional(),
}).strict()

/**
 * IPC (Settings › Recording):
 * - `video-retention:get` → the setting and what it would delete now;
 * - `video-retention:preview` (setting) → what a setting would delete, without saving it;
 * - `video-retention:set` (setting, confirm?) → saves it; `confirm: true` is the player's yes to the first purge
 *   (the UI shows the preview first), which then runs at once. Turning it on again later needs no new confirmation.
 */
export function registerVideoRetentionHandlers(): void {
  validatedHandle('video-retention:get', z.tuple([]), async () => {
    const settings = readRetentionSettings()
    return { settings, plan: await previewVideoPurge(settings), status: readRetentionStatus() }
  })
  validatedHandle('video-retention:preview', z.tuple([settingsInput]), async (_e, input) => {
    const settings = sanitizeSettings({ ...input, enabled: true }, readRetentionSettings())
    return previewVideoPurge(settings)
  })
  validatedHandle('video-retention:set', z.tuple([settingsInput, z.boolean().optional()]), async (_e, input, confirm) => {
    const previous = readRetentionSettings()
    const next = sanitizeSettings(input, previous)
    if (confirm && next.enabled) next.confirmedAt = previous.confirmedAt ?? new Date().toISOString()
    writeRetentionSettings(next)
    const result = next.enabled && next.confirmedAt ? await runVideoPurge() : { removed: 0, freedBytes: 0 }
    return { settings: next, ...result, status: readRetentionStatus() }
  })
}

export function startVideoRetention(): void {
  const run = () => { runVideoPurge().catch((err) => console.warn('[video-retention] failed:', (err as Error)?.message)) }
  setTimeout(run, 5 * 60_000)
  setInterval(run, RUN_EVERY_MS)
}
