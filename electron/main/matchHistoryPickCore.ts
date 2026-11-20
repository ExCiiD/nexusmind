/**
 * "Importer depuis l'historique" (beta.16, 20/11/2026): the `count` most recent games of all the player's accounts,
 * without reading every listed match.
 *
 * It used to read every id of every account (up to 3 × 15) at once, without the local cache and without a limit:
 * behind the proxy's budget the picker waited for minutes. Now:
 * - each account's list is already newest first, so the lists are merged like sorted lists: only the head of each
 *   list is read, then the next one of the list whose head was picked (about `count` + one per account reads);
 * - at most `concurrency` reads at a time;
 * - a global deadline returns what is ready instead of nothing.
 *
 * Match ids of two servers do not compare (EUW1_8… against SG2_1…): only the game's own date orders them.
 * Pure: the read (cache, then Riot) is passed in.
 */

export interface PickList<T> {
  /** Newest first, as Riot lists them. */
  ids: string[]
  /** Anything the caller needs back with each pick (the account). */
  tag: T
}

export interface Picked<T, D> {
  id: string
  tag: T
  /** The game's date (ms), what orders the result. */
  at: number
  data: D
}

export interface PickOptions {
  concurrency?: number
  /** Absolute time (ms, same clock as `now`) after which what is ready is returned. */
  deadlineAt?: number
  now?: () => number
  /** Resolves when the deadline passes (injected by the tests). */
  sleepUntil?: (at: number) => Promise<void>
}

export const PICK_CONCURRENCY = 4
export const PICK_DEADLINE_MS = 20_000

/** A tiny limiter: at most `n` of the given tasks run at once. */
export function limiter(n: number) {
  let active = 0
  const queue: Array<() => void> = []
  const next = () => {
    if (active >= n) return
    const run = queue.shift()
    if (run) { active++; run() }
  }
  return <R>(task: () => Promise<R>): Promise<R> => new Promise<R>((resolve, reject) => {
    queue.push(() => task().then(resolve, reject).finally(() => { active--; next() }))
    next()
  })
}

/**
 * The `count` newest games across `lists`. `load` returns a game's date and data, or null when it cannot be read
 * (that id is skipped). Never throws: a failing read is a skipped id.
 */
export async function pickNewest<T, D>(
  lists: Array<PickList<T>>,
  count: number,
  load: (id: string, tag: T) => Promise<{ at: number; data: D } | null>,
  opts: PickOptions = {},
): Promise<Array<Picked<T, D>>> {
  const now = opts.now ?? Date.now
  const limit = limiter(Math.max(1, opts.concurrency ?? PICK_CONCURRENCY))
  const seen = new Set<string>()
  const cleaned = lists.map((l) => ({ tag: l.tag, ids: l.ids.filter((id) => (seen.has(id) ? false : (seen.add(id), true))) }))
  const ptr = cleaned.map(() => 0)
  const cache = new Map<string, Promise<{ at: number; data: D } | null>>()
  const read = (li: number, i: number) => {
    const id = cleaned[li].ids[i]
    let p = cache.get(id)
    if (!p) {
      p = limit(() => load(id, cleaned[li].tag)).catch(() => null)
      cache.set(id, p)
    }
    return p
  }
  const out: Array<Picked<T, D>> = []

  let timedOut = false
  const deadline = opts.deadlineAt != null
    ? (opts.sleepUntil ?? ((at: number) => new Promise<void>((r) => setTimeout(r, Math.max(0, at - now())))))(opts.deadlineAt).then(() => { timedOut = true })
    : null
  const withDeadline = <R>(p: Promise<R>): Promise<R | undefined> => (deadline ? Promise.race([p, deadline.then(() => undefined)]) : p)

  while (out.length < count && !timedOut) {
    const live = cleaned.map((_, li) => li).filter((li) => ptr[li] < cleaned[li].ids.length)
    if (live.length === 0) break
    // Heads, plus the next one of each list, read ahead within the concurrency.
    for (const li of live) {
      void read(li, ptr[li])
      if (ptr[li] + 1 < cleaned[li].ids.length) void read(li, ptr[li] + 1)
    }
    const heads = await withDeadline(Promise.all(live.map((li) => read(li, ptr[li]))))
    if (!heads) break
    let bestK = -1
    for (let k = 0; k < live.length; k++) {
      const h = heads[k]
      if (!h) { ptr[live[k]]++; continue } // unreadable: skipped, that list moves on
      if (bestK === -1 || h.at > heads[bestK]!.at) bestK = k
    }
    if (bestK === -1) continue // only unreadable heads this round
    const li = live[bestK]
    const h = heads[bestK]!
    out.push({ id: cleaned[li].ids[ptr[li]], tag: cleaned[li].tag, at: h.at, data: h.data })
    ptr[li]++
  }
  return out
}
