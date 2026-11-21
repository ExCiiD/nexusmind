/** 21/11/2026 « Upload YouTube automatique »: the queue's rules, the setting, and the video text of a game. */
import { describe, it, expect } from 'vitest'
import {
  addFinished, backoffMs, enqueue, FINISHED_KEEP, MAX_ATTEMPTS, nextDue, nextQuotaReset, nextWakeAt, onFailure, parseFinished,
  parseQueue, parseQueueId, queueView, recordingVideoText,
  type AutoUploadItem, type FinishedUpload,
} from '../../electron/main/youtubeQueueCore'
import { DEFAULT_AUTO_YOUTUBE, normalizeAutoYoutube } from '../../src/lib/autoYoutubePref'
import { userUpdateSchema } from '../../electron/main/ipc/validate'

const T0 = Date.UTC(2026, 10, 21, 12, 0, 0)
const item = (over: Partial<AutoUploadItem> = {}): AutoUploadItem => ({ kind: 'clip', id: 'c1', title: null, state: 'pending', attempts: 0, nextAt: null, lastError: null, addedAt: T0, ...over })

describe('the queue', () => {
  it('never twice the same video', () => {
    let q = enqueue([], 'clip', 'c1', T0)
    q = enqueue(q, 'clip', 'c1', T0 + 1)
    q = enqueue(q, 'recording', 'c1', T0 + 2)
    expect(q.map((i) => `${i.kind}:${i.id}`)).toEqual(['clip:c1', 'recording:c1'])
  })
  it('one at a time, oldest first, only when due', () => {
    const q = [item({ id: 'b', addedAt: T0 + 5 }), item({ id: 'a', addedAt: T0 }), item({ id: 'later', addedAt: T0 - 9, nextAt: T0 + 60_000 })]
    expect(nextDue(q, T0)?.id).toBe('a')
    expect(nextDue([item({ state: 'uploading' })], T0)).toBeNull()
    expect(nextDue([item({ state: 'paused_auth' })], T0)).toBeNull()
  })
  it('backoff: 1 min, 2, 4… capped at 6 h', () => {
    expect(backoffMs(1)).toBe(60_000)
    expect(backoffMs(2)).toBe(120_000)
    expect(backoffMs(3)).toBe(240_000)
    expect(backoffMs(30)).toBe(6 * 3600_000)
  })
  it('a generic error retries later, and gives up after MAX_ATTEMPTS', () => {
    const r = onFailure(item(), 'YOUTUBE_ERROR', T0)
    expect(r).toMatchObject({ action: 'keep', pauseQueue: false, item: { attempts: 1, nextAt: T0 + 60_000, state: 'pending' } })
    expect(onFailure(item({ attempts: MAX_ATTEMPTS - 1 }), 'YOUTUBE_ERROR', T0).action).toBe('drop')
  })
  it('a missing file is dropped at once', () => {
    expect(onFailure(item(), 'FILE_NOT_FOUND', T0).action).toBe('drop')
    expect(onFailure(item(), 'FILE_NOT_ALLOWED', T0).action).toBe('drop')
    expect(onFailure(item(), 'NOT_FOUND', T0).action).toBe('drop')
  })
  it('quota used up: waits for YouTube\'s next day, and holds the whole queue', () => {
    const r = onFailure(item(), 'QUOTA_EXCEEDED', T0)
    expect(r).toMatchObject({ action: 'keep', item: { state: 'waiting_quota', attempts: 0 } })
    const waiting = (r as { item: AutoUploadItem }).item
    expect(nextDue([waiting, item({ id: 'other' })], T0)).toBeNull()
    expect(nextDue([waiting, item({ id: 'other' })], waiting.nextAt!)?.id).toBe('c1')
    expect(nextWakeAt([waiting])).toBe(waiting.nextAt)
  })
  it('connection lost: the queue pauses, no attempt used', () => {
    for (const code of ['NOT_AUTHENTICATED', 'AUTH_EXPIRED', 'YOUTUBE_UNAVAILABLE', 'ENCRYPTION_UNAVAILABLE']) {
      expect(onFailure(item({ attempts: 2 }), code, T0)).toMatchObject({ action: 'keep', pauseQueue: true, item: { state: 'paused_auth', attempts: 2, nextAt: null } })
    }
  })
  it('YouTube\'s day: next midnight Pacific time (+5 min), winter and summer', () => {
    // 21/11 12:00 UTC = 04:00 PST → 22/11 00:00 PST = 08:00 UTC
    expect(new Date(nextQuotaReset(T0)).toISOString()).toBe('2026-11-22T08:05:00.000Z')
    // 01/07 12:00 UTC = 05:00 PDT → 02/07 00:00 PDT = 07:00 UTC
    expect(new Date(nextQuotaReset(Date.UTC(2026, 6, 1, 12))).toISOString()).toBe('2026-07-02T07:05:00.000Z')
    // just before midnight PST: the next one, not the same day
    expect(new Date(nextQuotaReset(Date.UTC(2026, 10, 22, 7, 59))).toISOString()).toBe('2026-11-22T08:05:00.000Z')
  })
  it('a stored queue: bad items ignored, an interrupted upload is pending again', () => {
    const q = parseQueue([
      { kind: 'clip', id: 'c1', state: 'uploading', attempts: 1, nextAt: null, addedAt: 1 },
      { kind: 'video', id: 'x' }, { kind: 'clip', id: '' }, 'junk', null,
      { kind: 'recording', id: 'r1', state: 'waiting_quota', nextAt: 99, attempts: -3 },
    ])
    expect(q).toEqual([
      { kind: 'clip', id: 'c1', title: null, state: 'pending', attempts: 1, nextAt: null, lastError: null, addedAt: 1 },
      { kind: 'recording', id: 'r1', title: null, state: 'waiting_quota', attempts: 0, nextAt: 99, lastError: null, addedAt: 0 },
    ])
    expect(parseQueue('nope')).toEqual([])
  })
})

