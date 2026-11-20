import { sb, currentUserId } from './supabase'
import * as myTeam from '@/lib/myTeamCore'
import type { MyTeamApi } from '@/lib/myTeam'

/**
 * What my groups give me, web side (docs/AUDIT_LIAISONS.md L2-L6, types in src/lib/myTeam.ts): the same core as the
 * desktop (electron/main/cloud/teamSessions.ts). Spread into the web's window.api (web/src/api.ts) like analystWebApi.
 */
export const myTeamWebApi: MyTeamApi = {
  myNextEvent: async () => myTeam.getMyNextEvent(sb, await currentUserId()),
  myOpenTasks: async () => myTeam.listMyOpenTasks(sb, await currentUserId()),
  mySessionObjectives: async () => myTeam.listMySessionObjectives(sb, await currentUserId()),
  myVodActionItems: async (all) => myTeam.listMyVodActionItems(sb, await currentUserId(), all ?? false),
}
