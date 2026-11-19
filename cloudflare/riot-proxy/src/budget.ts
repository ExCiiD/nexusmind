/**
 * P1-2 (docs/PLAN_CLE_PROD.md): one budget for the whole Riot key, shared by every user and device, so the
 * proxy answers 429 itself before Riot does (a key that keeps hitting Riot's 429 risks a blacklist).
 *
 * Pure (no Workers APIs): sliding windows that mirror Riot's application limits for one routing value (Riot
 * counts each platform or regional host separately), and a reserve kept for interactive calls. A background
 * call (scout, synergy) may only use `limit × (1 − reserve)` of each window, so the end of a game or an open
 * screen always finds room. After Riot itself answered 429, everything waits for its Retry-After.
 *
 * CyberSecurity (19/11/2026): one account may use at most `userShare` of each window (25 % by default), so a
 * single user, or a stolen token, cannot empty the key for everyone.
 */

export type Priority = 'interactive' | 'background'

export interface RateWindow {
  /** Calls allowed in the window. */
  limit: number
  seconds: number
}

/** Riot's development-key limits, a little under them (other tools may share the key). */
export const DEFAULT_WINDOWS: RateWindow[] = [{ limit: 18, seconds: 1 }, { limit: 95, seconds: 120 }]
export const DEFAULT_RESERVE = 0.3
export const DEFAULT_USER_SHARE = 0.25
/**
 * #46 point 2 (20/11/2026): part of each player's own share kept for their interactive calls. Without it, a player
 * whose background reads (weekly awards, scouts) had used their share made an open screen wait up to a minute.
 */
export const DEFAULT_USER_INTERACTIVE_RESERVE = 0.2

/** USER_INTERACTIVE_RESERVE as a ratio in [0, 0.9]. */
export function parseUserInteractiveReserve(raw: string | undefined | null): number {
  const n = Number(raw)
  return raw != null && raw !== '' && Number.isFinite(n) && n >= 0 && n <= 0.9 ? n : DEFAULT_USER_INTERACTIVE_RESERVE
}

/** "18:1,95:120" (calls:seconds, comma separated), as in RIOT_APP_LIMITS. Falls back to the default on bad input. */
export function parseWindows(raw: string | undefined | null): RateWindow[] {
  if (!raw) return DEFAULT_WINDOWS
  const out: RateWindow[] = []
  for (const part of raw.split(',')) {
    const m = /^\s*(\d+)\s*:\s*(\d+)\s*$/.exec(part)
    if (!m) return DEFAULT_WINDOWS
    const limit = Number(m[1])
    const seconds = Number(m[2])
    if (limit < 1 || seconds < 1 || seconds > 3600) return DEFAULT_WINDOWS
    out.push({ limit, seconds })
  }
  return out.length > 0 ? out : DEFAULT_WINDOWS
}

/** INTERACTIVE_RESERVE as a ratio in [0, 0.9]. */
export function parseReserve(raw: string | undefined | null): number {
  const n = Number(raw)
  return raw != null && raw !== '' && Number.isFinite(n) && n >= 0 && n <= 0.9 ? n : DEFAULT_RESERVE
}

/** USER_WINDOW_SHARE as a ratio in (0, 1]. */
export function parseUserShare(raw: string | undefined | null): number {
  const n = Number(raw)
  return raw != null && raw !== '' && Number.isFinite(n) && n > 0 && n <= 1 ? n : DEFAULT_USER_SHARE
}

export type AcquireResult = { ok: true } | { ok: false; retryAfterMs: number; reason: 'window' | 'user_share' | 'riot_backoff' }

export class RiotBudget {
  /** Timestamps (ms) of the calls let through, oldest first, one list per window. */
  private readonly hits: number[][]
  /** The same, per user (their share of each window). Users with nothing left in any window are dropped. */
  private readonly userHits = new Map<string, number[][]>()
  private blockedUntil = 0

  constructor(
    private readonly windows: RateWindow[] = DEFAULT_WINDOWS,
    private readonly reserve: number = DEFAULT_RESERVE,
    private readonly userShare: number = DEFAULT_USER_SHARE,
    private readonly userInteractiveReserve: number = DEFAULT_USER_INTERACTIVE_RESERVE,
  ) {
    this.hits = windows.map(() => [])
  }

