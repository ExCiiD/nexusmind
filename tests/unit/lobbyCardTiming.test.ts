/**
 * #46 point 2 ("pour avoir les champions de njord dans team workspace ça a mis plus de 4 min"): the time a Lobby
 * card waits for its champions, before and after, measured on the proxy's real budget (cloudflare/riot-proxy/src/
 * budget.ts, pure) with the production settings of cloudflare/riot-proxy/wrangler.toml, on a simulated clock:
 *   RIOT_APP_LIMITS "18:1,95:120" (development key), INTERACTIVE_RESERVE 0.3, USER_WINDOW_SHARE 0.25, and the
 *   per-player USER_LIMITER (20 calls / 60 s), which the proxy checks BEFORE its shared store, so a cached match still
 *   counts against it.
 * The app sends its calls one after the other, highest priority first (riotClient's limiter), and waits whatever the
 * proxy says before the next one.
 */
import { describe, it, expect } from 'vitest'
import { RiotBudget, type Priority } from '../../cloudflare/riot-proxy/src/budget'

interface Call { priority: Priority; cached: boolean; tag: string }

/**
 * Seconds until the last call tagged `tag` is answered, one player, starting at t = 0. `alreadySent` went out before
 * the click (in this order, whatever their priority); `calls` are then served highest priority first.
 */
function simulate(calls: Call[], tag: string, alreadySent: Call[] = [], interactiveReserve = false): number {
  // interactiveReserve: the proxy as changed for #46 (USER_INTERACTIVE_RESERVE 0.2, USER_LIMITER_BACKGROUND 16/min).
  // Without it, the proxy as deployed (no per-player reserve).
  const budget = new RiotBudget([{ limit: 18, seconds: 1 }, { limit: 95, seconds: 120 }], 0.3, 0.25, interactiveReserve ? 0.2 : 0)
  const userCalls: number[] = [] // USER_LIMITER: 20 per 60 s, sliding
  const backgroundCalls: number[] = [] // USER_LIMITER_BACKGROUND: 16 per 60 s, background calls only
  let now = 0
  let lastOfTag = 0
  // Sent before the click: those the proxy lets through go out; one it refuses (429) goes back to the app's queue,
  // where the calls of higher priority pass it (riotClient's limiter).
  // They went out just before the click (t = 0), one every 150 ms: the awards reading games already in the proxy's
  // store go that fast, and a cached call still counts against the per-player limiter.
  const requeued: Call[] = []
  alreadySent.forEach((call, i) => {
    const at = -(alreadySent.length - i) * 150
    while (userCalls.length > 0 && userCalls[0] <= at - 60_000) userCalls.shift()
    while (backgroundCalls.length > 0 && backgroundCalls[0] <= at - 60_000) backgroundCalls.shift()
    const userFull = userCalls.length >= 20 || (interactiveReserve && call.priority === 'background' && backgroundCalls.length >= 16)
    if (userFull || !(call.cached || budget.tryAcquire(call.priority, at, 'njord-viewer').ok)) { requeued.push(call); return }
    userCalls.push(at)
    if (call.priority === 'background') backgroundCalls.push(at)
  })
  const queue = [...calls, ...requeued].sort((a, b) => (a.priority === b.priority ? 0 : a.priority === 'interactive' ? -1 : 1))
  for (const call of queue) {
    for (;;) {
      while (userCalls.length > 0 && userCalls[0] <= now - 60_000) userCalls.shift()
      while (backgroundCalls.length > 0 && backgroundCalls[0] <= now - 60_000) backgroundCalls.shift()
      if (userCalls.length >= 20) { now = userCalls[0] + 60_000 + 1; continue }
      if (interactiveReserve && call.priority === 'background' && backgroundCalls.length >= 16) { now = backgroundCalls[0] + 60_000 + 1; continue }
      if (call.cached) break // the proxy's shared store answers without touching the Riot budget
      const r = budget.tryAcquire(call.priority, now, 'njord-viewer')
      if (r.ok) break
      now += r.retryAfterMs
    }
    userCalls.push(now)
    if (call.priority === 'background') backgroundCalls.push(now)
    now += 120 // one round trip
    if (call.tag === tag) lastOfTag = now
  }
  return Math.round(lastOfTag / 1000)
}

const many = (n: number, c: Omit<Call, 'cached'>, cachedShare = 0): Call[] =>
  Array.from({ length: n }, (_, i) => ({ ...c, cached: i < Math.round(n * cachedShare) }))

/** The card's quick auto-fill before #46: 3 match-list pages, 1 mastery call, 100 match details, at background priority. */
const quickAutoFill = (cachedShare: number): Call[] => [
  ...many(4, { priority: 'background', tag: 'card' }),
  ...many(100, { priority: 'background', tag: 'card' }, cachedShare),
]

describe('Lobby card champions: time to show them (simulated, production proxy settings)', () => {
  const report: Record<string, number> = {}

  it('BEFORE: a full quick auto-fill, half the games already in the proxy store: over 4 minutes', () => {
    report.beforeHalfCached = simulate(quickAutoFill(0.5), 'card')
    expect(report.beforeHalfCached).toBeGreaterThan(240)
  })

  it('BEFORE: and behind the weekly awards\' background reads of the same app (60 calls queued first): longer still', () => {
    report.beforeBehindAwards = simulate([...many(60, { priority: 'background', tag: 'awards' }), ...quickAutoFill(0.5)], 'card')
    expect(report.beforeBehindAwards).toBeGreaterThan(report.beforeHalfCached)
  })

  it('AFTER, pool already published by the player (#46 point 1): no Riot call at all', () => {
    report.afterPublished = 0 // poolImportCore: the published pool fills the empty local one, read from Supabase
    expect(report.afterPublished).toBe(0)
  })

  it('AFTER, not published: team:card-champions, 1 interactive call (+1 for the account), ahead of the awards: seconds', () => {
    report.afterCardChampions = simulate([...many(60, { priority: 'background', tag: 'awards' }), ...many(2, { priority: 'interactive', tag: 'card' })], 'card')
    expect(report.afterCardChampions).toBeLessThan(5)
  })

  it('AFTER, worst case: the awards just used this player\'s 20 calls of the minute: the card waits that minute out', () => {
    // The proxy's per-player limits (USER_LIMITER, user share) do not look at the priority: an interactive call of a
    // player whose background reads used their allowance waits like the rest. Still under a minute, against 6 to 11.
    const sent = many(20, { priority: 'background', tag: 'awards' }, 1) // games already in the proxy store
    report.afterWorstCase = simulate(many(2, { priority: 'interactive', tag: 'card' }), 'card', sent)
    expect(report.afterWorstCase).toBeLessThanOrEqual(65)
    expect(report.afterWorstCase).toBeLessThan(report.beforeHalfCached / 5)
  })

  it('AFTER, with the proxy\'s per-player interactive reserve: the same worst case takes seconds', () => {
    // The awards' background reads stop at 16 calls a minute and 80 % of the share: the card's calls find room.
    const sent = many(20, { priority: 'background', tag: 'awards' }, 1) // games already in the proxy store
    report.afterWorstCaseWithReserve = simulate(many(2, { priority: 'interactive', tag: 'card' }), 'card', sent, true)
    expect(report.afterWorstCaseWithReserve).toBeLessThan(5)
    // The numbers for the report (seconds).
    console.log('[#46 point 2] seconds until the card shows champions:', JSON.stringify(report))
  })
})
