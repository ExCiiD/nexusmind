/**
 * P1-2: the Durable Object that holds the global Riot budget. One instance per Riot host (idFromName(host)),
 * since Riot counts each platform or regional host separately. A Durable Object handles its requests one at a
 * time, so every user and device sees the same counters.
 *
 * The Riot counters live in memory: the windows last two minutes at most, so an object evicted when idle loses
 * nothing that matters. Riot's own 429 headers stay the last line of defence.
 *
 * The instance named R2_GUARD_NAME also keeps the R2 cost guard (r2Guard.ts): those counters span a month, so
 * they are kept in the object's durable storage.
 */
import { RiotBudget, parseWindows, parseReserve, parseUserShare, parseUserInteractiveReserve } from './budget'
import { decideR2, currentUsage, extraCostUSD, freeTierShare, parseBudgetUSD, storedGB, type R2Usage } from './r2Guard'

export const R2_GUARD_NAME = 'r2-cost-guard'

export interface BudgetObjectEnv {
  /** "calls:seconds,…", Riot's application limits for the key (default: the development key's, a little under). */
  RIOT_APP_LIMITS?: string
  /** Share of each window kept for interactive calls (default 0.3). */
  INTERACTIVE_RESERVE?: string
  /** Most of each window one account may use (default 0.25). */
  USER_WINDOW_SHARE?: string
  USER_INTERACTIVE_RESERVE?: string
  /** Most the R2 store may cost above its free tier in a month, in USD (default 2). */
  R2_EXTRA_BUDGET_USD?: string
}

/** The part of DurableObjectState used here (kept narrow for the tests). */
interface ObjectState {
  storage: { get<T>(key: string): Promise<T | undefined>; put<T>(key: string, value: T): Promise<void> }
}

export class RiotBudgetObject {
  private readonly budget: RiotBudget
  private readonly r2BudgetUSD: number
  /** Last free-tier step logged, so each 50 % / 80 % / 100 % step is logged once per instance. */
  private loggedStep = 0

  constructor(private readonly state: ObjectState, env: BudgetObjectEnv) {
    this.budget = new RiotBudget(parseWindows(env.RIOT_APP_LIMITS), parseReserve(env.INTERACTIVE_RESERVE), parseUserShare(env.USER_WINDOW_SHARE),
      parseUserInteractiveReserve(env.USER_INTERACTIVE_RESERVE))
    this.r2BudgetUSD = parseBudgetUSD(env.R2_EXTRA_BUDGET_USD)
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
      case '/r2/allow': {
        const op = url.searchParams.get('op') === 'write' ? 'write' : 'read'
        const bytes = Number(url.searchParams.get('bytes')) || 0
        const decision = decideR2(await this.state.storage.get<R2Usage>('r2usage'), op, bytes, this.r2BudgetUSD, now)
        if (decision.allow) await this.state.storage.put('r2usage', decision.usage)
        this.logSteps(decision.usage, decision.allow)
        return Response.json({ allow: decision.allow, extraUSD: decision.extraUSD })
      }
      case '/r2/usage': {
        const u = currentUsage(await this.state.storage.get<R2Usage>('r2usage'), now)
        return Response.json({ ...u, storedGB: storedGB(u), freeTierShare: freeTierShare(u), extraUSD: extraCostUSD(u), budgetUSD: this.r2BudgetUSD })
      }
      default:
        return new Response('not found', { status: 404 })
    }
  }

  /** One log line per step of the free tier, and one each time the guard stops R2 (wrangler tail, Workers Logs). */
  private logSteps(u: R2Usage, allowed: boolean): void {
    const share = freeTierShare(u)
    const step = share >= 1 ? 100 : share >= 0.8 ? 80 : share >= 0.5 ? 50 : 0
    if (step > this.loggedStep) {
      this.loggedStep = step
      console.warn(JSON.stringify({ warn: 'r2_free_tier', percent: step, extraUSD: extraCostUSD(u) }))
    }
    if (!allowed) console.warn(JSON.stringify({ warn: 'r2_cost_guard_stopped', budgetUSD: this.r2BudgetUSD, extraUSD: extraCostUSD(u) }))
  }
}
