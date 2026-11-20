import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { create } from 'zustand'
import type { Group } from '@/lib/collab'
import { isLegacyStaff } from '@/lib/permissions'
import { forgetSavedGroups, readSavedGroups, saveGroups } from '@/lib/collabPersist'
import type { CloudStatus } from '@/lib/ipc'

/** A user's display name; a NULL or unknown id (former member) gets the
 *  translated "Former member" label. Author ids become nullable with #29/#33. */
export type NameOf = (userId: string | null | undefined) => string

interface CollabState {
  myUserId: string | null
  groups: Group[]
  available: boolean
  loading: boolean
  /** True once a first load was started (by any caller). */
  started: boolean
}

/**
 * Shared store (task I, part B): every useCollab() caller reads the same
 * state, so the app loads `cloudStatus` + `collabListGroups` once instead of
 * once per mounted hook (13 callers). `reload()` refreshes all of them;
 * concurrent calls share one in-flight request.
 *
 * Perf gain 4: the store starts from the last group list (saved per cloud account, src/lib/collabPersist.ts), so
 * Management, Lobby and Coaching show at once; the start-up load (one collab:bootstrap call) then confirms the
 * account and refreshes it. Another account or a sign-out drops the saved list.
 */
function initialState(): CollabState {
  const saved = readSavedGroups()
  return saved
    ? { myUserId: saved.uid, groups: saved.groups, available: true, loading: false, started: false }
    : { myUserId: null, groups: [], available: false, loading: true, started: false }
}
const useCollabStore = create<CollabState>(initialState)

let inFlight: Promise<void> | null = null
let authSubscribed = false

function loadCollab(): Promise<void> {
  if (inFlight) return inFlight
  useCollabStore.setState({ started: true })
  inFlight = (async () => {
    try {
      // One call (status + groups) where the API has it; else the two reads in turn.
      const boot = await window.api.collabBootstrap?.()
      const status: CloudStatus = boot?.status ?? await window.api.cloudStatus()
      if (!status.configured || !status.user) {
        forgetSavedGroups()
        useCollabStore.setState({ available: false, myUserId: null, groups: [] })
        return
      }
      const uid = status.user.id
      const prev = useCollabStore.getState()
      // Never another account's list, not even for a moment.
      if (prev.myUserId !== uid) useCollabStore.setState({ groups: [] })
      useCollabStore.setState({ myUserId: uid, available: true })
      let groups: Group[] | null
      try {
        groups = boot ? boot.groups : await window.api.collabListGroups()
      } catch {
        groups = null
      }
      if (groups) {
        saveGroups(uid, groups)
        useCollabStore.setState({ groups })
      } else if (prev.myUserId !== uid) {
        // Unreadable now: this account's saved list is gone above; nothing to show.
        useCollabStore.setState({ groups: [] })
      }
      // Unreadable (offline): the list already shown stays.
    } catch {
      // The status itself failed (offline auth): keep what is shown; the saved list is this account's.
      if (!useCollabStore.getState().myUserId) useCollabStore.setState({ groups: [] })
    } finally {
      useCollabStore.setState({ loading: false })
      inFlight = null
    }
  })()
  return inFlight
}

/** Explicit refresh (after a mutation): waits for any load already running, then loads again, so the result is fresh. */
function reloadCollab(): Promise<void> {
  return inFlight ? inFlight.then(loadCollab) : loadCollab()
}

/** Sign-in / sign-out: the groups belong to another account (or none). */
function subscribeAuthOnce() {
  if (authSubscribed || typeof window.api?.onCloudAuthChanged !== 'function') return
  authSubscribed = true
  window.api.onCloudAuthChanged((user) => {
    const current = useCollabStore.getState().myUserId
    if ((user?.id ?? null) === current) return
    // Signed out or another account: the shown and saved lists are not theirs.
    forgetSavedGroups()
    useCollabStore.setState({ myUserId: user?.id ?? null, groups: [], available: !!user })
    void reloadCollab()
  })
}

/** Perf gain 4: starts the cloud load at app start (App.tsx), before any screen asks for it. */
export function startCollab() {
  subscribeAuthOnce()
  if (!useCollabStore.getState().started) void loadCollab()
}

/**
 * Current cloud user + their groups, and a name resolver for comment authors.
 * `available` is false when the build has no cloud backend or nobody is signed in.
 */
export function useCollab() {
  const { t } = useTranslation()
  const myUserId = useCollabStore((s) => s.myUserId)
  const groups = useCollabStore((s) => s.groups)
  const available = useCollabStore((s) => s.available)
  const loading = useCollabStore((s) => s.loading)

  useEffect(() => { startCollab() }, [])

  // #29/#33: content written by someone who left (account deleted, or no
  // longer in any of my groups) has a NULL / unknown author → "Former member".
  // While the groups are still loading, show nothing rather than a wrong label.
  const nameOf = useMemo<NameOf>(() => {
    const names = new Map<string, string>()
    for (const g of groups) for (const m of g.members) names.set(m.userId, m.displayName || m.riotId || t('common.formerMember'))
    return (userId) => (userId && names.get(userId)) || (loading ? '' : t('common.formerMember'))
  }, [groups, loading, t])

  // "Legacy" staff (owner/coach/analyst) — dev plans, staff dashboard, weekly
  // reports, trials, player management: none of this is calendar/session
  // scoped, so `manager` deliberately does NOT get it (see src/lib/permissions.ts).
  const staffGroups = useMemo(() => groups.filter((g) => isLegacyStaff(g.myRole, g.myStaffRoles)), [groups])

  return { available, loading, myUserId, groups, staffGroups, nameOf, reload: reloadCollab }
}
