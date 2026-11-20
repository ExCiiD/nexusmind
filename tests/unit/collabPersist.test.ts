import { describe, it, expect } from 'vitest'
import { COLLAB_GROUPS_STORAGE_KEY, forgetSavedGroups, readSavedGroups, saveGroups, savedGroupsFor } from '../../src/lib/collabPersist'
import type { Group } from '../../src/lib/collab'

function memoryStore() {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) }, removeItem: (k: string) => { m.delete(k) } }
}
const group = { id: 'g1', name: 'Team', members: [] } as unknown as Group

// Perf gain 4: the last group list, shown at start-up for the same account only.
describe('saved collab groups', () => {
  it('gives the list back to the account that saved it, never to another', () => {
    const s = memoryStore()
    saveGroups('u1', [group], s)
    expect(savedGroupsFor('u1', s)).toEqual([group])
    expect(savedGroupsFor('u2', s)).toBeNull()
    expect(savedGroupsFor(null, s)).toBeNull()
  })
  it('drops it on sign-out', () => {
    const s = memoryStore()
    saveGroups('u1', [group], s)
    forgetSavedGroups(s)
    expect(readSavedGroups(s)).toBeNull()
  })
  it('ignores a corrupted entry', () => {
    const s = memoryStore()
    s.setItem(COLLAB_GROUPS_STORAGE_KEY, '{oops')
    expect(readSavedGroups(s)).toBeNull()
    s.setItem(COLLAB_GROUPS_STORAGE_KEY, JSON.stringify({ uid: 'u1', groups: [{ id: 1 }] }))
    expect(readSavedGroups(s)).toBeNull()
    s.setItem(COLLAB_GROUPS_STORAGE_KEY, JSON.stringify({ groups: [] }))
    expect(readSavedGroups(s)).toBeNull()
  })
})
