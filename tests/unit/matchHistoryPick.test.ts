/**
 * Beta.16, "Importer depuis l'historique" loaded forever: it read every listed match of every account at once.
 * pickNewest reads only what the `count` newest need, 4 at a time, and stops at the deadline.
 */
import { describe, it, expect } from 'vitest'
import { limiter, pickNewest } from '../../electron/main/matchHistoryPickCore'

/** Three accounts, two servers: dates by id. */
const DATES: Record<string, number> = {
  // main account on EUW1 (newest first)
  EUW1_9: 900, EUW1_7: 700, EUW1_5: 500, EUW1_3: 300, EUW1_1: 100,
  // second account on SG2: smaller ids, but some games are newer
  SG2_8: 800, SG2_6: 600, SG2_2: 200,
  // third account, nothing recent
  EUW1_0: 50,
}
const lists = [
  { tag: 'main', ids: ['EUW1_9', 'EUW1_7', 'EUW1_5', 'EUW1_3', 'EUW1_1'] },
  { tag: 'sg', ids: ['SG2_8', 'SG2_6', 'SG2_2'] },
  { tag: 'old', ids: ['EUW1_0'] },
]

function counter(delayMs = 0) {
  const reads: string[] = []
  let active = 0
  let maxActive = 0
  const load = async (id: string) => {
    reads.push(id)
    active++
    maxActive = Math.max(maxActive, active)
    await new Promise((r) => setTimeout(r, delayMs))
    active--
    return id in DATES ? { at: DATES[id], data: id } : null
  }
  return { load, reads, max: () => maxActive }
}

describe('pickNewest', () => {
  it('the newest games of all accounts, by date (ids of two servers do not compare)', async () => {
    const c = counter()
    const out = await pickNewest(lists, 4, c.load)
    expect(out.map((p) => [p.id, p.tag])).toEqual([['EUW1_9', 'main'], ['SG2_8', 'sg'], ['EUW1_7', 'main'], ['SG2_6', 'sg']])
  })

  it('reads only what it needs, not every listed match', async () => {
    const c = counter()
    await pickNewest(lists, 4, c.load)
    expect(c.reads.length).toBeLessThan(9)
    expect(c.reads).not.toContain('EUW1_1')
  })

  it('never more than 4 reads at a time', async () => {
    const many = Array.from({ length: 6 }, (_, k) => ({ tag: k, ids: [`EUW1_${k}9`, `EUW1_${k}8`, `EUW1_${k}7`] }))
    let active = 0
    let max = 0
    const load = async (id: string) => {
      active++; max = Math.max(max, active)
      await new Promise((r) => setTimeout(r, 5))
      active--
      return { at: Number(id.split('_')[1]), data: id }
    }
    const out = await pickNewest(many, 10, load, { concurrency: 4 })
    expect(out).toHaveLength(10)
    expect(max).toBeLessThanOrEqual(4)
  })

  it('an unreadable match is skipped, the rest comes back', async () => {
    const out = await pickNewest([{ tag: 'a', ids: ['EUW1_X', 'EUW1_9', 'EUW1_7'] }], 5, async (id) => (id === 'EUW1_X' ? Promise.reject(new Error('429')) : { at: DATES[id], data: id }))
    expect(out.map((p) => p.id)).toEqual(['EUW1_9', 'EUW1_7'])
  })

  it('at the deadline, what is ready comes back instead of nothing', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => { release = r })
    let calls = 0
    const load = async (id: string) => {
      calls++
      if (calls > 2) await new Promise(() => {}) // Riot stuck behind the budget
      return { at: DATES[id], data: id }
    }
    const p = pickNewest([{ tag: 'a', ids: ['EUW1_9', 'EUW1_7', 'EUW1_5', 'EUW1_3'] }], 4, load, { deadlineAt: 1, sleepUntil: () => gate })
    await new Promise((r) => setTimeout(r, 10))
    release()
    const out = await p
    expect(out.map((x) => x.id)).toEqual(['EUW1_9', 'EUW1_7']) // the two reads that answered, then the stuck one is dropped
  })

  it('duplicates across lists are read once', async () => {
    const c = counter()
    const out = await pickNewest([{ tag: 'a', ids: ['EUW1_9'] }, { tag: 'b', ids: ['EUW1_9', 'EUW1_7'] }], 5, c.load)
    expect(out.map((p) => p.id)).toEqual(['EUW1_9', 'EUW1_7'])
    expect(c.reads.filter((id) => id === 'EUW1_9')).toHaveLength(1)
  })

  it('limiter runs tasks in order, n at a time', async () => {
    const run = limiter(2)
    const order: number[] = []
    await Promise.all([1, 2, 3].map((n) => run(async () => { order.push(n) })))
    expect(order).toEqual([1, 2, 3])
  })
})