  /**
   * The calls one user may make in a window: at least one. A background call may only use the share less its
   * interactive reserve, and always leaves at least one of the user's slots to their interactive calls (when the
   * share has two slots or more).
   */
  userCapFor(w: RateWindow, priority: Priority = 'interactive'): number {
    const share = Math.max(1, Math.floor(w.limit * this.userShare))
    if (priority === 'interactive' || share < 2) return share
    return Math.max(1, Math.min(share - 1, Math.floor(share * (1 - this.userInteractiveReserve))))
  }

  /** The calls a priority may use in a window. A background call always keeps at least one slot free for interactive ones. */
  capFor(w: RateWindow, priority: Priority): number {
    if (priority === 'interactive') return w.limit
    return Math.max(0, Math.min(w.limit - 1, Math.floor(w.limit * (1 - this.reserve))))
  }

  tryAcquire(priority: Priority, now: number, user?: string): AcquireResult {
    if (now < this.blockedUntil) return { ok: false, retryAfterMs: this.blockedUntil - now, reason: 'riot_backoff' }
    // The user's own share first: a user over it waits for their own calls to age, whatever the others do.
    const mine = user ? this.userLists(user, now) : null
    if (mine) {
      const userWait = this.waitFor(mine, (w) => this.userCapFor(w, priority), now)
      if (userWait > 0) return { ok: false, retryAfterMs: userWait, reason: 'user_share' }
    }
    this.windows.forEach((_, i) => this.prune(i, now))
    const wait = this.waitFor(this.hits, (w) => this.capFor(w, priority), now)
    if (wait > 0) return { ok: false, retryAfterMs: wait, reason: 'window' }
    for (const list of this.hits) list.push(now)
    if (mine) for (const list of mine) list.push(now)
    return { ok: true }
  }

  /** How long until every window has room under its cap (0 = now). */
  private waitFor(lists: number[][], capOf: (w: RateWindow) => number, now: number): number {
    let wait = 0
    this.windows.forEach((w, i) => {
      const list = lists[i]
      const cap = capOf(w)
      if (list.length >= cap) {
        // The (length − cap + 1)-th oldest call has to leave the window first.
        const freeAt = cap === 0 ? now + w.seconds * 1000 : list[list.length - cap] + w.seconds * 1000
        wait = Math.max(wait, freeAt - now)
      }
    })
    return wait > 0 ? Math.max(1, wait) : 0
  }

  /** This user's lists, pruned. Forgets the users whose calls have all left their windows. */
  private userLists(user: string, now: number): number[][] {
    for (const [key, lists] of this.userHits) {
      this.windows.forEach((w, i) => {
        const from = now - w.seconds * 1000
        while (lists[i].length > 0 && lists[i][0] <= from) lists[i].shift()
      })
      if (key !== user && lists.every((l) => l.length === 0)) this.userHits.delete(key)
    }
    let mine = this.userHits.get(user)
    if (!mine) {
      mine = this.windows.map(() => [])
      this.userHits.set(user, mine)
    }
    return mine
  }

  /** Users with calls still counted (for the tests and the metrics). */
  trackedUsers(): number {
    return this.userHits.size
  }

  /** Riot answered 429 anyway: nothing goes through until its Retry-After has passed. */
  penalize(retryAfterSec: number, now: number): void {
    const sec = Number.isFinite(retryAfterSec) && retryAfterSec > 0 ? Math.min(retryAfterSec, 3600) : 10
    this.blockedUntil = Math.max(this.blockedUntil, now + sec * 1000)
  }

  /** Calls counted in each window right now (for the metrics). */
  usage(now: number): Array<{ limit: number; seconds: number; used: number }> {
    return this.windows.map((w, i) => ({ ...w, used: this.prune(i, now).length }))
  }

  private prune(i: number, now: number): number[] {
    const list = this.hits[i]
    const from = now - this.windows[i].seconds * 1000
    let drop = 0
    while (drop < list.length && list[drop] <= from) drop++
    if (drop > 0) list.splice(0, drop)
    return list
  }
}