describe('the setting', () => {
  it('off by default, unlisted, without sound', () => {
    expect(DEFAULT_AUTO_YOUTUBE).toEqual({ enabled: false, visibility: 'unlisted', audio: 'none' })
    expect(normalizeAutoYoutube(null)).toEqual(DEFAULT_AUTO_YOUTUBE)
  })
  it('the player\'s visibility is kept; bad values fall back', () => {
    expect(normalizeAutoYoutube('{"enabled":true,"visibility":"public","audio":"all"}')).toEqual({ enabled: true, visibility: 'public', audio: 'all' })
    // No "without the mic only" (the mic is mixed into the game's track): such a value falls back to no sound at all.
    expect(normalizeAutoYoutube({ enabled: true, audio: 'no_mic' })).toEqual({ enabled: true, visibility: 'unlisted', audio: 'none' })
    expect(normalizeAutoYoutube({ enabled: 'yes', visibility: 'everyone', x: 1 })).toEqual(DEFAULT_AUTO_YOUTUBE)
  })
  it('updateUser accepts it, partial, and refuses an unknown visibility', () => {
    expect(userUpdateSchema.parse({ autoYoutubeUpload: { enabled: true, extra: 1 } })).toEqual({ autoYoutubeUpload: { enabled: true } })
    expect(() => userUpdateSchema.parse({ autoYoutubeUpload: { visibility: 'everyone' } })).toThrow()
    expect(userUpdateSchema.parse({ autoYoutubeUpload: { audio: 'all' } })).toEqual({ autoYoutubeUpload: { audio: 'all' } })
    expect(() => userUpdateSchema.parse({ autoYoutubeUpload: { audio: 'no_mic' } })).toThrow()
  })
})

describe('a game\'s video text', () => {
  it('champion, opponent, result, date', () => {
    const t = recordingVideoText({ champion: 'Jayce', opponentChampion: 'Gnar', win: false, gameEndAt: new Date('2026-11-20T11:44:00Z') })
    expect(t).toEqual({ title: 'Jayce vs Gnar · Defeat · 2026-11-20', description: 'Jayce vs Gnar · Defeat · 2026-11-20\nUploaded by Ascend' })
    expect(recordingVideoText(null).title).toBe('Game recording')
  })
})

