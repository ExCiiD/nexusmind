/**
 * Low-energy / tilt detector (docs/PLAN_MICRO_REVIEW.md, V4 §3).
 *
 * Application-level, no timeline: it reads the same numbers as the Stats →
 * Analyse panels "Selon l'heure" (winrateByDaypart) and "Gestion du tilt"
 * (same-sitting rule), so the prompt can never contradict what those panels
 * show. Deterministic, pure, no I/O.
 *
 * The signal is raised:
 *   - after 2 consecutive losses in the running session (or, before a session
 *     is launched, 2 back-to-back losses of the same sitting that just ended);
 *   - when the current time falls in a daypart where the player's historical
 *     win rate is under 45 % (with enough games to mean something).
 * The answer is always the same 1-click action: make the "Protocole basse
 * énergie" (AscendCodex) the session objective.
 */

import { MIN_SAMPLE, SAME_SESSION_MS, daypartOf, winrateByDaypart, type Daypart, type InsightGame } from '../statsInsights'
import { codexById, localize, type CodexEntry } from './codex'
import { CODEX_LOW_ENERGY } from './smartQcm'

export const LOW_ENERGY_CODEX_ID = CODEX_LOW_ENERGY
/** Win rate (percent) under which a daypart is a low-energy slot. */
export const LOW_ENERGY_WINRATE = 45
/** Consecutive losses that raise the signal. */
export const LOW_ENERGY_LOSS_STREAK = 2

export type LowEnergyReason = 'loss-streak' | 'bad-hour' | 'late-night'

export interface DaypartRisk { key: Daypart; games: number; winrate: number }

/**
 * Strictly under 45 %, on the exact ratio: 13 wins in 29 games (44.8 %) is a
 * low-energy slot although the panel rounds it to "45 %".
 */
export const underLowEnergyWinrate = (wins: number, games: number): boolean => games > 0 && wins * 100 < LOW_ENERGY_WINRATE * games
/** The win rate to show for a slot: never rounded up to the threshold it is under. */
const shownWinrate = (b: { wins: number; games: number; winrate: number }): number =>
  underLowEnergyWinrate(b.wins, b.games) ? Math.min(b.winrate, LOW_ENERGY_WINRATE - 1) : b.winrate

/** Dayparts with enough games (same MIN_SAMPLE as the panel) and a win rate strictly under 45 %. */
export function riskyDayparts(history: InsightGame[]): DaypartRisk[] {
  return winrateByDaypart(history)
    .filter((b) => b.enough && underLowEnergyWinrate(b.wins, b.games))
    .map((b) => ({ key: b.key as Daypart, games: b.games, winrate: shownWinrate(b) }))
}

/** Consecutive losses at the end of a list of results in play order (true = win). */
export function trailingLosses(results: boolean[]): number {
  let n = 0
  for (let i = results.length - 1; i >= 0 && !results[i]; i--) n++
  return n
}

/**
 * Losses in a row at the end of the history, counting only back-to-back games
 * of the same sitting (same rule as the "Gestion du tilt" panel), and only
 * while that sitting is still warm: the last game ended less than
 * SAME_SESSION_MS before `now`.
 */
export function sittingLossStreak(history: InsightGame[], now: Date): number {
  const chrono = [...history].sort((a, b) => new Date(a.gameEndAt).getTime() - new Date(b.gameEndAt).getTime())
  const last = chrono[chrono.length - 1]
  if (!last) return 0
  const sinceLast = now.getTime() - new Date(last.gameEndAt).getTime()
  if (sinceLast < 0 || sinceLast > SAME_SESSION_MS) return 0
  let n = 0
  for (let i = chrono.length - 1; i >= 0; i--) {
    const g = chrono[i]
    if (g.win) break
    n++
    const prev = chrono[i - 1]
    if (!prev) break
    // gameEndAt → gameEndAt includes the later game's own length.
    const gap = new Date(g.gameEndAt).getTime() - new Date(prev.gameEndAt).getTime()
    if (gap > SAME_SESSION_MS + g.duration * 1000) break
  }
  return n
}

export interface LowEnergyInput {
  now: Date
  /** Recent ranked games (the Stats → Analyse sample), any order. */
  history: InsightGame[]
  /** Results of the running session in play order (true = win); null when no session is running. */
  sessionResults: boolean[] | null
}

