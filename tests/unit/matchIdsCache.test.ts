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
