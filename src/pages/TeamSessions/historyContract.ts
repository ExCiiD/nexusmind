/**
 * Team sessions history (docs/DESIGN_STATE.md § 15, contract docs/contracts/team-session-history.md): the Back-end's
 * types, and its window.api methods typed for the screens. Each method is optional (absent until the build has it):
 * the screens guard every call.
 */
import type { TeamSessionHistoryApi } from '@/lib/teamSessionHistory'

export type * from '@/lib/teamSessionHistory'

export const historyApi = (): Partial<TeamSessionHistoryApi> => window.api as unknown as Partial<TeamSessionHistoryApi>
