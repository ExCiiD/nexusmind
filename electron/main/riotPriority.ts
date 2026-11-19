import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * P1-3 (docs/PLAN_CLE_PROD.md): how urgent a Riot call is, carried through every await of the work that made
 * it, so the call sites keep their shape.
 *
 *   gameEnd      the game that just ended (enrichment, timeline, post-game analysis): always first
 *   interactive  what an open screen waits for (the default)
 *   background   scouts, synergy, weekly awards, Riot ID refreshes: whatever is left
 *
 * The app's limiter serves them in that order (riotClient.ts), and through the proxy a background call is sent
 * with `x-nxm-priority: background`, so the shared budget keeps its reserve for interactive calls (P1-2).
 */
export type RiotPriority = 'gameEnd' | 'interactive' | 'background'

export const PRIORITY_RANK: Record<RiotPriority, number> = { gameEnd: 0, interactive: 1, background: 2 }

const current = new AsyncLocalStorage<RiotPriority>()

/** Runs `fn`, and every Riot call it makes, at this priority. */
export function withRiotPriority<T>(priority: RiotPriority, fn: () => T): T {
  return current.run(priority, fn)
}

export function currentRiotPriority(): RiotPriority {
  return current.getStore() ?? 'interactive'
}

/** An IPC handler whose Riot calls all run in the background (scouts, synergy). Same shape as the handler. */
export function inBackground<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  return (...args: A) => withRiotPriority('background', () => fn(...args))
}
