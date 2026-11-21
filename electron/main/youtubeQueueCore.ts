/**
 * Pure part of the automatic YouTube upload (21/11/2026, decision « Upload YouTube automatique »): the queue's rules.
 * One video at a time, retries with backoff, a used-up quota waits for YouTube's next day (midnight, Pacific time),
 * a lost connection pauses the queue, a missing file drops the item. No I/O here.
 */
import type { YoutubeErrorCode } from './youtubeCore'

export type AutoUploadKind = 'recording' | 'clip'
export type AutoUploadState = 'pending' | 'uploading' | 'waiting_quota' | 'paused_auth'

export interface AutoUploadItem {
  kind: AutoUploadKind
  id: string
  /** The video's title on YouTube, computed when queued (shown in the queue). */
  title: string | null
  state: AutoUploadState
  attempts: number
  /** Epoch ms before which the item is not tried again (null = now). */
  nextAt: number | null
  lastError: string | null
  addedAt: number
}

/** After this many failed attempts (not counting quota and connection waits) the item is dropped. */
export const MAX_ATTEMPTS = 8
const BACKOFF_BASE_MS = 60_000
const BACKOFF_MAX_MS = 6 * 60 * 60 * 1000
/** Margin after YouTube's midnight before trying again. */
const QUOTA_RESET_MARGIN_MS = 5 * 60 * 1000

/** Adds an item unless the same video is already queued. Returns the new queue (the old one is not changed). */
export function enqueue(queue: readonly AutoUploadItem[], kind: AutoUploadKind, id: string, now: number, title: string | null = null): AutoUploadItem[] {
  if (queue.some((q) => q.kind === kind && q.id === id)) return [...queue]
  return [...queue, { kind, id, title, state: 'pending', attempts: 0, nextAt: null, lastError: null, addedAt: now }]
}

/** Wait before attempt n+1 after n failures: 1 min, 2, 4… capped at 6 h. */
export function backoffMs(attempts: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1), BACKOFF_MAX_MS)
}

/** The offset of America/Los_Angeles from UTC at `at`, in ms (negative: -7 h or -8 h). */
function pacificOffsetMs(at: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(at))
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return asUtc - Math.floor(at / 1000) * 1000
}

/** The next midnight in Pacific time after `now` (when YouTube's daily quota resets), plus a small margin. */
export function nextQuotaReset(now: number): number {
  const offset = pacificOffsetMs(now)
  const local = new Date(now + offset)
  const nextLocalMidnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1)
  // The offset can change at that midnight (daylight saving): recompute it there.
  const utcMidnight = nextLocalMidnight - pacificOffsetMs(nextLocalMidnight - offset)
  return utcMidnight + QUOTA_RESET_MARGIN_MS
}

export type FailureOutcome =
  | { action: 'drop'; item: AutoUploadItem }
  | { action: 'keep'; item: AutoUploadItem; pauseQueue: boolean }

/** What a failed upload does to its item (and to the queue). */
export function onFailure(item: AutoUploadItem, code: string, now: number): FailureOutcome {
  const c = code as YoutubeErrorCode | 'NOT_FOUND' | 'ENCRYPTION_UNAVAILABLE'
  if (c === 'FILE_NOT_FOUND' || c === 'FILE_NOT_ALLOWED' || c === 'NOT_FOUND') {
    return { action: 'drop', item: { ...item, lastError: c } }
  }
  if (c === 'QUOTA_EXCEEDED') {
    return { action: 'keep', pauseQueue: false, item: { ...item, state: 'waiting_quota', nextAt: nextQuotaReset(now), lastError: c } }
  }
  if (c === 'NOT_AUTHENTICATED' || c === 'AUTH_EXPIRED' || c === 'YOUTUBE_UNAVAILABLE' || c === 'ENCRYPTION_UNAVAILABLE') {
    // Waits for the player to connect YouTube again; no attempt is used.
    return { action: 'keep', pauseQueue: true, item: { ...item, state: 'paused_auth', nextAt: null, lastError: c } }
  }
  const attempts = item.attempts + 1
  if (attempts >= MAX_ATTEMPTS) return { action: 'drop', item: { ...item, attempts, lastError: 'YOUTUBE_ERROR' } }
  return { action: 'keep', pauseQueue: false, item: { ...item, state: 'pending', attempts, nextAt: now + backoffMs(attempts), lastError: 'YOUTUBE_ERROR' } }
}

/** The next item to upload now (the oldest that is due), or null. A used-up quota holds every item until the reset. */
export function nextDue(queue: readonly AutoUploadItem[], now: number): AutoUploadItem | null {
  const quotaUntil = Math.max(0, ...queue.filter((q) => q.state === 'waiting_quota' && q.nextAt).map((q) => q.nextAt as number))
  if (quotaUntil > now) return null
  const due = queue
    .filter((q) => q.state !== 'paused_auth' && q.state !== 'uploading' && (q.nextAt === null || q.nextAt <= now))
    .sort((a, b) => a.addedAt - b.addedAt)
  return due[0] ?? null
}

/** When the queue should wake up next (epoch ms), or null when nothing is waiting on time. */
export function nextWakeAt(queue: readonly AutoUploadItem[]): number | null {
  const times = queue.filter((q) => q.state !== 'paused_auth' && q.nextAt !== null).map((q) => q.nextAt as number)
  return times.length ? Math.min(...times) : null
}

