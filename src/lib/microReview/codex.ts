/**
 * AscendCodex — local knowledge base of tactical prescriptions
 * (docs/PLAN_MICRO_REVIEW.md §C). One entry = one mistake tag in one phase
 * (optionally for one role): a headline, the tactical rule, and a measurable
 * drill for the next session. Team rules written by a coach (Supabase
 * `team_codex_rules`) take precedence over the built-in entries.
 */

import raw from './codex.json'
import { phaseOf, type Phase } from '../mistakeInsights'

export type CodexRole = 'any' | 'TOP' | 'JUNGLE' | 'MIDDLE' | 'BOTTOM' | 'UTILITY'
export type CodexPhase = Phase | 'any'
export interface Localized { fr: string; en: string }

/** A reference segment of an official broadcast ("Voir l'exemple en vidéo"). */
export interface VideoExample {
  title: Localized
  /** Timestamped watch URL of an official LoL Esports VOD (https://www.youtube.com/watch?v=…&t=…s). */
  url: string
  /** Segment played by the embedded player. */
  startSeconds: number
  endSeconds: number
  /** Must be OFFICIAL_SOURCE — see isOfficialVideo. */
  source: string
  coachNote: Localized
}

// ── Video rights rule ────────────────────────────────────────────────────
// Only official LoL Esports broadcasts may ever be shown to users: no third-
// party creator / co-streamer URL, thumbnail, channel name or mention. A
// concept learnt from an external (confidential) analysis stays text-only
// (videoExamples: []). A YouTube URL alone does not tell the channel, so
// video ids are allow-listed after checking they come from the official
// LoL Esports channel.
export const OFFICIAL_SOURCE = 'LoL Esports'
export const OFFICIAL_LOLESPORTS_VIDEO_IDS: ReadonlySet<string> = new Set([
  'GGajtr2XB2Y', // BFX vs G2
])

/** Video id of a plain watch / youtu.be URL; null for clips, shorts, playlists, channels or other hosts. */
export function youtubeVideoId(url: string): string | null {
  let u: URL
  try { u = new URL(url) } catch { return null }
  if (u.protocol !== 'https:') return null
  const host = u.hostname.replace(/^(www|m)\./, '')
  if (host === 'youtube.com' && u.pathname === '/watch') return u.searchParams.get('v')
  if (host === 'youtu.be' && /^\/[\w-]{11}$/.test(u.pathname)) return u.pathname.slice(1)
  return null
}

export function isOfficialVideo(v: Partial<VideoExample> | null | undefined): v is VideoExample {
  if (!v || v.source !== OFFICIAL_SOURCE || typeof v.url !== 'string') return false
  const id = youtubeVideoId(v.url)
  if (!id || !OFFICIAL_LOLESPORTS_VIDEO_IDS.has(id)) return false
  const { startSeconds: s, endSeconds: e } = v
  return Number.isFinite(s) && Number.isFinite(e) && (s as number) >= 0 && (e as number) > (s as number)
}

/** Drops every video that is not an official LoL Esports segment. */
export function sanitizeVideos(list: unknown, entryId = '?'): VideoExample[] {
  if (!Array.isArray(list)) return []
  const ok = list.filter((v) => isOfficialVideo(v as Partial<VideoExample>)) as VideoExample[]
  if (ok.length !== list.length) console.warn(`[codex] ${entryId}: ${list.length - ok.length} non-official video(s) removed`)
  return ok
}

/** Embed URL that plays only the tactical segment. */
export function segmentEmbedUrl(v: VideoExample, autoplay = true): string | null {
  const id = youtubeVideoId(v.url)
  if (!id || !isOfficialVideo(v)) return null
  return `https://www.youtube.com/embed/${id}?start=${Math.floor(v.startSeconds)}&end=${Math.ceil(v.endSeconds)}&rel=0${autoplay ? '&autoplay=1' : ''}`
}

/** Official broadcast thumbnail (only for allow-listed official videos). */
export function officialThumbnail(v: VideoExample): string | null {
  const id = isOfficialVideo(v) ? youtubeVideoId(v.url) : null
  return id ? `https://i.ytimg.com/vi/${id}/mqdefault.jpg` : null
}

