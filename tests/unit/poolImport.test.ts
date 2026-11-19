/**
 * #46 point 1: published pools fill the empty local ones (poolImportCore.planPoolImport), and a player publishes
 * their own pool on their linked roster row (teamCore.publishMyPool).
 */
import { describe, it, expect } from 'vitest'
import { planPoolImport, type PublishedPoolEntry } from '../../src/lib/poolImportCore'
import { publishMyPool } from '../../src/lib/teamCore'

const e = (championKey: string, role = 'MID', tier: string | null = 'main'): PublishedPoolEntry =>
  ({ championKey, role, tier, notes: null, playRate: 10, winRate: 55, masteryPoints: 100_000, kda: 3 })

describe('planPoolImport', () => {
  it('an empty local pool takes the published one: by puuid, else by Riot ID (case and spaces ignored)', () => {
    const plan = planPoolImport(
      [{ id: 'm1', ign: 'Njord', tagLine: 'EUW', puuid: 'P1', poolSize: 0 }, { id: 'm2', ign: 'Mid  Laner', tagLine: 'euw', puuid: null, poolSize: 0 }],
      [{ ign: 'Old Name', tagLine: 'X', puuid: 'P1', pool: [e('Ahri'), e('Syndra')] }, { ign: 'midlaner', tagLine: 'EUW', puuid: null, pool: [e('Orianna')] }],
    )
    expect(plan).toEqual([
      { memberId: 'm1', entries: [e('Ahri'), e('Syndra')] },
      { memberId: 'm2', entries: [e('Orianna')] },
    ])
  })
  it('a local pool with entries is never touched (a fetch made here, or a hand-made pool)', () => {
    expect(planPoolImport([{ id: 'm1', ign: 'A', tagLine: 'B', puuid: 'P1', poolSize: 3 }], [{ ign: 'A', tagLine: 'B', puuid: 'P1', pool: [e('Ahri')] }])).toEqual([])
  })
  it('nothing published for that player, or an empty published pool: nothing', () => {
    expect(planPoolImport([{ id: 'm1', ign: 'A', tagLine: 'B', puuid: null, poolSize: 0 }], [{ ign: 'C', tagLine: 'D', puuid: null, pool: [e('Ahri')] }])).toEqual([])
    expect(planPoolImport([{ id: 'm1', ign: 'A', tagLine: 'B', puuid: null, poolSize: 0 }], [{ ign: 'A', tagLine: 'B', puuid: null, pool: [] }])).toEqual([])
  })
  it('one published player fills one local player, duplicate entries dropped', () => {
    const plan = planPoolImport(
      [{ id: 'm1', ign: 'A', tagLine: 'B', puuid: null, poolSize: 0 }, { id: 'm2', ign: 'a', tagLine: 'b', puuid: null, poolSize: 0 }],
      [{ ign: 'A', tagLine: 'B', puuid: null, pool: [e('Ahri'), e('Ahri'), e('Ahri', 'TOP')] }],
    )
    expect(plan).toEqual([{ memberId: 'm1', entries: [e('Ahri'), e('Ahri', 'TOP')] }])
  })
})

describe('publishMyPool', () => {
  function client(rosterRows: Array<{ id: string }>) {
    const calls: string[] = []
    let inserted: Array<Record<string, unknown>> = []
    const from = (table: string) => {
      const q: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'is', 'limit']) q[m] = () => q
      q.then = (resolve: (v: unknown) => void) => resolve({ data: rosterRows, error: null })
      q.delete = () => ({ eq: (_c: string, id: string) => { calls.push(`delete:${table}:${id}`); return Promise.resolve({ error: null }) } })
      q.insert = (rows: Array<Record<string, unknown>>) => { inserted = rows; calls.push(`insert:${table}:${rows.length}`); return Promise.resolve({ error: null }) }
      return q
    }
    return { sb: { from } as never, calls, inserted: () => inserted }
  }

  it('replaces the pool of the roster row linked to me, tiers the shared tables accept', async () => {
    const c = client([{ id: 'r1' }])
    expect(await publishMyPool(c.sb, 'g1', 'me', [
      { ...e('Ahri'), tier: 'new' }, { ...e('Syndra'), tier: 'weird' }, { ...e('Syndra') }, { ...e('Lux', 'UTILITY') },
    ])).toBe(true)
    expect(c.calls).toEqual(['delete:team_pool_entries:r1', 'insert:team_pool_entries:2'])
    expect(c.inserted().map((r) => `${r.champion_key}:${r.tier}`)).toEqual(['Ahri:flex', 'Syndra:comfort'])
  })
  it('no roster row linked to me yet: false, nothing written', async () => {
    const c = client([])
    expect(await publishMyPool(c.sb, 'g1', 'me', [e('Ahri')])).toBe(false)
    expect(c.calls).toEqual([])
  })
})
