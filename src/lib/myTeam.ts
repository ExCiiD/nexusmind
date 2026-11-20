/**
 * What the team gives a player, across all their groups (docs/AUDIT_LIAISONS.md L2-L6, user's choice of 20/11/2026):
 * the Dashboard and Mon plan show it next to the player's own practice. Computed in myTeamCore.ts, shared by the desktop
 * and the web. A player without a group gets nothing (null or empty lists), never an error.
 * Already covered elsewhere: the assigned objectives (collabListAssignments, L2) and the coach's verdicts on micro-review
 * answers (microReviewCloudMyVerdicts, with their matchId, L3).
 */

/** L5: the next Planning event that concerns me, with my answer. */
export interface MyNextEvent {
  eventId: string
  groupId: string
  groupName: string | null
  kind: string
  title: string
  startsAt: string
  endsAt: string
  /** My answer to the event, null when I have not answered. */
  myResponse: 'confirmed' | 'declined' | null
  /** The team session of the event, when it has one. */
  sessionId: string | null
  /** At least one objective is set for its session ("Préparation prête"). */
  prepReady: boolean
}

/** L4: a task given to me. */
export interface MyTask {
  id: string
  groupId: string
  groupName: string | null
  title: string
  dueDate: string | null
  /** Past its due date (today not included). */
  overdue: boolean
}

/** L2: my objectives for a coming (or live) team session. */
export interface MySessionObjectives {
  sessionId: string
  calendarEventId: string | null
  groupId: string
  title: string
  startsAt: string | null
  status: 'scheduled' | 'live'
  objectiveIds: string[]
  kpiIds: string[]
  note: string | null
}

/** L6: an action to work on from a VOD review I am assigned to. */
export interface MyVodActionItem {
  id: string
  vodSessionId: string
  groupId: string
  vodTitle: string
  text: string
  done: boolean
  createdAt: string
}

export interface MyTeamApi {
  myNextEvent: () => Promise<MyNextEvent | null>
  /** Open tasks given to me, the soonest due first (no due date last). */
  myOpenTasks: () => Promise<MyTask[]>
  /** My objectives for the sessions not ended yet, the soonest first. Empty before migration 20261120170000. */
  mySessionObjectives: () => Promise<MySessionObjectives[]>
  /** The actions of the VOD reviews I am assigned to, open ones only unless `all`. */
  myVodActionItems: (all?: boolean) => Promise<MyVodActionItem[]>
}
