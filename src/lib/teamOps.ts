/** Renderer-side mirror of the shared team-ops tables (E7). Announcements
 *  moved to src/lib/announcements.ts in Phase 2 of the Planning rework
 *  (docs/PLAN_GESTION_EQUIPE.md §9) — Tasks and StaffNotes stay here. */

export type TaskStatus = 'open' | 'done'

export interface Task {
  id: string
  groupId: string
  title: string
  assigneeId: string | null
  dueDate: string | null
  status: TaskStatus
  createdBy: string
  createdAt: string
  updatedAt: string
}

export interface NewTaskInput {
  title: string
  assigneeId?: string | null
  dueDate?: string | null
}

export interface StaffNote {
  id: string
  groupId: string
  playerId: string
  body: string
  createdBy: string
  createdAt: string
  updatedAt: string
}

/**
 * All of this is server-only (no local Prisma data), so desktop and web
 * implement every method the same way — same pattern as devPlan.ts.
 */
export interface TeamOpsApi {
  tasksList: (groupId: string) => Promise<Task[]>
  tasksCreate: (groupId: string, input: NewTaskInput) => Promise<string>
  tasksSetStatus: (id: string, status: TaskStatus) => Promise<void>
  tasksDelete: (id: string) => Promise<void>

  /** Staff only (RLS-enforced); the player this is about never sees these. */
  staffNotesList: (groupId: string, playerId: string) => Promise<StaffNote[]>
  staffNotesAdd: (groupId: string, playerId: string, body: string) => Promise<void>
  staffNotesDelete: (id: string) => Promise<void>
}
