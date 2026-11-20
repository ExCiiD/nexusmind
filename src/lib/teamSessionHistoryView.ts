/**
 * Team sessions history (docs/DESIGN_STATE.md § 15): pure helpers of the two screens — rows grouped by week, the
 * played time, the game picked in the session page (`?game=2`), and the text of « Exporter le résumé ». Tested.
 */
import type { HistoryGame, TeamSessionHistoryDetail, TeamSessionHistoryRow, TeamTotals } from './teamSessionHistory'
import type { SynergyPlayerStats } from './ipc'
import type { DuelRow } from './teamSessionStatsCore'

const DAY = 86_400_000

/** Monday 00:00 (local time) of the week of `d`. */
export function weekStart(d: Date): Date {
  const s = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  s.setDate(s.getDate() - ((s.getDay() + 6) % 7))
  return s
}

export interface WeekGroup<R> {
  start: Date
  /** Sunday of that week. */
  end: Date
  /** 0 this week, 1 last week, … */
  weeksAgo: number
  rows: R[]
}

/** The rows (newest first) by week, newest week first. */
export function groupByWeek<R extends Pick<TeamSessionHistoryRow, 'startsAt'>>(rows: readonly R[], now: Date): WeekGroup<R>[] {
  const thisWeek = weekStart(now).getTime()
  const groups: WeekGroup<R>[] = []
  for (const row of rows) {
    const start = weekStart(new Date(row.startsAt))
    let g = groups.find((x) => x.start.getTime() === start.getTime())
    if (!g) {
      g = { start, end: new Date(start.getTime() + 6 * DAY), weeksAgo: Math.round((thisWeek - start.getTime()) / (7 * DAY)), rows: [] }
      groups.push(g)
    }
    g.rows.push(row)
  }
  return groups.sort((a, b) => b.start.getTime() - a.start.getTime())
}

/** « 1 h 34 », « 48 min », null for nothing played. */
export function formatPlayed(sec: number): string | null {
  if (!(sec > 0)) return null
  const min = Math.round(sec / 60)
  if (min < 60) return `${min} min`
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`
}

/** « 32:14 » for a game's duration. */
export function formatClock(sec: number | null): string | null {
  if (sec == null || !(sec > 0)) return null
  const s = Math.round(sec)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** `?game=2` → 2; anything else (absent, 0, not a game of the session) → null, the whole session. */
export function parseGameParam(raw: string | null, games: ReadonlyArray<Pick<HistoryGame, 'index'>>): number | null {
  const n = raw ? Number(raw) : NaN
  return Number.isInteger(n) && games.some((g) => g.index === n) ? n : null
}

export interface HistorySelection {
  /** The picked game, null for the whole session. */
  game: HistoryGame | null
  team: TeamTotals | null
  players: SynergyPlayerStats[]
  enemyPlayers: SynergyPlayerStats[]
  duels: DuelRow[]
  /** Games behind the numbers (1 for a game with its stats, 0 without). */
  counted: number
}

/** What the stats blocks show for the picked game, or the whole session. */
export function selectGame(detail: Pick<TeamSessionHistoryDetail, 'games' | 'whole'>, index: number | null): HistorySelection {
  if (index != null) {
    const game = detail.games.find((g) => g.index === index) ?? null
    const ready = game?.stats === 'ready'
    return {
      game,
      team: ready ? game!.team : null,
      players: ready ? game!.players : [],
      enemyPlayers: ready ? game!.enemyPlayers : [],
      duels: ready ? game!.duels : [],
      counted: ready ? 1 : 0,
    }
  }
  const w = detail.whole
  return { game: null, team: w?.team ?? null, players: w?.players ?? [], enemyPlayers: w?.enemyPlayers ?? [], duels: w?.duels ?? [], counted: w?.gamesCounted ?? 0 }
}

/** Notes and reviews: the picked game's first, then the session's, then the other games'. */
export function orderForGame<T extends { gameId: string | null }>(items: readonly T[], gameId: string | null): T[] {
  const rank = (x: T) => (gameId && x.gameId === gameId ? 0 : x.gameId == null ? 1 : 2)
  return [...items].sort((a, b) => rank(a) - rank(b))
}

/** Lines of « Exporter le résumé » (plain text, like the weekly report). The labels come from the screen. */
export function summaryLines(
  detail: Pick<TeamSessionHistoryDetail, 'header' | 'games' | 'whole' | 'objectives'>,
  label: {
    date: string
    kind: string
    game: (g: HistoryGame) => string
    objective: (id: string) => string
    held: (held: boolean | null) => string
    team: string
  },
): string[] {
  const h = detail.header
  const lines = [`${h.title} — ${label.kind}${h.format ? ` · ${h.format.toUpperCase()}` : ''}`, label.date, `${h.wins} – ${h.losses}`]
  if (detail.games.length) lines.push('', ...detail.games.map(label.game))
  const team = detail.whole?.team
  if (team) {
    lines.push('', `${label.team}: ${team.our.kills}/${team.our.deaths}/${team.our.assists} vs ${team.enemy.kills}/${team.enemy.deaths}/${team.enemy.assists}`
      + (team.goldDiffAt15 != null ? ` · Gold @15 ${team.goldDiffAt15 > 0 ? '+' : ''}${Math.round(team.goldDiffAt15)}` : ''))
  }
  if (detail.objectives.length) lines.push('', ...detail.objectives.map((o) => `- ${label.objective(o.objectiveId)} : ${label.held(o.held)}`))
  return lines
}

/* ─── Meetings (§ 15.2 bis): the transcript ─── */

/** One block of a transcript: its time in the recording when the line starts with « [12:40] », and its text. */
export interface TranscriptBlock { atSec: number | null; text: string }

const STAMP = /^\s*\[?(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\]?\s+(.*)$/

/** The transcript by line; a leading « [mm:ss] » or « [h:mm:ss] » becomes the block's time (blank lines dropped). */
export function parseTranscript(text: string | null): TranscriptBlock[] {
  return (text ?? '').split(/\r?\n/).map((line) => {
    const m = STAMP.exec(line)
    if (m) return { atSec: Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]), text: m[4].trim() }
    return { atSec: null, text: line.trim() }
  }).filter((b) => b.text)
}

/** « 12:40 », « 1:02:05 ». */
export function stampOf(sec: number): string {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60)
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
}

/** Case and accents folded, one character for one (positions stay valid in the original text). */
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, (_m) => '').toLowerCase()
const foldKeep = (s: string) => Array.from(s).map((c) => fold(c) || c).join('')

/** Every occurrence of `query` in the blocks, in reading order: block index, start, end (in the block's text). */
export function searchTranscript(blocks: readonly TranscriptBlock[], query: string): Array<{ block: number; start: number; end: number }> {
  const q = foldKeep(query.trim())
  if (!q) return []
  const out: Array<{ block: number; start: number; end: number }> = []
  blocks.forEach((b, block) => {
    const hay = foldKeep(b.text)
    for (let i = hay.indexOf(q); i >= 0; i = hay.indexOf(q, i + q.length)) out.push({ block, start: i, end: i + q.length })
  })
  return out
}
