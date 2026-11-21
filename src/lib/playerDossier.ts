/**
 * Coaching → Players ("dossier joueur", redesign 17/11/2026). Pure helpers
 * over the sessions a player shares with their staff.
 */
import type { PlayerSessionView } from './collab'
import { parseObjectives, type CustomObjective } from './customObjectives'

const ts = (v: number | string | null) => (v == null ? 0 : typeof v === 'number' ? v : Date.parse(v))
const dayKey = (v: number | string | null) => {
  const d = new Date(ts(v))
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export interface ReviewStats { games: number; reviewed: number; pct: number }

export function reviewStats(sessions: PlayerSessionView[]): ReviewStats {
  const games = sessions.flatMap((s) => s.games)
  const reviewed = games.filter((g) => g.review).length
  return { games: games.length, reviewed, pct: games.length ? Math.round((reviewed / games.length) * 100) : 0 }
}

/** Most frequent role across the shared games (null when none is known). */
export function mainRole(sessions: PlayerSessionView[]): string | null {
  const counts = new Map<string, number>()
  for (const g of sessions.flatMap((s) => s.games)) if (g.role) counts.set(g.role, (counts.get(g.role) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
}

export function topChampions(sessions: PlayerSessionView[], n = 3): string[] {
  const counts = new Map<string, number>()
  for (const g of sessions.flatMap((s) => s.games)) counts.set(g.champion, (counts.get(g.champion) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([c]) => c)
}

export type DayStatus = 'alert' | 'partial' | 'complete'
export interface SessionDay {
  key: string
  date: number
  sessions: PlayerSessionView[]
  objectiveIds: string[]
  /** 20/11: the written objectives of the day's sessions (a session may have no fundamental). */
  customObjectives: CustomObjective[]
  games: number
  reviews: number
  status: DayStatus
}

/** A marathon day with no review at all is the pattern coaches look for. */
export const ALERT_MIN_GAMES = 5

export function groupByDay(sessions: PlayerSessionView[]): SessionDay[] {
  const map = new Map<string, PlayerSessionView[]>()
  for (const s of sessions) {
    const k = dayKey(s.date)
    map.set(k, [...(map.get(k) ?? []), s])
  }
  return [...map.entries()]
    .map(([key, list]) => {
      const games = list.reduce((n, s) => n + s.games.length, 0)
      const reviews = list.reduce((n, s) => n + s.games.filter((g) => g.review).length, 0)
      const status: DayStatus = games >= ALERT_MIN_GAMES && reviews === 0 ? 'alert' : reviews >= games ? 'complete' : 'partial'
      const customObjectives = list.flatMap((s) => parseObjectives((s as { customObjectives?: unknown }).customObjectives))
      return { key, date: Math.max(...list.map((s) => ts(s.date))), sessions: list, objectiveIds: [...new Set(list.flatMap((s) => s.objectiveIds))], customObjectives, games, reviews, status }
    })
    .sort((a, b) => b.date - a.date)
}

export interface PlayerStatus { tone: 'warn' | 'good' | 'neutral'; key: 'alert' | 'discipline' | 'noData'; date?: number; games?: number; pct?: number }

/** Header status line: the latest no-review marathon in the last 14 days
 *  wins; otherwise the review discipline. */
export function playerStatus(days: SessionDay[], stats: ReviewStats, now = Date.now()): PlayerStatus {
  if (stats.games === 0) return { tone: 'neutral', key: 'noData' }
  const alert = days.find((d) => d.status === 'alert' && now - d.date <= 14 * 86_400_000)
  if (alert) return { tone: 'warn', key: 'alert', date: alert.date, games: alert.games }
  return { tone: stats.pct >= 60 ? 'good' : 'neutral', key: 'discipline', pct: stats.pct }
}

/* ─── Staff note tags ─── */

export const NOTE_TAGS = ['followup', 'tilt', 'draft', 'mental'] as const
export type NoteTag = (typeof NOTE_TAGS)[number]
const TAG_RE = /^\[(followup|tilt|draft|mental)\]\s*/

/** Tags are stored as a "[tag] " prefix in the note body (no schema change). */
export function parseNote(body: string): { tag: NoteTag | null; text: string } {
  const m = body.match(TAG_RE)
  return m ? { tag: m[1] as NoteTag, text: body.slice(m[0].length) } : { tag: null, text: body }
}
export function composeNote(tag: NoteTag | null, text: string): string {
  return tag ? `[${tag}] ${text}` : text
}
