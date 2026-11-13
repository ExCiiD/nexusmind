/**
 * S3 — a session with no game for 45 minutes closes itself, with a short
 * pre-filled conclusion (games played, record). The player can still open
 * it from History and edit the conclusion; nothing here blocks that.
 */

import { getPrisma } from './database'
import { endSessionCore } from './ipc/session.ipc'

export const IDLE_MINUTES = 45
const IDLE_MS = IDLE_MINUTES * 60_000
/** How often the background check runs. */
const CHECK_INTERVAL_MS = 5 * 60_000

export interface IdleSessionInfo {
  /** Session start, epoch ms. */
  date: number
  /** Most recent game's end, epoch ms; null when no game was played. */
  lastGameEndAt: number | null
  gamesPlayed: number
  wins: number
}

/** Pure: true once `idleMinutes` have passed since the session's last activity. */
export function isIdleEnough(info: Pick<IdleSessionInfo, 'date' | 'lastGameEndAt'>, now: number, idleMinutes = IDLE_MINUTES): boolean {
  const lastActivity = info.lastGameEndAt ?? info.date
  return now - lastActivity >= idleMinutes * 60_000
}

/** Pure: the short, clearly system-written conclusion stored on auto-close. */
export function buildAutoConclusion(info: Pick<IdleSessionInfo, 'gamesPlayed' | 'wins'>): string {
  if (info.gamesPlayed === 0) {
    return `Session closed automatically after ${IDLE_MINUTES} minutes with no game played.`
  }
  const losses = info.gamesPlayed - info.wins
  return `Session closed automatically after ${IDLE_MINUTES} minutes of inactivity — ${info.gamesPlayed} game(s) (${info.wins}W-${losses}L).`
}

/** Closes every active session idle for ≥ 45 minutes. Returns how many it closed. */
export async function autoCloseIdleSessions(now = Date.now()): Promise<number> {
  const prisma = getPrisma()
  const sessions = await prisma.session.findMany({
    where: { status: 'active' },
    select: { id: true, date: true, games: { select: { gameEndAt: true, win: true } } },
  })

  let closed = 0
  for (const s of sessions) {
    const gameEnds = s.games.map((g) => new Date(g.gameEndAt).getTime())
    const info: IdleSessionInfo = {
      date: s.date.getTime(),
      lastGameEndAt: gameEnds.length ? Math.max(...gameEnds) : null,
      gamesPlayed: s.games.length,
      wins: s.games.filter((g) => g.win).length,
    }
    if (!isIdleEnough(info, now)) continue
    try {
      await endSessionCore(s.id, undefined, buildAutoConclusion(info))
      closed++
    } catch (err) {
      console.warn('[session] auto-close failed for', s.id, (err as Error)?.message ?? err)
    }
  }
  return closed
}

/** Runs at startup and then every 5 minutes for the lifetime of the app. */
export function startSessionAutoClose(): void {
  const tick = () => {
    autoCloseIdleSessions().then((closed) => {
      if (closed > 0) console.log(`[session] auto-closed ${closed} idle session(s)`)
    }).catch((err) => console.warn('[session] auto-close tick failed:', (err as Error)?.message ?? err))
  }
  setTimeout(tick, 60_000)
  setInterval(tick, CHECK_INTERVAL_MS)
}
