/** Renderer-side mirror of the shared dev-plan tables (E3). */

export type AxisStatus = 'active' | 'done' | 'dropped'

export interface DevPlanProgress {
  playerMarkedDone: boolean
  playerNote: string | null
  updatedAt: string
}

export interface DevPlanAxis {
  id: string
  planId: string
  fundamentalId: string
  targetText: string
  position: 1 | 2 | 3
  status: AxisStatus
  progress: DevPlanProgress | null
  createdAt: string
  updatedAt: string
}

export interface DevPlanCheckin {
  id: string
  planId: string
  note: string
  createdBy: string
  createdAt: string
}

export interface DevPlan {
  id: string
  groupId: string
  playerId: string
  title: string
  periodStart: string | null
  periodEnd: string | null
  axes: DevPlanAxis[]
  checkins: DevPlanCheckin[]
  createdAt: string
  updatedAt: string
}

export interface NewAxisInput {
  fundamentalId: string
  targetText: string
  position: 1 | 2 | 3
}

/**
 * All of this is server-only (no local Prisma data involved, unlike the
 * team-publish flow), so desktop and web implement every method the same
 * way — nothing here is platform-specific.
 */
export interface DevPlanApi {
  /** The signed-in player's own plan for a group (null if staff has not made one, or the caller is staff checking their own — expected). */
  devPlanGetMine: (groupId: string) => Promise<DevPlan | null>
  /** Staff only (RLS-enforced); returns null if no plan exists yet for that player. */
  devPlanGetForPlayer: (groupId: string, playerId: string) => Promise<DevPlan | null>
  devPlanCreate: (groupId: string, playerId: string, title: string, axes: NewAxisInput[]) => Promise<string>
  devPlanSetAxisStatus: (axisId: string, status: AxisStatus) => Promise<void>
  devPlanAddCheckin: (planId: string, note: string) => Promise<void>
  /** The player marking their own progress — RLS enforces "own plan only", so this is safe to expose to every role. */
  devPlanSetProgress: (axisId: string, input: { playerMarkedDone?: boolean; playerNote?: string | null }) => Promise<void>
}
