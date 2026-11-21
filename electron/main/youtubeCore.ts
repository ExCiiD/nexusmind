/**
 * Pure part of the YouTube upload (21/11/2026, clips shared to YouTube): clean error codes for the screens, and the
 * text of a clip's video. No tokens here.
 */
import { createHash, randomBytes } from 'node:crypto'

/** PKCE verifier and S256 challenge, and a state value, all random (RFC 7636). */
export function pkcePair(): { verifier: string; challenge: string; state: string } {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge, state: randomBytes(16).toString('base64url') }
}

/** The one scope the app asks for (21/11/2026): uploading the player's videos, nothing else. */
export const YOUTUBE_SCOPE = 'https://www.googleapis.com/auth/youtube.upload'

export type YoutubeErrorCode =
  | 'YOUTUBE_UNAVAILABLE' // this build cannot upload (no Google credentials: development only, option A of 19/11)
  | 'NOT_AUTHENTICATED' // no YouTube account connected
  | 'ENCRYPTION_UNAVAILABLE' // Windows cannot encrypt the tokens: the connection is refused (no plaintext storage)
  | 'AUTH_EXPIRED' // the connection was revoked or expired: connect again
  | 'QUOTA_EXCEEDED' // YouTube's daily upload quota is used up: try again tomorrow
  | 'FILE_NOT_FOUND'
  | 'FILE_NOT_ALLOWED'
  | 'YOUTUBE_ERROR'

/** The code for a failed YouTube API answer (status and body). */
export function youtubeErrorCode(status: number, body: string): YoutubeErrorCode {
  const b = body.toLowerCase()
  if (status === 401 || b.includes('invalid_grant') || b.includes('autherror') || b.includes('invalid credentials')) return 'AUTH_EXPIRED'
  if (status === 403 || status === 429) {
    if (/quotaexceeded|dailylimitexceeded|uploadlimitexceeded|ratelimitexceeded|userratelimitexceeded/.test(b)) return 'QUOTA_EXCEEDED'
    if (b.includes('insufficientpermissions') || b.includes('forbidden')) return 'AUTH_EXPIRED'
  }
  return 'YOUTUBE_ERROR'
}

const mmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** The title and description of a clip's video: its title (or its times), and the game it comes from. */
export function clipVideoText(clip: { title: string | null; startMs: number; endMs: number }, game: { champion: string; opponentChampion: string | null; win: boolean; gameEndAt: Date | null } | null): { title: string; description: string } {
  const range = `${mmss(clip.startMs)} → ${mmss(clip.endMs)}`
  const title = (clip.title?.trim() || (game ? `${game.champion} · ${range}` : `Clip ${range}`)).slice(0, 100)
  const lines = [
    clip.title?.trim() ? `${clip.title.trim()} (${range})` : range,
    ...(game ? [`${game.champion}${game.opponentChampion ? ` vs ${game.opponentChampion}` : ''} · ${game.win ? 'Victory' : 'Defeat'}${game.gameEndAt ? ` · ${game.gameEndAt.toISOString().slice(0, 10)}` : ''}`] : []),
    'Uploaded by Ascend',
  ]
  return { title, description: lines.join('\n').slice(0, 5000) }
}
