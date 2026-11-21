import { describe, it, expect } from 'vitest'
import { HIDDEN_EVENTS_KEY, readHiddenEvents, toggleHidden } from '../../src/lib/playerLayers'

const memory = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init))
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) }, removeItem: (k: string) => { m.delete(k) }, m }
}
const ALL = ['kill', 'death', 'assist', 'plate'] as const

// Beta.20: the filter chips — a pressed chip clicked again hides its events, clicked once more shows them.
describe('player filter chips', () => {
  it('toggles a type in and out of the hidden ones', () => {
    const once = toggleHidden(new Set<string>(), 'kill')
    expect([...once]).toEqual(['kill'])
    expect([...toggleHidden(once, 'kill')]).toEqual([])
  })
  it('reads the hidden types, nothing hidden by default', () => {
    expect([...readHiddenEvents(ALL, memory())]).toEqual([])
    expect([...readHiddenEvents(ALL, memory({ [HIDDEN_EVENTS_KEY]: '["death","nope"]' }))]).toEqual(['death'])
  })
  it('turns the old « only these types » list into hidden types once, and removes it', () => {
    const s = memory({ 'nm.player.eventFilter': '["kill","death"]' })
    expect([...readHiddenEvents(ALL, s)]).toEqual(['assist', 'plate'])
    expect(s.m.has('nm.player.eventFilter')).toBe(false)
    expect(s.m.get(HIDDEN_EVENTS_KEY)).toBe('["assist","plate"]')
  })
})
