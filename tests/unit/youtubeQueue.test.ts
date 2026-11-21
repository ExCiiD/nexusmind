import { describe, it, expect } from 'vitest'
import { DEFAULT_AUTO_YOUTUBE, applyAutoUploadEvent, parseAutoYoutube, parseQueue, queueEntryFor, queueSummary } from '../../src/lib/youtubeQueue'

// DECISIONS 21/11 « Upload YouTube automatique »; Back-end's youtube:auto-queue / youtube:auto-upload.
describe('automatic YouTube upload', () => {
  it('reads the setting, off and unlisted by default', () => {
    expect(parseAutoYoutube(null)).toEqual(DEFAULT_AUTO_YOUTUBE)
    expect(parseAutoYoutube({ enabled: true, visibility: 'public', audio: 'all' })).toEqual({ enabled: true, visibility: 'public', audio: 'all' })
    // An old value without the audio option (or an unknown one): no audio.
    expect(parseAutoYoutube(JSON.stringify({ enabled: true, visibility: 'everyone' }))).toEqual({ enabled: true, visibility: 'unlisted', audio: 'none' })
    expect(parseAutoYoutube({ audio: 'no_mic' }).audio).toBe('none')
  })

  it('reads Back-end\'s queue and finds the entry of a recording or a clip', () => {
    const q = parseQueue({ items: [
      { kind: 'clip', id: 'c1', state: 'paused_auth', attempts: 1, nextAt: null, lastError: null },
      { kind: 'recording', id: 'r1', state: 'waiting_quota', attempts: 2, nextAt: '2026-11-22T08:00:00Z', lastError: 'QUOTA_EXCEEDED' },
      { kind: 'recording', id: 'r2', state: 'pending', attempts: 0, nextAt: null, lastError: null },
      { kind: 'other', id: 'z', state: 'pending' },
    ] })
    expect(q).toHaveLength(3)
    expect(queueEntryFor(q, 'clip', 'c1')).toMatchObject({ status: 'error', error: 'AUTH_EXPIRED' })
    expect(queueEntryFor(q, 'recording', 'r1')).toMatchObject({ status: 'waiting_quota', retryAt: '2026-11-22T08:00:00Z' })
    expect(queueSummary(q)).toEqual({ active: 1, waitingQuota: 1, errors: 1 })
    expect(parseQueue(null)).toEqual([])
  })

  it('reads the agreed view (youtube:queue-list) and keeps its retry id', () => {
    const q = parseQueue([
      { id: 'clip:c1', kind: 'clip', targetId: 'c1', title: 'Baron steal', status: 'error', percent: null, url: null, error: 'AUTH_EXPIRED', retryAt: null },
      { id: 'recording:r1', kind: 'recording', targetId: 'r1', title: null, status: 'uploading', percent: 12, url: null, error: null, retryAt: null },
    ])
    expect(q.map((x) => x.id)).toEqual(['clip:c1', 'recording:r1'])
    expect(queueEntryFor(q, 'clip', 'c1')).toMatchObject({ status: 'error', error: 'AUTH_EXPIRED', title: 'Baron steal' })
  })

  it('applies the pushed events: progress, done with its link, failed', () => {
    let q = parseQueue({ items: [{ kind: 'clip', id: 'c1', state: 'pending' }] })
    q = applyAutoUploadEvent(q, { kind: 'clip', id: 'c1', state: 'uploading', percent: 42.4 })
    expect(queueEntryFor(q, 'clip', 'c1')).toMatchObject({ status: 'uploading', percent: 42 })
    q = applyAutoUploadEvent(q, { kind: 'clip', id: 'c1', state: 'done', url: 'https://youtu.be/a' })
    expect(queueEntryFor(q, 'clip', 'c1')).toMatchObject({ status: 'done', url: 'https://youtu.be/a' })
    q = applyAutoUploadEvent(q, { kind: 'recording', id: 'r9', state: 'failed', error: 'FILE_NOT_FOUND' })
    expect(queueEntryFor(q, 'recording', 'r9')).toMatchObject({ status: 'error', error: 'FILE_NOT_FOUND' })
    expect(applyAutoUploadEvent(q, { nope: 1 })).toBe(q)
  })
})
