import { describe, expect, it } from 'vitest'
import { createMemoryRouter } from 'react-router-dom'
import { LAB_DEFAULTS, parseLabParams, patchLabParams } from '@/lib/mistakeLabUrl'
import { backTarget } from '@/lib/backNav'

const router = (entry: string) => createMemoryRouter([{ path: '*', element: null }], { initialEntries: [entry] })

describe('Mistake Lab state in the URL', () => {
  it('defaults stay out of the URL and read back as the defaults', () => {
    expect(patchLabParams(new URLSearchParams(), {}).toString()).toBe('')
    expect(parseLabParams(new URLSearchParams())).toEqual(LAB_DEFAULTS)
    const sp = patchLabParams(new URLSearchParams('d=14&tier=fatal'), { days: 30, tier: 'all' })
    expect(sp.toString()).toBe('')
  })
  it('every part of the state survives a write and a read', () => {
    const state = { days: 90, role: 'JUNGLE', champion: 'Lee Sin', family: 'deaths', tier: 'critical', sort: 'severity', focus: 'bad-trade', showAll: true } as const
    const sp = patchLabParams(new URLSearchParams(), state)
    expect(parseLabParams(new URLSearchParams(sp.toString()))).toEqual(state)
  })
  it('ignores invalid values and keeps params that are not the Lab\'s', () => {
    expect(parseLabParams(new URLSearchParams('d=12&fam=zzz&tier=x&sort=y&role=Q')).days).toBe(30)
    expect(parseLabParams(new URLSearchParams('d=12&fam=zzz&tier=x&sort=y&role=Q'))).toMatchObject({ family: 'all', tier: 'all', sort: 'frequency', role: '' })
    expect(patchLabParams(new URLSearchParams('keep=1'), { focus: 'x' }).get('keep')).toBe('1')
  })
})

describe('Lab → Record → back', () => {
  it('returns to the Lab with the same state (selected mistake, filters, period, expanded list)', async () => {
    const r = router('/stats/mistakes')
    // The user changes filters and picks « Bad trade »: each change replaces the entry.
    for (const patch of [{ days: 14 as const }, { family: 'mechanics' as const }, { tier: 'fatal' as const }, { focus: 'bad-trade' }, { showAll: true }]) {
      const cur = new URLSearchParams(r.state.location.search)
      await r.navigate(`/stats/mistakes?${patchLabParams(cur, patch).toString()}`, { replace: true })
    }
    const labUrl = r.state.location.pathname + r.state.location.search
    expect(parseLabParams(new URLSearchParams(r.state.location.search))).toMatchObject({ days: 14, family: 'mechanics', tier: 'fatal', focus: 'bad-trade', showAll: true })

    await r.navigate('/record/rec1?at=312') // « Rewatch »
    expect(r.state.location.pathname).toBe('/record/rec1')
    expect(backTarget(r.state.location.key, '/record')).toBe(-1)

    await r.navigate(-1) // the app's back button, or the mouse's
    expect(r.state.location.pathname + r.state.location.search).toBe(labUrl)
    expect(r.state.historyAction).toBe('POP')
  })
  it('filter clicks do not pile up behind the back button', async () => {
    const r = router('/stats/mistakes')
    await r.navigate('/stats/mistakes?d=7', { replace: true })
    await r.navigate('/stats/mistakes?d=7&tier=fatal', { replace: true })
    await r.navigate('/record/rec1?at=5')
    await r.navigate(-1)
    expect(r.state.location.search).toBe('?d=7&tier=fatal')
    await r.navigate(-1) // nothing before the Lab: still the Lab
    expect(r.state.location.pathname).toBe('/stats/mistakes')
  })
  it('a Record page opened directly falls back to the Record hub', () => {
    const r = router('/record/rec1?at=10')
    expect(r.state.location.key).toBe('default')
    expect(backTarget(r.state.location.key, '/record')).toBe('/record')
    expect(backTarget(undefined, '/record')).toBe('/record')
  })
  it('the same goes for a sheet\'s objective filter and selected game (session stats → Record → back)', async () => {
    const r = router('/team-session/ev1/player/u1?game=2')
    await r.navigate('/team-session/ev1/player/u1?game=2&obj=dragon&objAll=1', { replace: true })
    await r.navigate('/record/rec9?at=560')
    await r.navigate(-1)
    expect(r.state.location.pathname + r.state.location.search).toBe('/team-session/ev1/player/u1?game=2&obj=dragon&objAll=1')
  })
})
