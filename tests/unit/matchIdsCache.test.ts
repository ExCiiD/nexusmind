import { beforeEach, describe, expect, it, vi } from 'vitest'

const getMatchIds = vi.fn()
vi.mock('../../electron/main/riotClient', () => ({ getMatchIds: (...a: unknown[]) => getMatchIds(...a) }))

const { getMatchIdsCached, invalidateMatchIds } = await import('../../electron/main/matchIdsCache')

describe('matchIdsCache', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    getMatchIds.mockReset()
    invalidateMatchIds()
  })

  it('awaits the first read, then serves the list without Riot while fresh', async () => {
    getMatchIds.mockResolvedValueOnce(['A'])
    expect(await getMatchIdsCached('p', 'EUW1', 10, 0, 'both')).toEqual(['A'])
    expect(await getMatchIdsCached('p', 'EUW1', 10, 0, 'both')).toEqual(['A'])
    expect(getMatchIds).toHaveBeenCalledTimes(1)
  })

  it('serves a stale list at once and refreshes it behind', async () => {
    getMatchIds.mockResolvedValueOnce(['A'])
    await getMatchIdsCached('p', 'EUW1', 10, 0, 'both')
    vi.setSystemTime(1_000_000 + 61_000)
    getMatchIds.mockResolvedValueOnce(['B', 'A'])
    expect(await getMatchIdsCached('p', 'EUW1', 10, 0, 'both')).toEqual(['A'])
    await vi.runAllTimersAsync()
    expect(await getMatchIdsCached('p', 'EUW1', 10, 0, 'both')).toEqual(['B', 'A'])
  })

  it('after a game is saved, the next read waits for the new list', async () => {
    getMatchIds.mockResolvedValueOnce(['A'])
    await getMatchIdsCached('p', 'EUW1', 10, 0, 'both')
    invalidateMatchIds()
    getMatchIds.mockResolvedValueOnce(['B', 'A'])
    expect(await getMatchIdsCached('p', 'EUW1', 10, 0, 'both')).toEqual(['B', 'A'])
  })

  it('a fetch started before the invalidation does not store its older list', async () => {
    let release!: (ids: string[]) => void
    getMatchIds.mockReturnValueOnce(new Promise((r) => { release = r }))
    const first = getMatchIdsCached('p', 'EUW1', 10, 0, 'both')
    invalidateMatchIds()
    release(['A'])
    await first
    getMatchIds.mockResolvedValueOnce(['B', 'A'])
    expect(await getMatchIdsCached('p', 'EUW1', 10, 0, 'both')).toEqual(['B', 'A'])
  })
})

describe('matchIdsCache — one list per account, kept on disk', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(2_000_000)
    getMatchIds.mockReset()
    invalidateMatchIds()
  })

  it('fetches 100 once and serves every smaller count from it', async () => {
    getMatchIds.mockResolvedValueOnce(Array.from({ length: 100 }, (_, i) => `M${i}`))
    expect(await getMatchIdsCached('p', 'EUW1', 10, 0, 'both')).toHaveLength(10)
    expect(await getMatchIdsCached('p', 'EUW1', 50, 0, 'both')).toHaveLength(50)
    expect(getMatchIds).toHaveBeenCalledTimes(1)
    expect(getMatchIds).toHaveBeenCalledWith('p', 'EUW1', 100, 0, 'both')
  })

  it('serves the saved lists after a restart without waiting for Riot', async () => {
    const { mkdtempSync, readFileSync, writeFileSync } = await import('fs')
    const { join } = await import('path')
    const { tmpdir } = await import('os')
    const file = join(mkdtempSync(join(tmpdir(), 'ids-')), 'cache.json')
    writeFileSync(file, JSON.stringify({ 'p|EUW1|100|0|both': { ids: ['A', 'B'], at: Date.now() - 5 * 60_000 } }))
    const { initMatchIdsPersistence } = await import('../../electron/main/matchIdsCache')
    initMatchIdsPersistence(file)
    getMatchIds.mockResolvedValueOnce(['C', 'A', 'B'])
    // Stale (5 min) but served at once, refreshed behind…
    expect(await getMatchIdsCached('p', 'EUW1', 10, 0, 'both')).toEqual(['A', 'B'])
    await vi.advanceTimersByTimeAsync(2_500)
    // …and the new list is saved for the next start.
    vi.useRealTimers()
    await new Promise((r) => setTimeout(r, 50))
    expect(JSON.parse(readFileSync(file, 'utf8'))['p|EUW1|100|0|both'].ids).toEqual(['C', 'A', 'B'])
  })
})
