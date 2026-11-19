/**
 * P1-2: the Durable Object that holds the global Riot budget. One instance per Riot host (idFromName(host)),
 * since Riot counts each platform or regional host separately. A Durable Object handles its requests one at a
 * time, so every user and device sees the same counters.
 *
 * The counters live in memory: the windows last two minutes at most, so an object evicted when idle loses
 * nothing that matters. Riot's own 429 headers stay the last line of defence.
 */
import { RiotBudget, parseWindows, parseReserve, parseUserShare } from './budget'

export interface BudgetObjectEnv {
  /** "calls:seconds,…", Riot's application limits for the key (default: the development key's, a little under). */
  RIOT_APP_LIMITS?: string
  /** Share of each window kept for interactive calls (default 0.3). */
  INTERACTIVE_RESERVE?: string
  /** Most of each window one account may use (default 0.25). */
  USER_WINDOW_SHARE?: string
}

export class RiotBudgetObject {
  private readonly budget: RiotBudget

  constructor(_state: unknown, env: BudgetObjectEnv) {
    this.budget = new RiotBudget(parseWindows(env.RIOT_APP_LIMITS), parseReserve(env.INTERACTIVE_RESERVE), parseUserShare(env.USER_WINDOW_SHARE))
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url)
    const now = Date.now()
    switch (url.pathname) {
      case '/acquire': {
        const priority = url.searchParams.get('priority') === 'background' ? 'background' : 'interactive'
        return Response.json(this.budget.tryAcquire(priority, now, url.searchParams.get('user') || undefined))
      }
      case '/penalize':
        this.budget.penalize(Number(url.searchParams.get('seconds')), now)
        return new Response(null, { status: 204 })
      case '/usage':
        return Response.json(this.budget.usage(now))
      default:
        return new Response('not found', { status: 404 })
    }
  }
}
