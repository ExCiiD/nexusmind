/**
 * Sessions started by Ascend itself (DECISIONS 27/11/2026): when a game begins with no active session, one is created
 * with no objective. These pure rules decide when it is closed, when it is thrown away, and when the "add an
 * objective" bubble shows. Nothing here touches the database or Electron.
 */

/** No new game this long after the last one ended (or after the session started): the player stopped playing. */
export const AUTO_SESSION_IDLE_MINUTES = 45
/**
 * An auto session that never got a game is only thrown away after this long. A game played while the app was closed is
 * imported a few minutes after the next start (catch-up), and must still find its session there.
 */
export const EMPTY_AUTO_SESSION_GRACE_MINUTES = 180

const MIN = 60_000

function jsonList(raw: string | null | undefined): unknown[] {
  if (!raw) return []
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

export interface SessionObjectiveFields {
  objectiveId?: string | null
  objectiveIds?: string | null
  customObjectives?: string | null
  selectedKpiIds?: string | null
}

/** True when the session has at least a fundamental, a written objective or a KPI. */
export function hasObjectiveOrKpi(s: SessionObjectiveFields): boolean {
  return (
    (typeof s.objectiveId === 'string' && s.objectiveId.length > 0) ||
    jsonList(s.objectiveIds).length > 0 ||
    jsonList(s.customObjectives).length > 0 ||
    jsonList(s.selectedKpiIds).length > 0
  )
}

/** The bubble "add an objective": an active session with neither objective nor KPI, not dismissed. */
export function needsObjectivePrompt(s: SessionObjectiveFields & { status: string; objectivePromptDismissed?: boolean | null }): boolean {
  return s.status === 'active' && !s.objectivePromptDismissed && !hasObjectiveOrKpi(s)
}

export interface AutoCloseInfo {
  autoStarted: boolean
  /** Session start, epoch ms. */
  date: number
  /** End of the most recent game, epoch ms; null when none. */
  lastGameEndAt: number | null
  gamesPlayed: number
  hasObjectiveOrKpi: boolean
}

export type AutoCloseAction = 'keep' | 'close' | 'delete'

/**
 * What the periodic check does with an active session.
 * - A game is running: nothing (a long game must not close the session it will be written to).
 * - Games played: closed once the last one ended `idleMinutes` ago. After an app restart this still reads the end of
 *   the last game, not the time the app opened.
 * - No game, started by Ascend: thrown away after the grace period when it holds nothing the player wrote, closed
 *   otherwise (never delete an objective the player took the time to write).
 * - No game, started by the player: closed after the idle time, as before.
 */
export function autoCloseAction(info: AutoCloseInfo, now: number, gameRunning: boolean, idleMinutes = AUTO_SESSION_IDLE_MINUTES): AutoCloseAction {
  if (gameRunning) return 'keep'
  if (info.gamesPlayed === 0 && info.lastGameEndAt == null && info.autoStarted) {
    if (now - info.date < EMPTY_AUTO_SESSION_GRACE_MINUTES * MIN) return 'keep'
    return info.hasObjectiveOrKpi ? 'close' : 'delete'
  }
  const lastActivity = info.lastGameEndAt ?? info.date
  return now - lastActivity >= idleMinutes * MIN ? 'close' : 'keep'
}
