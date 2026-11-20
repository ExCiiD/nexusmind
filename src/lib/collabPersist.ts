/**
 * Perf gain 4 (docs/AUDIT_PERF_2.md): my last group list, kept from one session to the next so Management, Lobby and
 * Coaching show at once at start-up, then refresh. One entry, tied to the cloud account that read it: the app only
 * seeds from it for that account (another account, a sign-out or a wrong shape drops it). Pure, tested.
 */
import type { Group } from './collab'

export const COLLAB_GROUPS_STORAGE_KEY = 'ascend:collab-groups:v1'

interface Saved {
  uid: string
  groups: Group[]
}

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>

function storage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null }
}

/** The saved entry, or null when missing or corrupted. */
export function readSavedGroups(store: Storage | null = storage()): Saved | null {
  try {
    const raw = store?.getItem(COLLAB_GROUPS_STORAGE_KEY)
    if (!raw) return null
    const v = JSON.parse(raw) as Partial<Saved>
    if (typeof v?.uid !== 'string' || !v.uid || !Array.isArray(v.groups)) return null
    if (!v.groups.every((g) => g && typeof g.id === 'string' && Array.isArray(g.members))) return null
    return { uid: v.uid, groups: v.groups }
  } catch {
    return null
  }
}

/** The groups saved for `uid`, or null (none, or saved by another account). */
export function savedGroupsFor(uid: string | null, store: Storage | null = storage()): Group[] | null {
  if (!uid) return null
  const saved = readSavedGroups(store)
  return saved && saved.uid === uid ? saved.groups : null
}

export function saveGroups(uid: string, groups: Group[], store: Storage | null = storage()) {
  try { store?.setItem(COLLAB_GROUPS_STORAGE_KEY, JSON.stringify({ uid, groups })) } catch { /* full or private mode: memory only */ }
}

/** Sign-out, or another account: the saved list is not theirs. */
export function forgetSavedGroups(store: Storage | null = storage()) {
  try { store?.removeItem(COLLAB_GROUPS_STORAGE_KEY) } catch { /* nothing to drop */ }
}
