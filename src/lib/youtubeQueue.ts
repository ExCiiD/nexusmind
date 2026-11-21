/**
 * « Upload YouTube automatique » (DECISIONS 21/11): when it is on, every recorded game and every clip goes up to
 * YouTube on its own, with the visibility the player chose. The setting is a synced user setting (getUser /
 * updateUser { autoYoutubeUpload }); the uploads go through Back-end's queue, whose state the screens show (in
 * progress, waiting for the quota, error). Pure, tested.
 */

/** The YouTube error codes the screens translate (recording.clip.youtubeErrors.*); any other one shows « generic ». */
export const YOUTUBE_ERROR_CODES = ['NOT_AUTHENTICATED', 'AUTH_EXPIRED', 'QUOTA_EXCEEDED', 'YOUTUBE_UNAVAILABLE', 'UPLOAD_IN_PROGRESS', 'ENCRYPTION_UNAVAILABLE', 'YOUTUBE_CHANNEL_UNVERIFIED', 'YOUTUBE_REJECTED'] as const
/** Beta.23: videos over 15 min need a phone-verified channel (YOUTUBE_CHANNEL_UNVERIFIED); Back-end's youtubeCore has the same. */
export const YOUTUBE_VERIFY_URL = 'https://www.youtube.com/verify'

/** The translated code of an error (its message may carry it among other words), else 'generic'. */
export function youtubeErrorCode(message: string | null | undefined): string {
  return YOUTUBE_ERROR_CODES.find((c) => (message ?? '').includes(c)) ?? 'generic'
}

export type YoutubeVisibility = 'public' | 'unlisted' | 'private'
export const YOUTUBE_VISIBILITIES: YoutubeVisibility[] = ['public', 'unlisted', 'private']

/**
 * What the automatic upload keeps of the sound (Cyber audit 21/11): all, or none. No « without the mic » (Back-end,
 * src/lib/autoYoutubePref.ts): the mic is mixed into the game's sound track when recording.
 */
export type YoutubeAudio = 'all' | 'none'
/** « Sans son (recommandé) » first (docs/GOOGLE_YOUTUBE_VERIFICATION.md § 3.6). */
export const YOUTUBE_AUDIOS: YoutubeAudio[] = ['none', 'all']

export interface AutoYoutubeUpload { enabled: boolean; visibility: YoutubeVisibility; audio: YoutubeAudio }
export const DEFAULT_AUTO_YOUTUBE: AutoYoutubeUpload = { enabled: false, visibility: 'unlisted', audio: 'none' }

export function parseAutoYoutube(raw: unknown): AutoYoutubeUpload {
  let v = raw
  if (typeof v === 'string') { try { v = JSON.parse(v) } catch { v = null } }
  const o = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  return {
    enabled: o.enabled === true,
    visibility: YOUTUBE_VISIBILITIES.includes(o.visibility as YoutubeVisibility) ? (o.visibility as YoutubeVisibility) : DEFAULT_AUTO_YOUTUBE.visibility,
    audio: YOUTUBE_AUDIOS.includes(o.audio as YoutubeAudio) ? (o.audio as YoutubeAudio) : DEFAULT_AUTO_YOUTUBE.audio,
  }
}

export type QueueStatus = 'queued' | 'uploading' | 'waiting_quota' | 'done' | 'error'

export interface YoutubeQueueItem {
  id: string
  kind: 'recording' | 'clip'
  /** The recording's or the clip's id. */
  targetId: string
  title: string | null
  status: QueueStatus
  /** 0-100 while uploading. */
  percent: number | null
  url: string | null
  /** An error code (NOT_AUTHENTICATED, AUTH_EXPIRED, QUOTA_EXCEEDED, …). */
  error: string | null
  /** When a quota wait or a retry is due (ISO). */
  retryAt: string | null
}


/**
 * Back-end's states (youtube:auto-queue / youtube:auto-upload) → the screens' ones: pending → queued; paused_auth →
 * an error asking to reconnect YouTube (AUTH_EXPIRED); failed (file gone or 8 failures) → error.
 */
function statusOf(state: unknown): { status: QueueStatus; error?: string } | null {
  switch (state) {
    case 'pending': case 'queued': return { status: 'queued' }
    case 'uploading': return { status: 'uploading' }
    case 'waiting_quota': return { status: 'waiting_quota' }
    case 'paused_auth': return { status: 'error', error: 'AUTH_EXPIRED' }
    case 'failed': case 'error': return { status: 'error' }
    case 'done': return { status: 'done' }
    default: return null
  }
}

/** The queue as Back-end gives it ({ items: [{ kind, id, state, attempts, nextAt, lastError }] }; bad rows dropped). */
export function parseQueue(raw: unknown): YoutubeQueueItem[] {
  const rows = Array.isArray(raw) ? raw : raw && typeof raw === 'object' && Array.isArray((raw as { items?: unknown }).items) ? (raw as { items: unknown[] }).items : []
  return rows.flatMap((x) => {
    const r = x as Record<string, unknown>
    const s = r ? statusOf(r.state ?? r.status) : null
    if (!r || !s || typeof r.id !== 'string' || (r.kind !== 'recording' && r.kind !== 'clip')) return []
    const target = typeof r.targetId === 'string' ? r.targetId : r.id
    return [{
      // Back-end's queue id is « kind:targetId » (what youtube:queue-retry takes).
      id: typeof r.targetId === 'string' ? r.id : `${r.kind}:${target}`, kind: r.kind, targetId: target,
      title: typeof r.title === 'string' ? r.title : null,
      status: s.status,
      percent: typeof r.percent === 'number' ? Math.max(0, Math.min(100, Math.round(r.percent))) : null,
      url: typeof r.url === 'string' ? r.url : null,
      error: s.error ?? (typeof r.lastError === 'string' ? r.lastError : typeof r.error === 'string' ? r.error : null),
      retryAt: typeof r.retryAt === 'string' ? r.retryAt : typeof r.nextAt === 'string' ? r.nextAt : typeof r.nextAt === 'number' ? new Date(r.nextAt).toISOString() : null,
    }]
  })
}

/** A pushed `youtube:auto-upload` event applied to the list (a new entry when it is not there yet). */
export function applyAutoUploadEvent(items: YoutubeQueueItem[], ev: unknown): YoutubeQueueItem[] {
  const [next] = parseQueue([ev])
  if (!next) return items
  const i = items.findIndex((x) => x.id === next.id)
  if (i < 0) return [...items, next]
  const merged = { ...items[i], ...next, percent: next.percent ?? (next.status === 'uploading' ? items[i].percent : null), url: next.url ?? items[i].url }
  return items.map((x, j) => (j === i ? merged : x))
}

/** The latest entry of a recording or a clip (a later attempt wins). */
export function queueEntryFor(items: YoutubeQueueItem[], kind: 'recording' | 'clip', targetId: string): YoutubeQueueItem | null {
  const mine = items.filter((x) => x.kind === kind && x.targetId === targetId)
  return mine.length ? mine[mine.length - 1] : null
}

/** Settings' summary: how many are in progress, waiting for the quota, in error (done ones are not counted). */
export function queueSummary(items: YoutubeQueueItem[]): { active: number; waitingQuota: number; errors: number } {
  return {
    active: items.filter((x) => x.status === 'queued' || x.status === 'uploading').length,
    waitingQuota: items.filter((x) => x.status === 'waiting_quota').length,
    errors: items.filter((x) => x.status === 'error').length,
  }
}
