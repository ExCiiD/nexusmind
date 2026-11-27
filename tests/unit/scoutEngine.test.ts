import { describe, it, expect } from 'vitest'
import {
  planTeamMatches, runBounded, runScout, PoolAccumulator, matchIdRank, masteryPool,
  type ScoutDeps, type ScoutEvent, type ScoutMember,
} from '../../src/lib/scoutEngine'

// Match ids embed their time: a bigger number is a more recent game.
const id = (n: number) => `EUW1_${1000 + n}`

function game(n: number, players: Array<{ puuid: string; champ: string; win?: boolean }>) {
  return {
    info: {
      gameStartTimestamp: 1_700_000_000_000 + n * 1000,
      participants: players.map((p) => ({ puuid: p.puuid, championName: p.champ, teamPosition: 'TOP', win: p.win ?? true, kills: 2, deaths: 1, assists: 3 })),
    },
  }
}

describe('planTeamMatches', () => {
  it('lists a shared game once, most recent first, and remembers who wants it', () => {
    const plan = planTeamMatches([
      { memberId: 'a', ids: [id(5), id(3), id(1)] },
      { memberId: 'b', ids: [id(4), id(3), id(1)] },
      { memberId: 'c', ids: [id(3)] },
    ])
    expect(plan.order).toEqual([id(5), id(4), id(3), id(1)])
    expect(plan.wantedBy.get(id(3))).toEqual(['a', 'b', 'c'])
    expect(plan.wantedBy.get(id(5))).toEqual(['a'])
    expect(plan.rawIds).toBe(7)
    expect(plan.sharedIds).toBe(3) // 7 listed, 4 distinct
  })

  it('does not count a duplicate inside one member list twice', () => {
    const plan = planTeamMatches([{ memberId: 'a', ids: [id(2), id(2), id(1)] }])
    expect(plan.order).toEqual([id(2), id(1)])
    expect(plan.rawIds).toBe(2)
  })

  it('ranks ids by their embedded time', () => {
    expect(matchIdRank('EUW1_7123456789')).toBeGreaterThan(matchIdRank('EUW1_7123456788'))
    expect(matchIdRank('weird')).toBe(0)
  })
})

describe('runBounded', () => {
  it('never has more than `limit` in flight and starts the items in order', async () => {
    let inFlight = 0
    let peak = 0
    const started: number[] = []
    const items = Array.from({ length: 25 }, (_, i) => i)
    await runBounded(items, 4, async (item) => {
      started.push(item)
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 2 + (item % 3)))
      inFlight--
    })
    expect(peak).toBe(4)
    expect(started).toEqual(items)
  })

  it('stops starting new items once told to, and lets the started ones finish', async () => {
    let stop = false
    const done: number[] = []
    await runBounded([1, 2, 3, 4, 5, 6, 7, 8], 2, async (n) => {
      await new Promise((r) => setTimeout(r, 1))
      done.push(n)
      if (n === 2) stop = true
    }, () => stop)
    expect(done.length).toBeLessThan(8)
    expect(done).toContain(1)
    expect(done).toContain(2)
  })

  it('handles an empty list', async () => {
    await runBounded([], 5, async () => { throw new Error('never') })
  })
})

describe('PoolAccumulator', () => {
  it('counts plays per champion and role with first/last time, like the batch aggregation', () => {
    const acc = new PoolAccumulator('p1', {})
    acc.add(game(1, [{ puuid: 'p1', champ: 'Aatrox', win: true }]))
    acc.add(game(2, [{ puuid: 'p1', champ: 'Aatrox', win: false }]))
    acc.add(game(3, [{ puuid: 'p1', champ: 'Jax' }]))
    acc.add(game(4, [{ puuid: 'someone-else', champ: 'Garen' }]))
    const entries = acc.entries(new Map([['Aatrox', 120_000]]))
    const aatrox = entries.find((e) => e.championKey === 'Aatrox')!
    expect(aatrox).toMatchObject({ count: 2, wins: 1, kills: 4, deaths: 2, assists: 6, masteryPoints: 120_000 })
    expect(aatrox.firstAt).toBeLessThan(aatrox.lastAt!)
    expect(entries).toHaveLength(2)
    expect(acc.processed).toBe(4)
    expect(acc.sameRoleCount).toBe(3)
  })
})

