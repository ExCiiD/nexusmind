/** « Mon espace » (docs/DESIGN_STATE.md § 16): pure helpers. Tested. */
import type { Announcement } from './announcements'

/** The pinned announcements first, then the newest. */
export function sortAnnouncements<A extends Pick<Announcement, 'pinned' | 'createdAt'>>(list: readonly A[]): A[] {
  return [...list].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt.localeCompare(a.createdAt))
}
