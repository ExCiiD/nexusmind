import { describe, it, expect, vi } from 'vitest'
import {
  accountRoutingFor, createRegionResolver, normalizePlatform, normalizeRegionMode, platformFromActiveRegion,
  REDETECT_AFTER_EMPTY_MS, REGION_CACHE_MS, type Platform,
} from '../../src/lib/riotRegionCore'

const P = 'puuid-3xc'

/** A fake Riot: where the account plays now, and the match ids each server's cluster holds for it. */
function fakeRiot(initial: Platform) {
  const state = { active: initial as Platform | null, fail: false, calls: 0 }
  const ids: Record<string, string[]> = {
    SG2: ['SG2_184700000', 'SG2_184600000'],
    EUW1: ['EUW1_8051837730', 'EUW1_8049815258'],
  }
  let t = 1_000_000
  const clock = { now: () => t, advance: (ms: number) => { t += ms } }
  const detect = vi.fn(async () => {
    state.calls++
    if (state.fail) throw new Error('riot down')
    return state.active
  })
  const fetchIds = vi.fn(async (platform: Platform) => ids[platform] ?? [])
  return { state, ids, clock, detect, fetchIds }
}

describe('riot region core', () => {
  it('normalizes platforms and modes', () => {
    expect(normalizePlatform('euw1')).toBe('EUW1')
    expect(normalizePlatform(' sg2 ')).toBe('SG2')
    expect(normalizePlatform('mars')).toBeNull()
    expect(normalizeRegionMode(null)).toBe('auto')
    expect(normalizeRegionMode('AUTO')).toBe('auto')
    expect(normalizeRegionMode('kr')).toBe('KR')
    expect(platformFromActiveRegion({ puuid: P, game: 'lol', region: 'euw1' })).toBe('EUW1')
    expect(platformFromActiveRegion(null)).toBeNull()
  })

  it('asks account-v1 on a cluster that serves it (never sea)', () => {
    expect(accountRoutingFor('SG2')).toBe('asia')
    expect(accountRoutingFor('EUW1')).toBe('europe')
    expect(accountRoutingFor('NA1')).toBe('americas')
    expect(accountRoutingFor(null)).toBe('europe')
  })

  it('SG2 → EUW1 transfer: the stored SG2 gives way to EUW1, and today\'s game is found', async () => {
    const riot = fakeRiot('EUW1')
    const changes: Array<[string, string | null, string]> = []
    const r = createRegionResolver({ detect: riot.detect, now: riot.clock.now, onDetectedChange: (...a) => changes.push(a) })
    const res = await r.resolve(P, 'SG2')
    expect(res).toEqual({ platform: 'EUW1', source: 'detected', previous: 'SG2' })
    expect(changes).toEqual([[P, 'SG2', 'EUW1']])
    const ids = await r.list(P, 'SG2', riot.fetchIds, { mergePrevious: true })
    expect(ids[0]).toBe('EUW1_8051837730')
    // The old SG2 history is still listed, after the newer EUW1 games.
    expect(ids).toEqual(['EUW1_8051837730', 'EUW1_8049815258', 'SG2_184700000', 'SG2_184600000'])
  })

  it('keeps reading the old server once the new one is saved (previousRegion)', async () => {
    const riot = fakeRiot('EUW1')
    const r = createRegionResolver({ detect: riot.detect, now: riot.clock.now })
    r.setPrevious(P, 'SG2')
    const ids = await r.list(P, 'EUW1', riot.fetchIds, { mergePrevious: true })
    expect(ids).toContain('SG2_184700000')
    expect((await r.resolve(P, 'EUW1')).previous).toBe('SG2')
  })

  it('EUW1 → SG2 transfer: the new server first, although its ids are smaller numbers', async () => {
    const riot = fakeRiot('SG2')
    const r = createRegionResolver({ detect: riot.detect, now: riot.clock.now })
    const ids = await r.list(P, 'EUW1', riot.fetchIds, { mergePrevious: true })
    expect(ids).toEqual(['SG2_184700000', 'SG2_184600000', 'EUW1_8051837730', 'EUW1_8049815258'])
  })

  it('a server seen in the latest game wins without asking Riot (works before the proxy has the route)', async () => {
    const detect = vi.fn(async () => null)
    const onChange = vi.fn()
    const r = createRegionResolver({ detect, onDetectedChange: onChange })
    r.observe(P, 'euw1')
    expect(await r.resolve(P, 'SG2')).toEqual({ platform: 'EUW1', source: 'detected', previous: 'SG2' })
    expect(detect).not.toHaveBeenCalled()
    expect(onChange).toHaveBeenCalledWith(P, 'SG2', 'EUW1')
    r.setMode(P, 'SG2')
    expect((await r.resolve(P, 'SG2')).platform).toBe('SG2')
  })

  it('tells the caller once per change, not on every call', async () => {
    const riot = fakeRiot('EUW1')
    const onChange = vi.fn()
    const r = createRegionResolver({ detect: riot.detect, now: riot.clock.now, onDetectedChange: onChange })
    await r.resolve(P, 'SG2')
    await r.resolve(P, 'SG2')
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('caches the detection 10 minutes, then detects again', async () => {
    const riot = fakeRiot('EUW1')
    const r = createRegionResolver({ detect: riot.detect, now: riot.clock.now })
    await r.resolve(P, 'EUW1')
    await r.resolve(P, 'EUW1')
    expect(riot.state.calls).toBe(1)
    riot.clock.advance(REGION_CACHE_MS + 1)
    await r.resolve(P, 'EUW1')
    expect(riot.state.calls).toBe(2)
  })

  it('one Riot call for parallel lookups of the same account', async () => {
    const riot = fakeRiot('EUW1')
    const r = createRegionResolver({ detect: riot.detect, now: riot.clock.now })
    await Promise.all([r.resolve(P, 'SG2'), r.resolve(P, 'SG2'), r.resolve(P, 'SG2')])
    expect(riot.state.calls).toBe(1)
  })

  it('a transfer during the cache: an empty listing detects again and retries on the new server', async () => {
    const riot = fakeRiot('SG2')
    riot.ids.SG2 = []
    const r = createRegionResolver({ detect: riot.detect, now: riot.clock.now })
    expect((await r.resolve(P, 'SG2')).platform).toBe('SG2')
    riot.state.active = 'EUW1'
    const ids = await r.list(P, 'SG2', riot.fetchIds)
    expect(ids[0]).toBe('EUW1_8051837730')
    expect(riot.state.calls).toBe(2)
  })

  it('an empty listing detects again at most once a minute', async () => {
    const riot = fakeRiot('EUW1')
    riot.ids.EUW1 = []
    const r = createRegionResolver({ detect: riot.detect, now: riot.clock.now })
    await r.list(P, 'EUW1', riot.fetchIds)
    await r.list(P, 'EUW1', riot.fetchIds)
    expect(riot.state.calls).toBe(2) // first detection + one re-detection, not one per listing
    riot.clock.advance(REDETECT_AFTER_EMPTY_MS + 1)
    await r.list(P, 'EUW1', riot.fetchIds)
    expect(riot.state.calls).toBe(3)
  })

  it('the manual choice wins over the detection, and Auto gives it back', async () => {
    const riot = fakeRiot('EUW1')
    const r = createRegionResolver({ detect: riot.detect, now: riot.clock.now })
    r.setMode(P, 'SG2')
    expect(await r.resolve(P, 'EUW1')).toEqual({ platform: 'SG2', source: 'manual', previous: 'EUW1' })
    expect(riot.state.calls).toBe(0)
    // A manual server is never second-guessed by an empty listing.
    riot.ids.SG2 = []
    await r.list(P, 'EUW1', riot.fetchIds)
    expect(riot.state.calls).toBe(0)
    r.setMode(P, 'auto')
    expect((await r.resolve(P, 'SG2')).platform).toBe('EUW1')
  })

  it('accounts on two servers keep their own server (never one region for the user)', async () => {
    const where: Record<string, Platform> = { euwAcc: 'EUW1', sgAcc: 'SG2' }
    const r = createRegionResolver({ detect: async (puuid) => where[puuid] ?? null })
    expect((await r.resolve('euwAcc', 'SG2')).platform).toBe('EUW1')
    expect((await r.resolve('sgAcc', 'SG2')).platform).toBe('SG2')
    expect((await r.resolve('sgAcc', 'SG2')).previous).toBeNull()
  })

  it('Riot unreachable or no answer: the stored region is used, without retrying on every call', async () => {
    const riot = fakeRiot('EUW1')
    riot.state.fail = true
    const r = createRegionResolver({ detect: riot.detect, now: riot.clock.now })
    expect(await r.resolve(P, 'SG2')).toEqual({ platform: 'SG2', source: 'stored', previous: null })
    await r.resolve(P, 'SG2')
    expect(riot.state.calls).toBe(1)
    const none = createRegionResolver({ detect: async () => null })
    expect((await none.resolve(P, 'KR')).platform).toBe('KR')
  })

  it('no merge when the old server shares the cluster (EUN1 → EUW1 is one europe list)', async () => {
    const fetchIds = vi.fn(async () => ['EUW1_2'])
    const r = createRegionResolver({ detect: async () => 'EUW1' })
    await r.list(P, 'EUN1', fetchIds, { mergePrevious: true })
    expect(fetchIds).toHaveBeenCalledTimes(1)
  })
})
