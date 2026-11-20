import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearQueryCache, fetchInto, getEntry, invalidateCached, isStale, setCached, subscribe } from '../../src/lib/queryCache'

describe('queryCache', () => {
  beforeEach(() => clearQueryCache())

  it('keeps the data and shares one fetch per key', async () => {
    const fetcher = vi.fn(async () => [1, 2])
    const [a, b] = await Promise.all([fetchInto('k', fetcher), fetchInto('k', fetcher)])
    expect(a).toEqual([1, 2])
    expect(b).toBe(a)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(getEntry('k')?.data).toEqual([1, 2])
  })

  it('keeps the old data while a refresh runs and after a failed one', async () => {
    setCached('k', 'old')
    const p = fetchInto('k', async () => { throw new Error('offline') })
    expect(getEntry('k')?.data).toBe('old')
    await expect(p).rejects.toThrow('offline')
    expect(getEntry('k')?.data).toBe('old')
  })

  it('is stale when empty, old or invalidated, and not right after a failure', async () => {
    expect(isStale(undefined, 1000)).toBe(true)
    setCached('k', 1, 10_000)
    expect(isStale(getEntry('k'), 1000, 10_500)).toBe(false)
    expect(isStale(getEntry('k'), 1000, 11_000)).toBe(true)
    invalidateCached('k')
    expect(isStale(getEntry('k'), 1000, 10_500)).toBe(true)
    await fetchInto('e', async () => { throw new Error('x') }, () => 20_000).catch(() => {})
    expect(isStale(getEntry('e'), 1000, 20_500)).toBe(false)
    expect(isStale(getEntry('e'), 1000, 21_000)).toBe(true)
  })

  it('invalidates by prefix and tells the subscribers', () => {
    setCached('games:a', 1)
    setCached('games:b', 2)
    setCached('staff:c', 3)
    const seen: string[] = []
    subscribe('games:a', () => seen.push('a'))
    subscribe('staff:c', () => seen.push('c'))
    invalidateCached('games:')
    expect(getEntry('games:a')?.at).toBe(0)
    expect(getEntry('games:b')?.at).toBe(0)
    expect(getEntry('staff:c')?.at).toBeGreaterThan(0)
    expect(seen).toEqual(['a'])
  })
})
