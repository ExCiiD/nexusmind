/**
 * « Upload YouTube automatique » (21/11/2026, DECISIONS): when the player turned it on and a YouTube account is
 * connected, every recorded game (once linked to its game) and every saved clip goes up without a click, with the
 * visibility chosen in the settings.
 * - Persistent queue: userData/youtube-upload-queue.json (ids and titles only), so it survives a restart.
 * - One upload at a time; retries with backoff; a used-up quota waits for YouTube's next day; a lost connection
 *   pauses the queue until the player connects again (rules in youtubeQueueCore.ts).
 * - Never twice: a video that already has a URL is not uploaded again (checked again right before each upload).
 * - Turning it off, or disconnecting, empties the queue and stops the current upload (an unfinished upload is never
 *   published).
 * - Team meetings are not concerned (manual only).
 * IPC (shape agreed with Front-End, src/lib/youtubeQueue.ts): youtube:queue-list → YoutubeQueueView[],
 * youtube:queue-retry(id) → { success }, and the push event youtube:queue-changed carrying the whole list.
 */
import { app, BrowserWindow } from 'electron'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import { z } from 'zod'
import { validatedHandle } from './ipc/validate'
import { getAutoYoutube, onAutoYoutubeChange } from './ipc/preferences.ipc'
import { onYoutubeConnectionChange, uploadClipToYoutube, uploadRecordingToYoutube, youtubeConnected, youtubeUploadAvailable } from './ipc/youtube.ipc'
import { getPrisma } from './database'
import { clipVideoText } from './youtubeCore'
import {
  addFinished, enqueue, nextDue, nextWakeAt, onFailure, parseFinished, parseQueue, parseQueueId, queueView, recordingVideoText,
  type AutoUploadItem, type AutoUploadKind, type FinishedUpload, type YoutubeQueueView,
} from './youtubeQueueCore'
import type { YoutubeAudio, YoutubeVisibility } from '../../src/lib/autoYoutubePref'

let queue: AutoUploadItem[] = []
let finished: FinishedUpload[] = []
let loaded = false
let running = false
let timer: NodeJS.Timeout | null = null
let current: { kind: AutoUploadKind; id: string; percent: number; abort: AbortController } | null = null

const queueFile = () => join(app.getPath('userData'), 'youtube-upload-queue.json')
const same = (a: { kind: AutoUploadKind; id: string }, kind: AutoUploadKind, id: string) => a.kind === kind && a.id === id

function load(): void {
  if (loaded) return
  loaded = true
  try {
    if (!existsSync(queueFile())) return
    const raw = JSON.parse(readFileSync(queueFile(), 'utf-8'))
    queue = parseQueue(Array.isArray(raw) ? raw : raw?.queue)
    finished = parseFinished(raw?.finished)
  } catch { queue = []; finished = [] }
}

function save(): void {
  try {
    const tmp = queueFile() + '.tmp'
    writeFileSync(tmp, JSON.stringify({ queue, finished }))
    renameSync(tmp, queueFile())
  } catch (err) {
    console.warn('[youtube-auto] queue not saved:', (err as Error).message)
  }
}

export function listQueue(): YoutubeQueueView[] {
  load()
  return queueView(queue, finished, (kind, id) => (current && same(current, kind, id) ? current.percent : null))
}

function changed(): void {
  const list = listQueue()
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('youtube:queue-changed', list)
}

function schedule(): void {
  if (timer) { clearTimeout(timer); timer = null }
  const wake = nextWakeAt(queue)
  if (wake === null) return
  timer = setTimeout(() => { void pump() }, Math.min(Math.max(0, wake - Date.now()), 2 ** 31 - 1))
}

/** Uploads the due items one by one. */
async function pump(): Promise<void> {
  if (running) return
  running = true
  try {
    for (;;) {
      const pref = await getAutoYoutube().catch(() => null)
      if (!pref?.enabled) return
      const item = nextDue(queue, Date.now())
      if (!item) return
      await uploadOne(item, pref.visibility, pref.audio)
    }
  } finally {
    running = false
    schedule()
  }
}

