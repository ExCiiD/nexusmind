/** 21/11/2026 « Partage des clips » to YouTube: clean error codes and the text of a clip's video. */
import { describe, it, expect } from 'vitest'
import { clipVideoText, youtubeErrorCode } from '../../electron/main/youtubeCore'

describe('YouTube error codes', () => {
  it('quota used up, from the API reasons', () => {
    expect(youtubeErrorCode(403, '{"error":{"errors":[{"reason":"quotaExceeded"}]}}')).toBe('QUOTA_EXCEEDED')
    expect(youtubeErrorCode(403, '{"error":{"errors":[{"reason":"uploadLimitExceeded"}]}}')).toBe('QUOTA_EXCEEDED')
    expect(youtubeErrorCode(429, 'rateLimitExceeded')).toBe('QUOTA_EXCEEDED')
  })
  it('a revoked or expired connection', () => {
    expect(youtubeErrorCode(401, 'Invalid Credentials')).toBe('AUTH_EXPIRED')
    expect(youtubeErrorCode(400, '{"error":"invalid_grant"}')).toBe('AUTH_EXPIRED')
    expect(youtubeErrorCode(403, 'insufficientPermissions')).toBe('AUTH_EXPIRED')
  })
  it('anything else stays a generic error', () => {
    expect(youtubeErrorCode(500, 'backend error')).toBe('YOUTUBE_ERROR')
  })
})

describe('a clip\'s video text', () => {
  const game = { champion: 'Jayce', opponentChampion: 'Gnar', win: true, gameEndAt: new Date('2026-11-20T11:44:00Z') }
  it('the clip\'s title, and the game in the description', () => {
    const t = clipVideoText({ title: 'Level 2 all-in', startMs: 542_000, endMs: 572_000 }, game)
    expect(t.title).toBe('Level 2 all-in')
    expect(t.description).toBe('Level 2 all-in (9:02 → 9:32)\nJayce vs Gnar · Victory · 2026-11-20\nUploaded by Ascend')
  })
  it('without a title: the champion and the times; without a game: the times only', () => {
    expect(clipVideoText({ title: null, startMs: 542_000, endMs: 572_000 }, game).title).toBe('Jayce · 9:02 → 9:32')
    expect(clipVideoText({ title: '  ', startMs: 0, endMs: 30_000 }, null)).toEqual({ title: 'Clip 0:00 → 0:30', description: '0:00 → 0:30\nUploaded by Ascend' })
  })
  it('YouTube limits: title 100 characters', () => {
    expect(clipVideoText({ title: 'x'.repeat(300), startMs: 0, endMs: 1000 }, null).title).toHaveLength(100)
  })
})

describe('Google verification prerequisites (21/11/2026)', () => {
  it('one scope only: youtube.upload, never a read scope', async () => {
    const { YOUTUBE_SCOPE } = await import('../../electron/main/youtubeCore')
    expect(YOUTUBE_SCOPE).toBe('https://www.googleapis.com/auth/youtube.upload')
    expect(YOUTUBE_SCOPE.split(' ')).toHaveLength(1)
  })
  it('PKCE: S256 challenge of the verifier, random every time, with a state', async () => {
    const { createHash } = await import('node:crypto')
    const { pkcePair } = await import('../../electron/main/youtubeCore')
    const a = pkcePair()
    const b = pkcePair()
    expect(a.challenge).toBe(createHash('sha256').update(a.verifier).digest('base64url'))
    expect(a.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(a.verifier).not.toBe(b.verifier)
    expect(a.state).not.toBe(b.state)
  })
})
