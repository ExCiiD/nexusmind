import { create } from 'zustand'

const KEY = 'ascend_active_group'

/**
 * The group the Coaching & Management and Stats collectives pages show,
 * picked once in either page's header (GroupSwitcher) for every tab of both.
 * Remembered on this device.
 */
interface ActiveGroupState {
  groupId: string | null
  setGroupId: (groupId: string | null) => void
}

export const useActiveGroupStore = create<ActiveGroupState>((set) => ({
  groupId: (() => { try { return localStorage.getItem(KEY) } catch { return null } })(),
  setGroupId: (groupId) => {
    try {
      if (groupId) localStorage.setItem(KEY, groupId)
      else localStorage.removeItem(KEY)
    } catch { /* per-device preference */ }
    set({ groupId })
  },
}))

/** The active group among `groups`: the one picked, else the first. */
export function resolveActiveGroup<T extends { id: string }>(groups: T[], groupId: string | null): T | null {
  return groups.find((g) => g.id === groupId) ?? groups[0] ?? null
}