async function uploadOne(item: AutoUploadItem, visibility: YoutubeVisibility, audio: YoutubeAudio): Promise<void> {
  const abort = new AbortController()
  queue = queue.map((q) => (same(q, item.kind, item.id) ? { ...q, state: 'uploading' } : q))
  current = { kind: item.kind, id: item.id, percent: 0, abort }
  changed()
  let lastSent = 0
  try {
    const run = {
      visibility, audio, signal: abort.signal,
      onProgress: (percent: number) => {
        if (current) current.percent = percent
        if (percent - lastSent >= 5 || percent === 100) { lastSent = percent; changed() }
      },
    }
    const res = item.kind === 'clip' ? await uploadClipToYoutube(item.id, run) : await uploadRecordingToYoutube(item.id, run)
    queue = queue.filter((q) => !same(q, item.kind, item.id))
    finished = addFinished(finished, { kind: item.kind, id: item.id, title: item.title, status: 'done', url: res.url, error: null, at: Date.now() }, Date.now())
  } catch (err) {
    const message = (err as Error)?.message ?? ''
    // Cancelled (turned off or disconnected): the queue was already emptied.
    if (abort.signal.aborted || message === 'UPLOAD_CANCELLED') return
    // The manual share is uploading it right now: try again a bit later, without using an attempt.
    if (message === 'UPLOAD_IN_PROGRESS') {
      queue = queue.map((q) => (same(q, item.kind, item.id) ? { ...item, state: 'pending', nextAt: Date.now() + 60_000 } : q))
      return
    }
    const code = /^[A-Z_]+$/.test(message) ? message : 'YOUTUBE_ERROR'
    const out = onFailure(item, code, Date.now())
    if (out.action === 'drop') {
      queue = queue.filter((q) => !same(q, item.kind, item.id))
      finished = addFinished(finished, { kind: item.kind, id: item.id, title: item.title, status: 'error', url: null, error: out.item.lastError ?? code, at: Date.now() }, Date.now())
    } else {
      queue = queue.map((q) => (same(q, item.kind, item.id) ? out.item : q))
      if (out.pauseQueue) queue = queue.map((q) => (q.state === 'pending' ? { ...q, state: 'paused_auth', nextAt: null, lastError: code } : q))
    }
  } finally {
    current = null
    save()
    changed()
  }
}

/** The title the video will get on YouTube (shown in the queue). */
async function titleOf(kind: AutoUploadKind, id: string): Promise<string | null> {
  try {
    const prisma = getPrisma()
    if (kind === 'recording') {
      const rec = await prisma.recording.findUnique({ where: { id }, select: { gameId: true } })
      const game = rec?.gameId ? await prisma.game.findUnique({ where: { id: rec.gameId }, select: { champion: true, opponentChampion: true, win: true, gameEndAt: true } }) : null
      return recordingVideoText(game).title
    }
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT c."title", c."startMs", c."endMs", r."gameId" FROM "Clip" c LEFT JOIN "Recording" r ON r."id" = c."recordingId" WHERE c."id" = ?`,
      id,
    )
    const clip = rows[0]
    if (!clip) return null
    const game = clip.gameId ? await prisma.game.findUnique({ where: { id: clip.gameId }, select: { champion: true, opponentChampion: true, win: true, gameEndAt: true } }) : null
    return clipVideoText({ title: clip.title, startMs: Number(clip.startMs), endMs: Number(clip.endMs) }, game).title
  } catch {
    return null
  }
}

/**
 * A new video to upload (a game's recording once linked, or a saved clip). Ignored unless the setting is on, the
 * upload is available in this build and an account is connected.
 */
export async function queueAutoUpload(kind: AutoUploadKind, id: string): Promise<void> {
  try {
    if (!youtubeUploadAvailable() || !youtubeConnected()) return
    const pref = await getAutoYoutube()
    if (!pref.enabled) return
    load()
    queue = enqueue(queue, kind, id, Date.now(), await titleOf(kind, id))
    save()
    changed()
    void pump()
  } catch (err) {
    console.warn('[youtube-auto] not queued:', (err as Error).message)
  }
}

/** « Réessayer » on a row: a given-up upload goes back in the queue; a paused or waiting one is tried now. */
export async function retryQueueItem(queueId: string): Promise<{ success: boolean }> {
  load()
  const ref = parseQueueId(queueId)
  if (!ref) return { success: false }
  const pref = await getAutoYoutube().catch(() => null)
  const inQueue = queue.find((q) => same(q, ref.kind, ref.targetId))
  if (inQueue) {
    if (inQueue.state === 'uploading') return { success: true }
    queue = queue.map((q) => (same(q, ref.kind, ref.targetId) || q.state === 'paused_auth' ? { ...q, state: 'pending', nextAt: null } : q))
  } else {
    const f = finished.find((x) => same(x, ref.kind, ref.targetId) && x.status === 'error')
    if (!f || !pref?.enabled || !youtubeUploadAvailable() || !youtubeConnected()) return { success: false }
    finished = finished.filter((x) => !same(x, ref.kind, ref.targetId))
    queue = enqueue(queue, ref.kind, ref.targetId, Date.now(), f.title)
  }
  save()
  changed()
  void pump()
  return { success: true }
}

/** Turned off, or disconnected: empty the queue and stop the current upload. */
function stopAll(): void {
  load()
  current?.abort.abort()
  queue = []
  save()
  schedule()
  changed()
}

/** Paused items (connection lost) become due again. */
function resumePaused(): void {
  load()
  queue = queue.map((q) => (q.state === 'paused_auth' ? { ...q, state: 'pending', nextAt: null } : q))
  save()
  changed()
  void pump()
}

export function registerYoutubeAutoUpload(): void {
  load()
  validatedHandle('youtube:queue-list', z.tuple([]), () => listQueue())
  validatedHandle('youtube:queue-retry', z.tuple([z.string().min(1).max(80)]), (_e, queueId) => retryQueueItem(queueId))
  onAutoYoutubeChange((pref) => { if (pref.enabled) resumePaused(); else stopAll() })
  onYoutubeConnectionChange((connected) => { if (connected) resumePaused(); else stopAll() })
  // After start-up: what a restart interrupted ("uploading" is pending again) goes on.
  setTimeout(() => { void pump() }, 30_000)
}