describe('masteryPool', () => {
  it('turns masteries into entries in the member role, with no game counted', () => {
    const pool = masteryPool([{ championKey: 'Aatrox', championPoints: 90_000 }, { championKey: 'Jax', championPoints: 50_000 }], 'TOP')
    expect(pool.length).toBeGreaterThan(0)
    for (const e of pool) {
      expect(e.role).toBe('TOP')
      expect(e.games).toBe(0)
      expect(e.winRate).toBeNull()
      expect(e.masteryPoints).toBeGreaterThan(0)
    }
  })
})

// ── The engine, with a fake Riot ──────────────────────────────────────────────────────────────────────────────

interface Harness {
  deps: ScoutDeps
  events: ScoutEvent[]
  fetched: string[]
  saved: string[]
  finalized: string[]
  peak: () => number
  cancel: () => void
}

function harness(opts: {
  lists: Record<string, string[]>
  cache?: Record<string, any>
  missing?: Set<string>
  failWith?: (id: string) => unknown
  delayMs?: number
  cancelAfterFetches?: number
}): Harness {
  const events: ScoutEvent[] = []
  const fetched: string[] = []
  const saved: string[] = []
  const finalized: string[] = []
  let inFlight = 0
  let peak = 0
  let cancelled = false
  const puuid = (m: ScoutMember) => `puuid-${m.id}`
  const deps: ScoutDeps = {
    resolveMember: async (m) => ({ puuid: puuid(m), region: 'EUW1' }),
    getMasteries: async () => [{ championKey: 'Aatrox', championPoints: 10_000 }],
    getSeasonIds: async (m) => opts.lists[m.id] ?? [],
    loadCached: async (ids) => new Map(ids.filter((i) => opts.cache?.[i]).map((i) => [i, opts.cache![i]])),
    fetchMatch: async (mid) => {
      inFlight++
      peak = Math.max(peak, inFlight)
      fetched.push(mid)
      await new Promise((r) => setTimeout(r, opts.delayMs ?? 1))
      inFlight--
      if (opts.cancelAfterFetches && fetched.length >= opts.cancelAfterFetches) cancelled = true
      const err = opts.failWith?.(mid)
      if (err) throw err
      if (opts.missing?.has(mid)) return null
      // Every scouted player is in every game: it is a shared flex lobby.
      return game(parseInt(mid.split('_')[1], 10) - 1000, Object.keys(opts.lists).map((k) => ({ puuid: `puuid-${k}`, champ: 'Aatrox' })))
    },
    saveMatch: async (mid) => { saved.push(mid) },
    finalizeMember: async (m, _r, snap) => { finalized.push(m.id); return snap.entries.length },
    emit: (e) => events.push(e),
    isCancelled: () => cancelled,
  }
  return { deps, events, fetched, saved, finalized, peak: () => peak, cancel: () => { cancelled = true } }
}

const members: ScoutMember[] = ['a', 'b', 'c', 'd', 'e'].map((k) => ({ id: k, displayName: k.toUpperCase(), role: 'TOP' }))
const base = { scoutId: 'test-scout', count: -1, roleOnly: false, concurrency: 4, chunkEvery: 5, chunkIntervalMs: 60_000 }