describe('the queue screen (Front-End\'s YoutubeQueueItem)', () => {
  const fin = (over: Partial<FinishedUpload> = {}): FinishedUpload => ({ kind: 'clip', id: 'd1', title: 'Old clip', status: 'done', url: 'https://www.youtube.com/watch?v=abc_123', error: null, at: T0, ...over })
  it('waiting and uploading first (oldest first), then finished; a paused queue shows its code as an error', () => {
    const q = [
      item({ id: 'b', addedAt: T0 + 2, title: 'B' }),
      item({ id: 'a', addedAt: T0 + 1, state: 'uploading', title: 'A' }),
      item({ kind: 'recording', id: 'r', addedAt: T0 + 3, state: 'paused_auth', lastError: 'AUTH_EXPIRED' }),
      item({ id: 'w', addedAt: T0 + 4, state: 'waiting_quota', nextAt: Date.UTC(2026, 10, 22, 8, 5), lastError: 'QUOTA_EXCEEDED' }),
    ]
    const v = queueView(q, [fin()], (kind, id) => (id === 'a' ? 42 : null))
    expect(v.map((r) => [r.id, r.status, r.percent])).toEqual([
      ['clip:a', 'uploading', 42], ['clip:b', 'queued', null], ['recording:r', 'error', null], ['clip:w', 'waiting_quota', null], ['clip:d1', 'done', 100],
    ])
    expect(v[0]).toMatchObject({ kind: 'clip', targetId: 'a', title: 'A', url: null, retryAt: null })
    expect(v[2].error).toBe('AUTH_EXPIRED')
    expect(v[3].retryAt).toBe('2026-11-22T08:05:00.000Z')
    expect(v[4]).toMatchObject({ url: 'https://www.youtube.com/watch?v=abc_123', error: null })
  })
  it('a video back in the queue is shown once', () => {
    expect(queueView([item({ id: 'd1' })], [fin({ status: 'error', error: 'FILE_NOT_FOUND', url: null })], () => null)).toHaveLength(1)
  })
  it('retry ids', () => {
    expect(parseQueueId('clip:clip_1_ab')).toEqual({ kind: 'clip', targetId: 'clip_1_ab' })
    expect(parseQueueId('recording:r1')).toEqual({ kind: 'recording', targetId: 'r1' })
    expect(parseQueueId('video:x')).toBeNull()
    expect(parseQueueId('clip:../x')).toBeNull()
  })
  it('finished uploads: one per video, the 30 most recent of the last 7 days', () => {
    let f: FinishedUpload[] = []
    for (let i = 0; i < 40; i++) f = addFinished(f, fin({ id: `x${i}`, at: T0 + i }), T0 + 40)
    expect(f).toHaveLength(FINISHED_KEEP)
    expect(f[0].id).toBe('x39')
    f = addFinished(f, fin({ id: 'x39', status: 'error', at: T0 + 41 }), T0 + 41)
    expect(f.filter((x) => x.id === 'x39')).toHaveLength(1)
    expect(addFinished([fin({ at: T0 })], fin({ id: 'new', at: T0 + 8 * 86_400_000 }), T0 + 8 * 86_400_000).map((x) => x.id)).toEqual(['new'])
  })
  it('stored finished uploads: only YouTube watch links are kept', () => {
    expect(parseFinished([fin(), fin({ id: 'e', url: 'javascript:alert(1)' }), { kind: 'clip', id: 'z', status: 'weird' }])).toEqual([
      fin(), fin({ id: 'e', url: null }),
    ])
  })
})

describe('a video too long for an unverified channel (21/11/2026)', () => {
  it('YouTube\'s answers map to YOUTUBE_CHANNEL_UNVERIFIED; other refusals to YOUTUBE_REJECTED; accepted is null', async () => {
    const { uploadVerdict, youtubeErrorCode, YOUTUBE_VERIFY_URL } = await import('../../electron/main/youtubeCore')
    expect(uploadVerdict({ id: 'x', status: { uploadStatus: 'rejected', rejectionReason: 'length' } })).toBe('YOUTUBE_CHANNEL_UNVERIFIED')
    expect(uploadVerdict({ id: 'x', status: { uploadStatus: 'rejected', rejectionReason: 'duplicate' } })).toBe('YOUTUBE_REJECTED')
    expect(uploadVerdict({ id: 'x', status: { uploadStatus: 'uploaded' } })).toBeNull()
    expect(uploadVerdict({ id: 'x' })).toBeNull()
    expect(youtubeErrorCode(400, '{"error":{"message":"The video exceeds the maximum duration for this account"}}')).toBe('YOUTUBE_CHANNEL_UNVERIFIED')
    expect(youtubeErrorCode(403, '{"status":{"rejectionReason":"length"}}')).toBe('YOUTUBE_CHANNEL_UNVERIFIED')
    // The daily upload count stays a quota wait (next day), not a verification.
    expect(youtubeErrorCode(403, '{"error":{"errors":[{"reason":"uploadLimitExceeded"}]}}')).toBe('QUOTA_EXCEEDED')
    expect(YOUTUBE_VERIFY_URL).toBe('https://www.youtube.com/verify')
  })
  it('the queue does not retry it: the row ends as an error with the code, « Réessayer » once verified', () => {
    expect(onFailure(item({ attempts: 0 }), 'YOUTUBE_CHANNEL_UNVERIFIED', T0)).toEqual({ action: 'drop', item: { ...item(), lastError: 'YOUTUBE_CHANNEL_UNVERIFIED' } })
    expect(onFailure(item(), 'YOUTUBE_REJECTED', T0).action).toBe('drop')
  })
})
