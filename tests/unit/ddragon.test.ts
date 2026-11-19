import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getDdragonVersion, knownDdragonVersion, resetDdragonVersionForTests, DDRAGON_FALLBACK_VERSION } from '../../src/lib/ddragon'

// T (L07): one shared versions.json request, however many icons ask at once.
const store = new Map<string, string>()

beforeEach(() => {
  resetDdragonVersionForTests()
  store.clear()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v) },
  })
})
afterEach(() => { vi.unstubAllGlobals() })

describe('getDdragonVersion', () => {
  it('sends one request for 170 simultaneous callers, then none', async () => {
    const fetchMock = vi.fn(async () => ({ json: async () => ['16.1.1', '15.24.1'] }))
    vi.stubGlobal('fetch', fetchMock)
    const all = await Promise.all(Array.from({ length: 170 }, () => getDdragonVersion()))
    expect(new Set(all)).toEqual(new Set(['16.1.1']))
    expect(await getDdragonVersion()).toBe('16.1.1')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('remembers the version for the next launch', async () => {
    vi.stubGlobal('fetch', async () => ({ json: async () => ['16.1.1'] }))
    expect(knownDdragonVersion()).toBeNull()
    await getDdragonVersion()
    resetDdragonVersionForTests() // a new launch
    expect(knownDdragonVersion()).toBe('16.1.1')
  })

  it('offline: the last known version, else the fallback', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('offline') })
    expect(await getDdragonVersion()).toBe(DDRAGON_FALLBACK_VERSION)
    resetDdragonVersionForTests()
    store.set('ascend:ddragon-version', '15.20.1')
    expect(await getDdragonVersion()).toBe('15.20.1')
  })
})