/** Reads a stored queue, keeping only well-formed items (an "uploading" item from a crash becomes pending again). */
export function parseQueue(raw: unknown): AutoUploadItem[] {
  if (!Array.isArray(raw)) return []
  const out: AutoUploadItem[] = []
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue
    const o = r as Record<string, unknown>
    if ((o.kind !== 'recording' && o.kind !== 'clip') || typeof o.id !== 'string' || !o.id || o.id.length > 64) continue
    const state = o.state === 'waiting_quota' || o.state === 'paused_auth' ? o.state : 'pending'
    out.push({
      kind: o.kind, id: o.id, state,
      title: typeof o.title === 'string' ? o.title.slice(0, 100) : null,
      attempts: typeof o.attempts === 'number' && o.attempts >= 0 ? Math.floor(o.attempts) : 0,
      nextAt: typeof o.nextAt === 'number' ? o.nextAt : null,
      lastError: typeof o.lastError === 'string' ? o.lastError.slice(0, 64) : null,
      addedAt: typeof o.addedAt === 'number' ? o.addedAt : 0,
    })
  }
  return out
}

/** Title and description of a full game's video. */
export function recordingVideoText(game: { champion: string; opponentChampion: string | null; win: boolean; gameEndAt: Date | null } | null): { title: string; description: string } {
  if (!game) return { title: 'Game recording', description: 'Uploaded by Ascend' }
  const date = game.gameEndAt ? game.gameEndAt.toISOString().slice(0, 10) : null
  const title = `${game.champion}${game.opponentChampion ? ` vs ${game.opponentChampion}` : ''} · ${game.win ? 'Victory' : 'Defeat'}${date ? ` · ${date}` : ''}`.slice(0, 100)
  return { title, description: `${title}\nUploaded by Ascend` }
}

/** A finished upload, kept a while so the queue screen can show it (done with its link, or given up with its code). */
export interface FinishedUpload {
  kind: AutoUploadKind
  id: string
  title: string | null
  status: 'done' | 'error'
  url: string | null
  error: string | null
  at: number
}

export const FINISHED_KEEP = 30
const FINISHED_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

/** Adds a finished upload (replacing an older one of the same video), keeping the 30 most recent of the last 7 days. */
export function addFinished(list: readonly FinishedUpload[], f: FinishedUpload, now: number): FinishedUpload[] {
  return [f, ...list.filter((x) => !(x.kind === f.kind && x.id === f.id))]
    .filter((x) => now - x.at <= FINISHED_MAX_AGE_MS)
    .slice(0, FINISHED_KEEP)
}

/** Reads stored finished uploads, keeping only well-formed ones. */
export function parseFinished(raw: unknown): FinishedUpload[] {
  if (!Array.isArray(raw)) return []
  const out: FinishedUpload[] = []
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue
    const o = r as Record<string, unknown>
    if ((o.kind !== 'recording' && o.kind !== 'clip') || typeof o.id !== 'string' || !o.id || o.id.length > 64) continue
    if (o.status !== 'done' && o.status !== 'error') continue
    out.push({
      kind: o.kind, id: o.id, status: o.status,
      title: typeof o.title === 'string' ? o.title.slice(0, 100) : null,
      url: typeof o.url === 'string' && /^https:\/\/www\.youtube\.com\/watch\?v=[\w-]+$/.test(o.url) ? o.url : null,
      error: typeof o.error === 'string' ? o.error.slice(0, 64) : null,
      at: typeof o.at === 'number' ? o.at : 0,
    })
  }
  return out.slice(0, FINISHED_KEEP)
}

/** One row of the queue screen (Front-End's YoutubeQueueItem, src/lib/youtubeQueue.ts). */
export interface YoutubeQueueView {
  /** "kind:targetId": the id youtube:queue-retry takes. */
  id: string
  kind: AutoUploadKind
  targetId: string
  title: string | null
  status: 'queued' | 'uploading' | 'waiting_quota' | 'done' | 'error'
  percent: number | null
  url: string | null
  error: string | null
  retryAt: string | null
}

/**
 * The queue screen's rows: what is waiting or uploading (oldest first), then what finished (newest first). A queue paused
 * for the connection shows as an error with its code (NOT_AUTHENTICATED, AUTH_EXPIRED…): reconnecting or retrying resumes it.
 */
export function queueView(queue: readonly AutoUploadItem[], finished: readonly FinishedUpload[], percentOf: (kind: AutoUploadKind, id: string) => number | null): YoutubeQueueView[] {
  const live: YoutubeQueueView[] = [...queue].sort((a, b) => a.addedAt - b.addedAt).map((q) => ({
    id: `${q.kind}:${q.id}`, kind: q.kind, targetId: q.id, title: q.title,
    status: q.state === 'uploading' ? 'uploading' : q.state === 'waiting_quota' ? 'waiting_quota' : q.state === 'paused_auth' ? 'error' : 'queued',
    percent: q.state === 'uploading' ? percentOf(q.kind, q.id) ?? 0 : null,
    url: null,
    error: q.lastError,
    retryAt: q.nextAt !== null && q.state !== 'uploading' ? new Date(q.nextAt).toISOString() : null,
  }))
  const done: YoutubeQueueView[] = finished.map((f) => ({
    id: `${f.kind}:${f.id}`, kind: f.kind, targetId: f.id, title: f.title, status: f.status,
    percent: f.status === 'done' ? 100 : null, url: f.url, error: f.error, retryAt: null,
  }))
  return [...live, ...done.filter((d) => !live.some((l) => l.id === d.id))]
}

/** "kind:targetId" → its parts, or null. */
export function parseQueueId(id: string): { kind: AutoUploadKind; targetId: string } | null {
  const m = /^(recording|clip):([\w-]{1,64})$/.exec(id)
  return m ? { kind: m[1] as AutoUploadKind, targetId: m[2] } : null
}