export interface CodexEntry {
  id: string
  role: CodexRole
  /** Primary tag (the one the QCM option records). */
  mistakeSlug: string
  /** Other tags this entry also answers (e.g. a tempo rule for both overstay and death-before-objective). */
  mistakeSlugs?: string[]
  phase: CodexPhase
  /** Key of the fundamentals radar axis this rule moves (fundamentalsRadarCore). */
  radarAxis: string
  /** Fundamental to set as the next session's objective. */
  fundamentalId: string
  headline: Localized
  tacticalRule: Localized
  drillObjective: Localized
  videoRef?: string
  videoExamples?: VideoExample[]
  /** Set on coach-written team rules. */
  source?: 'builtin' | 'team'
  groupId?: string
}

export const CODEX: CodexEntry[] = (raw as unknown as CodexEntry[]).map((e) => ({ ...e, source: 'builtin' as const, videoExamples: sanitizeVideos(e.videoExamples, e.id) }))

export function normalizeRole(role: string | null | undefined): CodexRole {
  const r = (role ?? '').toUpperCase()
  if (r === 'SUPPORT' || r === 'UTILITY') return 'UTILITY'
  if (r === 'MID' || r === 'MIDDLE') return 'MIDDLE'
  if (r === 'ADC' || r === 'BOT' || r === 'BOTTOM') return 'BOTTOM'
  if (r === 'TOP' || r === 'JUNGLE') return r
  return 'any'
}

/**
 * Best entry for a mistake: team rules first, then (role, phase) →
 * (any, phase) → (role, any phase) → (any, any phase) → same tag in another
 * phase. Null when the tag has no entry for this role.
 */
export function codexFor(
  slug: string,
  role: string | null | undefined,
  phase: Phase | null,
  teamRules: CodexEntry[] = [],
): CodexEntry | null {
  const r = normalizeRole(role)
  const pool = [...teamRules.map((e) => ({ ...e, source: 'team' as const })), ...CODEX].filter((e) => e.mistakeSlug === slug || e.mistakeSlugs?.includes(slug))
  if (pool.length === 0) return null
  const rank = (e: CodexEntry) => {
    const roleScore = e.role === r && r !== 'any' ? 0 : e.role === 'any' ? 1 : 9
    const phaseScore = phase && e.phase === phase ? 0 : e.phase === 'any' ? 1 : 2
    const teamScore = e.source === 'team' ? 0 : 1
    // The entry written for this exact tag beats one that only lists it as a secondary tag.
    const slugScore = e.mistakeSlug === slug ? 0 : 1
    // On a tie, the entry with coach-analysed reference clips wins.
    const videoScore = e.videoExamples?.length ? 0 : 0.5
    return teamScore * 100 + phaseScore * 10 + roleScore + slugScore + videoScore
  }
  const eligible = pool.filter((e) => e.role === 'any' || e.role === r)
  // A rule written for another role would be wrong advice: nothing beats that.
  return eligible.sort((a, b) => rank(a) - rank(b))[0] ?? null
}

export const codexById = (id: string): CodexEntry | null => CODEX.find((e) => e.id === id) ?? null

/** Phase in which a set of occurrence times concentrates (ties → earliest). */
export function dominantPhase(gameTimesSec: number[]): Phase | null {
  if (gameTimesSec.length === 0) return null
  const n: Record<Phase, number> = { early: 0, mid: 0, late: 0 }
  for (const t of gameTimesSec) n[phaseOf(t)]++
  return (['early', 'mid', 'late'] as Phase[]).reduce((a, b) => (n[b] > n[a] ? b : a), 'early')
}

export const localize = (l: Localized, lang: string): string => (lang.startsWith('en') ? l.en : l.fr) || l.fr || l.en

/** "Préparer ma prochaine session" payload: objective + drill as the session note. */
export function sessionPrefill(entry: CodexEntry, lang: string): { objectiveIds: string[]; customNote: string; codexId: string } {
  return { objectiveIds: [entry.fundamentalId], customNote: localize(entry.drillObjective, lang), codexId: entry.id }
}
