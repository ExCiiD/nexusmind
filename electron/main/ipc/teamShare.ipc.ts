import { z } from 'zod'
import { validatedHandle } from './validate'
import * as teamShare from '../cloud/teamShare'

const uuid = z.string().uuid()

export function registerTeamShareHandlers() {
  validatedHandle('team:publish-to-group', z.tuple([uuid, z.string().min(1).max(64)]),
    (_e, groupId, teamId) => teamShare.publishTeamToGroup(groupId, teamId))
  validatedHandle('team:get-shared', z.tuple([uuid]),
    (_e, groupId) => teamShare.getSharedTeam(groupId))
}
