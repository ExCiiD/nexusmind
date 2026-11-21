/**
 * « Upload YouTube automatique » (21/11/2026, DECISIONS): when on, every recorded game and every saved clip goes up to
 * the player's channel without a click, with the visibility chosen here. A synced UserPreference (key
 * AUTO_YOUTUBE_KEY), read by getUser and written by updateUser({ autoYoutubeUpload }). Off by default.
 */
export const AUTO_YOUTUBE_KEY = 'autoYoutubeUpload'

export type YoutubeVisibility = 'public' | 'unlisted' | 'private'

/**
 * The sound of automatically uploaded videos (21/11/2026, security review: the mic, and the voice chat it picks up,
 * would leave with every game). 'all' = as recorded; 'none' = no audio track. There is no "without the mic only":
 * the mic is mixed into the game's audio track when recording, so it cannot be removed alone.
 */
export type YoutubeAudio = 'all' | 'none'

export interface AutoYoutubePref {
  enabled: boolean
  visibility: YoutubeVisibility
  audio: YoutubeAudio
}

export const DEFAULT_AUTO_YOUTUBE: AutoYoutubePref = { enabled: false, visibility: 'unlisted', audio: 'none' }

/** Stored value (JSON text, object or nothing) → a complete setting; unknown keys and bad values fall back to the default. */
export function normalizeAutoYoutube(raw: unknown): AutoYoutubePref {
  let v: unknown = raw
  if (typeof v === 'string') {
    try { v = JSON.parse(v) } catch { v = null }
  }
  const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
  return {
    enabled: typeof o.enabled === 'boolean' ? o.enabled : DEFAULT_AUTO_YOUTUBE.enabled,
    visibility: o.visibility === 'public' || o.visibility === 'unlisted' || o.visibility === 'private' ? o.visibility : DEFAULT_AUTO_YOUTUBE.visibility,
    audio: o.audio === 'all' || o.audio === 'none' ? o.audio : DEFAULT_AUTO_YOUTUBE.audio,
  }
}