describe('runScout', () => {
  it('downloads a game the five opponents share ONCE, most recent first, and counts it for each', async () => {
    const shared = Array.from({ length: 12 }, (_, i) => id(i))
    const h = harness({ lists: Object.fromEntries(members.map((m) => [m.id, shared])) })
    const res = await runScout(h.deps, members, base)
    expect(h.fetched).toHaveLength(12) // not 60
    expect(res.stats).toMatchObject({ rawIds: 60, uniqueIds: 12, sharedIds: 48, downloaded: 12, fromCache: 0 })
    // Started most recent first (concurrent workers start in order).
    expect(h.fetched.slice(0, 4)).toEqual([id(11), id(10), id(9), id(8)])
    expect(res.members.every((m) => m.ok && m.totalMatches === 12)).toBe(true)
    expect(h.finalized.sort()).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('reads the local cache first and only downloads what is missing', async () => {
    const ids = Array.from({ length: 10 }, (_, i) => id(i))
    const cache = Object.fromEntries(ids.slice(5).map((i) => [i, game(parseInt(i.split('_')[1], 10) - 1000, members.map((m) => ({ puuid: `puuid-${m.id}`, champ: 'Jax' })))]))
    const h = harness({ lists: { a: ids }, cache })
    const res = await runScout(h.deps, [members[0]], base)
    expect(res.stats.fromCache).toBe(5)
    expect(h.fetched.sort()).toEqual(ids.slice(0, 5).sort())
    expect(h.saved.sort()).toEqual(ids.slice(0, 5).sort()) // only downloaded games are written to the cache
  })

  it('keeps the games in flight within the bound', async () => {
    const h = harness({ lists: { a: Array.from({ length: 30 }, (_, i) => id(i)) }, delayMs: 3 })
    await runScout(h.deps, [members[0]], { ...base, concurrency: 3 })
    expect(h.peak()).toBe(3)
  })

  it('sends the instant mastery pool before any game is read', async () => {
    const h = harness({ lists: { a: [id(1), id(2)], b: [id(1)] } })
    await runScout(h.deps, members.slice(0, 2), base)
    const types = h.events.map((e) => e.type)
    const firstMastery = types.indexOf('mastery')
    const firstChunk = types.indexOf('chunk')
    expect(firstMastery).toBeGreaterThanOrEqual(0)
    expect(firstChunk).toBeGreaterThan(firstMastery)
    expect(types[0]).toBe('start')
    expect(types[types.length - 1]).toBe('done')
  })

  it('sends partial pools as chunks, and member-done as soon as a member is complete', async () => {
    const h = harness({ lists: { a: Array.from({ length: 12 }, (_, i) => id(i)), b: [id(11)] } })
    await runScout(h.deps, members.slice(0, 2), base)
    const chunksA = h.events.filter((e) => e.type === 'chunk' && e.memberId === 'a')
    expect(chunksA.length).toBeGreaterThanOrEqual(2)
    const processed = chunksA.map((e) => (e.type === 'chunk' ? e.processed : 0))
    expect([...processed].sort((x, y) => x - y)).toEqual(processed) // never goes backwards
    const doneB = h.events.findIndex((e) => e.type === 'member-done' && e.memberId === 'b')
    const doneA = h.events.findIndex((e) => e.type === 'member-done' && e.memberId === 'a')
    expect(doneB).toBeGreaterThan(-1)
    expect(doneB).toBeLessThan(doneA) // b only wanted the newest game: done first
  })

  it('a game Riot does not have is counted, not retried, and does not block the member', async () => {
    const ids = [id(3), id(2), id(1)]
    const h = harness({ lists: { a: ids }, missing: new Set([id(2)]) })
    const res = await runScout(h.deps, [members[0]], base)
    expect(res.stats.failed).toBe(1)
    expect(res.members[0]).toMatchObject({ ok: true, totalMatches: 3 })
  })

  it('stops on a rate limit that outlasted the retries and says so, keeping what was downloaded', async () => {
    const limited = Object.assign(new Error('RIOT_RATE_LIMITED: later'), { code: 'RIOT_RATE_LIMITED' })
    const ids = Array.from({ length: 20 }, (_, i) => id(i))
    const h = harness({ lists: { a: ids }, failWith: (mid) => (mid === id(15) ? limited : null) })
    const res = await runScout(h.deps, [members[0]], { ...base, concurrency: 1 })
    expect(res.rateLimited).toBe(true)
    expect(h.fetched.length).toBeLessThan(20)
    expect(res.members[0]).toMatchObject({ ok: false, error: { code: 'RIOT_RATE_LIMITED' } })
    expect(h.finalized).toEqual([]) // an incomplete pool is not written
    expect(h.events.some((e) => e.type === 'member-error' && e.code === 'RIOT_RATE_LIMITED')).toBe(true)
  })

  it('a cancel stops the downloads and ends with done.cancelled', async () => {
    const h = harness({ lists: { a: Array.from({ length: 40 }, (_, i) => id(i)) }, cancelAfterFetches: 6, delayMs: 2 })
    const res = await runScout(h.deps, [members[0]], { ...base, concurrency: 2 })
    expect(res.cancelled).toBe(true)
    expect(h.fetched.length).toBeLessThan(40)
    expect(res.members[0].error?.code).toBe('CANCELLED')
  })

  it('applies the per-member game count before sharing the list', async () => {
    const ids = Array.from({ length: 30 }, (_, i) => id(29 - i)) // already most recent first
    const h = harness({ lists: { a: ids } })
    const res = await runScout(h.deps, [members[0]], { ...base, count: 10 })
    expect(res.stats.uniqueIds).toBe(10)
    expect(h.fetched.sort()).toEqual(ids.slice(0, 10).sort())
  })

  it('one member failing to resolve does not stop the others', async () => {
    const h = harness({ lists: { a: [id(1)], b: [id(1)] } })
    const original = h.deps.resolveMember
    h.deps.resolveMember = async (m) => { if (m.id === 'a') throw new Error('Could not resolve Riot account'); return original(m) }
    const res = await runScout(h.deps, members.slice(0, 2), base)
    expect(res.members.find((m) => m.memberId === 'a')).toMatchObject({ ok: false, error: { code: 'FAILED' } })
    expect(res.members.find((m) => m.memberId === 'b')?.ok).toBe(true)
  })

  it('measures the request count of a 5-player team scout: no overlap = same as before, full overlap = 1/5', async () => {
    // Before: every id of every member was asked (cache aside). After: distinct ids only.
    const solo = Object.fromEntries(members.map((m, k) => [m.id, Array.from({ length: 20 }, (_, i) => id(k * 100 + i))]))
    const noOverlap = harness({ lists: solo })
    const r1 = await runScout(noOverlap.deps, members, base)
    expect(r1.stats.rawIds).toBe(100)
    expect(noOverlap.fetched).toHaveLength(100)
    const lobby = Object.fromEntries(members.map((m) => [m.id, Array.from({ length: 20 }, (_, i) => id(i))]))
    const full = harness({ lists: lobby })
    const r2 = await runScout(full.deps, members, base)
    expect(r2.stats.rawIds).toBe(100)
    expect(full.fetched).toHaveLength(20)
  })

  // ── Audit I2 / I3 ───────────────────────────────────────────────────────────────────────────────────────────
  it('retries a transient failure of a game and succeeds', async () => {
    const ids = [id(3), id(2), id(1)]
    const tries = new Map<string, number>()
    const h = harness({ lists: { a: ids }, failWith: (mid) => {
      tries.set(mid, (tries.get(mid) ?? 0) + 1)
      return mid === id(2) && tries.get(mid)! < 3 ? new Error('Ascend Riot service is temporarily unavailable') : null
    } })
    const res = await runScout(h.deps, [members[0]], { ...base, retryDelayMs: 0 })
    expect(tries.get(id(2))).toBe(3)
    expect(res.members[0]).toMatchObject({ ok: true, failed: 0, unreadable: 0 })
  })

  it('a member with too many unreadable games is NOT written (yesterday pool is kept) and gets member-error FAILED', async () => {
    const ids = Array.from({ length: 20 }, (_, i) => id(i))
    const h = harness({ lists: { a: ids }, failWith: () => new Error('network down') })
    const res = await runScout(h.deps, [members[0]], { ...base, retryDelayMs: 0, fetchRetries: 1 })
    expect(h.finalized).toEqual([])
    expect(res.members[0]).toMatchObject({ ok: false, error: { code: 'FAILED' } })
    expect(res.stats.unreadable).toBe(20)
    expect(h.events.some((e) => e.type === 'member-error' && e.code === 'FAILED')).toBe(true)
  })

  it('a few unreadable games (under the threshold) still write the pool and report failed / unreadable', async () => {
    const ids = Array.from({ length: 100 }, (_, i) => id(i))
    const h = harness({ lists: { a: ids }, failWith: (mid) => (mid === id(5) ? new Error('502') : null) })
    const res = await runScout(h.deps, [members[0]], { ...base, retryDelayMs: 0, fetchRetries: 0 })
    expect(h.finalized).toEqual(['a'])
    expect(res.members[0]).toMatchObject({ ok: true, failed: 1, unreadable: 1 })
    const done = h.events.find((e) => e.type === 'member-done')
    expect(done).toMatchObject({ failed: 1, unreadable: 1 })
  })

  it('a member whose EVERY game failed is not written, even when the 2 % allowance would let it through (audit I1)', async () => {
    const h = harness({ lists: { a: [id(1), id(2)] }, failWith: () => new Error('network down') })
    const res = await runScout(h.deps, [members[0]], { ...base, retryDelayMs: 0, fetchRetries: 0 })
    expect(h.finalized).toEqual([])
    expect(res.members[0]).toMatchObject({ ok: false, error: { code: 'FAILED' } })
  })

  it('a failure caused by a rate limit stop is not counted as an unreadable game (audit I4)', async () => {
    const ids = Array.from({ length: 10 }, (_, i) => id(i))
    const h = harness({ lists: { a: ids }, delayMs: 5, failWith: (mid) => (mid === id(9) ? Object.assign(new Error('RIOT_RATE_LIMITED'), { code: 'RIOT_RATE_LIMITED' }) : mid === id(8) ? new Error('502') : null) })
    const res = await runScout(h.deps, [members[0]], { ...base, concurrency: 2, retryDelayMs: 0, fetchRetries: 0 })
    expect(res.rateLimited).toBe(true)
    expect(res.stats.unreadable ?? 0).toBeLessThanOrEqual(1)
    expect(res.members[0]).toMatchObject({ ok: false, error: { code: 'RIOT_RATE_LIMITED' } })
  })

  it('no mastery event once stopped, and no empty chunk before a member-error (audit M4)', async () => {
    const h = harness({ lists: { a: [id(1), id(2)] } })
    h.cancel()
    await runScout(h.deps, [members[0]], base)
    expect(h.events.some((e) => e.type === 'mastery')).toBe(false)
    expect(h.events.some((e) => e.type === 'chunk')).toBe(false)
  })

  it('a 404 counts as failed but not unreadable, and never blocks the write', async () => {
    const ids = Array.from({ length: 10 }, (_, i) => id(i))
    const h = harness({ lists: { a: ids }, missing: new Set(ids.slice(0, 5)) })
    const res = await runScout(h.deps, [members[0]], base)
    expect(res.members[0]).toMatchObject({ ok: true, failed: 5, unreadable: 0 })
    expect(h.finalized).toEqual(['a'])
  })

  it('an authentication error stops the whole scout at once', async () => {
    const auth = Object.assign(new Error('Your Ascend session expired'), { name: 'RiotAuthError' })
    const ids = Array.from({ length: 50 }, (_, i) => id(i))
    const h = harness({ lists: { a: ids, b: ids }, failWith: () => auth })
    const res = await runScout(h.deps, members.slice(0, 2), { ...base, concurrency: 2, isFatal: (e) => (e as Error).name === 'RiotAuthError' })
    expect(h.fetched.length).toBeLessThan(10)
    expect(res.members.every((m) => !m.ok && m.error?.code === 'FAILED')).toBe(true)
    expect(h.finalized).toEqual([])
  })

  it('a season list that fails is a member-error, never "no games" (and nothing is written)', async () => {
    const h = harness({ lists: { a: [id(1)], b: [id(1)] } })
    const original = h.deps.getSeasonIds
    h.deps.getSeasonIds = async (m, r) => { if (m.id === 'a') throw new Error('Riot API error 500'); return original(m, r) }
    const res = await runScout(h.deps, members.slice(0, 2), base)
    const a = res.members.find((m) => m.memberId === 'a')!
    expect(a).toMatchObject({ ok: false, error: { code: 'FAILED' } })
    expect(h.events.some((e) => e.type === 'member-done' && e.memberId === 'a')).toBe(false)
    expect(res.members.find((m) => m.memberId === 'b')?.ok).toBe(true)
  })

  it('a cancel during the first phase stops before any list or game is read', async () => {
    const h = harness({ lists: { a: [id(1)], b: [id(1)] } })
    h.cancel()
    const res = await runScout(h.deps, members.slice(0, 2), base)
    expect(h.fetched).toEqual([])
    expect(res.members.every((m) => m.error?.code === 'CANCELLED')).toBe(true)
  })

  it('a second scout resumes from the cache: nothing is downloaded again', async () => {
    const ids = Array.from({ length: 8 }, (_, i) => id(i))
    const first = harness({ lists: { a: ids } })
    await runScout(first.deps, [members[0]], base)
    const cache = Object.fromEntries(first.saved.map((mid) => [mid, game(parseInt(mid.split('_')[1], 10) - 1000, [{ puuid: 'puuid-a', champ: 'Aatrox' }])]))
    const second = harness({ lists: { a: ids }, cache })
    const res = await runScout(second.deps, [members[0]], base)
    expect(second.fetched).toEqual([])
    expect(res.stats).toMatchObject({ fromCache: 8, downloaded: 0 })
  })
})
