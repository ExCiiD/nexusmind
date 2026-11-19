import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { create } from 'zustand'
import type { Group } from '@/lib/collab'
import { isLegacyStaff } from '@/lib/permissions'

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
 */
const useCollabStore = create<CollabState>(() => ({ myUserId: null, groups: [], available: false, loading: true, started: false }))

let inFlight: Promise<void> | null = null
let authSubscribed = false

function loadCollab(): Promise<void> {
  if (inFlight) return inFlight
  useCollabStore.setState({ started: true })
  inFlight = (async () => {
    try {
      const status = await window.api.cloudStatus()
      if (!status.configured || !status.user) {
        useCollabStore.setState({ available: false, myUserId: null, groups: [] })
        return
      }
      useCollabStore.setState({ myUserId: status.user.id, available: true })
      useCollabStore.setState({ groups: await window.api.collabListGroups() })
    } catch {
      useCollabStore.setState({ groups: [] })
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
    if ((user?.id ?? null) !== current) void loadCollab()
  })
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

  useEffect(() => {
    subscribeAuthOnce()
    if (!useCollabStore.getState().started) void loadCollab()
  }, [])

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
  const staffGroups = useMemo(() => groups.filter((g) => isLegacyStaff(g.myRole)), [groups])

  return { available, loading, myUserId, groups, staffGroups, nameOf, reload: reloadCollab }
}
