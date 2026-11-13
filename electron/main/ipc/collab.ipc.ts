import { z } from 'zod'
import { validatedHandle } from './validate'
import * as collab from '../cloud/collab'

const uuid = z.string().uuid()
const recordId = z.string().min(1).max(128)
const role = z.enum(['coach', 'analyst', 'player'])
const objectiveId = z.string().min(1).max(64)

export function registerCollabHandlers() {
  validatedHandle('collab:list-groups', z.tuple([]), () => collab.listMyGroups())
  validatedHandle('collab:create-group', z.tuple([z.string().trim().min(1).max(80), z.enum(['team', 'coaching'])]),
    (_e, name, kind) => collab.createGroup(name, kind))
  validatedHandle('collab:create-invite', z.tuple([uuid, role, z.number().int().min(1).max(30)]),
    (_e, groupId, r, days) => collab.createInvite(groupId, r, days))
  validatedHandle('collab:join', z.tuple([z.string().trim().toUpperCase().regex(/^[A-Z0-9]{6,16}$/, 'invalid code')]),
    (_e, code) => collab.joinGroup(code))
  validatedHandle('collab:leave', z.tuple([uuid]), (_e, groupId) => collab.leaveGroup(groupId))
  validatedHandle('collab:delete-group', z.tuple([uuid, z.literal('DELETE')]), (_e, groupId) => collab.deleteGroup(groupId))
  validatedHandle('collab:remove-member', z.tuple([uuid, uuid]), (_e, groupId, userId) => collab.removeMember(groupId, userId))
  validatedHandle('collab:set-sharing', z.tuple([uuid, z.object({ shareReviews: z.boolean(), shareStats: z.boolean(), shareTeam: z.boolean() })]),
    (_e, groupId, s) => collab.setSharing(groupId, s))

  validatedHandle('collab:player-sessions', z.tuple([uuid]), (_e, playerId) => collab.getPlayerSessions(playerId))

  validatedHandle('collab:list-comments', z.tuple([recordId, uuid.optional()]),
    (_e, reviewId, playerId) => collab.listComments(reviewId, playerId))
  validatedHandle('collab:my-open-comments', z.tuple([]), () => collab.listMyOpenComments())
  validatedHandle('collab:add-comment', z.tuple([z.object({
    groupId: uuid,
    playerId: uuid.optional(),
    reviewId: recordId,
    gameId: recordId.nullable().optional(),
    parentId: uuid.nullable().optional(),
    videoTimeSec: z.number().int().min(0).max(36000).nullable().optional(),
    body: z.string().trim().min(1).max(4000),
  })]), (_e, c) => collab.addComment(c))
  validatedHandle('collab:resolve-comment', z.tuple([uuid, z.boolean()]), (_e, id, resolved) => collab.setCommentResolved(id, resolved))
  validatedHandle('collab:delete-comment', z.tuple([uuid]), (_e, id) => collab.deleteComment(id))

  validatedHandle('collab:list-assignments', z.tuple([uuid.optional(), z.boolean().optional()]),
    (_e, playerId, onlyOpen) => collab.listAssignments(playerId, onlyOpen ?? true))
  validatedHandle('collab:assign-objective', z.tuple([z.object({
    groupId: uuid,
    playerId: uuid,
    objectiveIds: z.array(objectiveId).min(1).max(3),
    kpiIds: z.array(z.string().min(1).max(64)).max(20).optional(),
    note: z.string().max(1000).nullable().optional(),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  })]), (_e, a) => collab.assignObjective(a))
  validatedHandle('collab:set-assignment-status', z.tuple([uuid, z.enum(['open', 'done', 'dismissed'])]),
    (_e, id, status) => collab.setAssignmentStatus(id, status))

  validatedHandle('collab:staff-dashboard', z.tuple([uuid]), (_e, groupId) => collab.getStaffDashboard(groupId))
}
