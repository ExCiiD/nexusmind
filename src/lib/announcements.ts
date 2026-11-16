/** Renderer-side mirror of the `announcements` table (E7, moved into
 *  Planning's permission model in Phase 1's §9). */

export interface Announcement {
  id: string
  groupId: string
  title: string
  body: string
  pinned: boolean
  createdBy: string
  createdAt: string
  updatedAt: string
}

export interface NewAnnouncementInput {
  title: string
  body: string
  pinned?: boolean
}

/** One row per (announcement, user) once that user has explicitly closed
 *  the persistent bubble for it — see AnnouncementBubbleStack.tsx. */
export interface AnnouncementDismissal {
  announcementId: string
  userId: string
  dismissedAt: string
}

/**
 * Server-only (no local Prisma data), so desktop and web implement every
 * method the same way — same pattern as calendar.ts.
 */
export interface AnnouncementsApi {
  announcementsList: (groupId: string) => Promise<Announcement[]>
  announcementsCreate: (groupId: string, input: NewAnnouncementInput) => Promise<string>
  announcementsSetPinned: (id: string, pinned: boolean) => Promise<void>
  announcementsDelete: (id: string) => Promise<void>
  /** All of the caller's own dismissals across every group they're in — a
   *  small, cheap read done once per session rather than per group. */
  announcementsListMyDismissals: () => Promise<AnnouncementDismissal[]>
  announcementsDismiss: (announcementId: string) => Promise<void>
}