export interface LowEnergySignal {
  active: boolean
  /** 'loss-streak' and/or 'bad-hour' (never 'late-night': that one only qualifies a past game). */
  reasons: LowEnergyReason[]
  lossStreak: number
  daypart: Daypart
  /** Win rate (percent) of the current daypart, null without enough games. */
  daypartWinrate: number | null
  daypartGames: number
}

export function lowEnergySignal({ now, history, sessionResults }: LowEnergyInput): LowEnergySignal {
  const inSession = !!sessionResults && sessionResults.length > 0
  const lossStreak = inSession ? trailingLosses(sessionResults!) : sittingLossStreak(history, now)
  const daypart = daypartOf(now)
  const bucket = winrateByDaypart(history).find((b) => b.key === daypart)
  const enough = !!bucket && bucket.games >= MIN_SAMPLE
  const reasons: LowEnergyReason[] = []
  if (lossStreak >= LOW_ENERGY_LOSS_STREAK) reasons.push('loss-streak')
  if (enough && underLowEnergyWinrate(bucket!.wins, bucket!.games)) reasons.push('bad-hour')
  return {
    active: reasons.length > 0,
    reasons,
    lossStreak,
    daypart,
    daypartWinrate: enough ? shownWinrate(bucket!) : null,
    daypartGames: bucket?.games ?? 0,
  }
}

export interface GameLowEnergy { active: boolean; reasons: LowEnergyReason[] }

/**
 * Was this (finished) game played in low-energy conditions? Used by the
 * micro-review to offer the protocol as a diagnosis: the game came right
 * after 2+ losses of its session, it ended at night (0 h–6 h), or it was
 * played in a daypart where the player wins under 45 %.
 * `history`: the player's other recent games (the game itself excluded).
 */
export function gameLowEnergy({ gameEndAt, resultsBefore, history }: { gameEndAt: string | Date; resultsBefore: boolean[]; history: InsightGame[] }): GameLowEnergy {
  const at = typeof gameEndAt === 'string' ? new Date(gameEndAt) : gameEndAt
  const daypart = daypartOf(at)
  const reasons: LowEnergyReason[] = []
  if (trailingLosses(resultsBefore) >= LOW_ENERGY_LOSS_STREAK) reasons.push('loss-streak')
  if (daypart === 'night') reasons.push('late-night')
  if (riskyDayparts(history).some((r) => r.key === daypart)) reasons.push('bad-hour')
  return { active: reasons.length > 0, reasons }
}

export interface LowEnergyActivation {
  objectiveIds: string[]
  selectedKpiIds: string[]
  customNote: string
  codexId: string
}

/** The session note that marks the protocol as active (also how the UI recognises it). */
export function protocolNote(entry: CodexEntry, name: string, lang: string): string {
  return `${name} — ${localize(entry.drillObjective, lang)}`
}

/**
 * What "activate the protocol as the session objective" writes. On a running
 * session the protocol's fundamental goes first and the existing objectives
 * are kept (3 max); explicit KPI selections get the protocol's KPIs added so
 * they show up in the review form (an empty selection already means "all").
 */
export function lowEnergyActivation(opts: {
  name: string
  lang: string
  protocolKpiIds: string[]
  current?: { objectiveIds: string[]; selectedKpiIds: string[]; customNote?: string | null } | null
}): LowEnergyActivation | null {
  const entry = codexById(LOW_ENERGY_CODEX_ID)
  if (!entry) return null
  const note = protocolNote(entry, opts.name, opts.lang)
  const cur = opts.current
  const objectiveIds = [entry.fundamentalId, ...(cur?.objectiveIds ?? []).filter((o) => o !== entry.fundamentalId)].slice(0, 3)
  const kept = cur?.selectedKpiIds ?? []
  const selectedKpiIds = kept.length ? [...new Set([...kept, ...opts.protocolKpiIds])] : []
  // The player's own note is kept: under the protocol line, or untouched when that line is already in it.
  const previous = (cur?.customNote ?? '').trim()
  const customNote = !previous ? note : previous.includes(opts.name) ? previous : `${note}\n${previous}`
  return { objectiveIds, selectedKpiIds, customNote, codexId: entry.id }
}

/** The protocol is already the running session's objective. */
export function protocolActive(session: { objectiveIds: string[]; customNote?: string | null } | null | undefined, name: string): boolean {
  const entry = codexById(LOW_ENERGY_CODEX_ID)
  return !!session && !!entry && session.objectiveIds[0] === entry.fundamentalId && (session.customNote ?? '').includes(name)
}
