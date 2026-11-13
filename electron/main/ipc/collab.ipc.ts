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

  const fundamentalId = z.string().min(1).max(64)
  const axisInput = z.object({ fundamentalId, targetText: z.string().trim().min(1).max(500), position: z.union([z.literal(1), z.literal(2), z.literal(3)]) })
  const axisStatus = z.enum(['active', 'done', 'dropped'])

  validatedHandle('devplan:get-mine', z.tuple([uuid]), (_e, groupId) => collab.devPlanGetMine(groupId))
  validatedHandle('devplan:get-for-player', z.tuple([uuid, uuid]), (_e, groupId, playerId) => collab.devPlanGetForPlayer(groupId, playerId))
  validatedHandle('devplan:create', z.tuple([uuid, uuid, z.string().trim().min(1).max(80), z.array(axisInput).min(1).max(3)]),
    (_e, groupId, playerId, title, axes) => collab.devPlanCreate(groupId, playerId, title, axes))
  validatedHandle('devplan:set-axis-status', z.tuple([uuid, axisStatus]), (_e, axisId, status) => collab.devPlanSetAxisStatus(axisId, status))
  validatedHandle('devplan:add-checkin', z.tuple([uuid, z.string().trim().min(1).max(4000)]), (_e, planId, note) => collab.devPlanAddCheckin(planId, note))
  validatedHandle('devplan:set-progress', z.tuple([uuid, z.object({
    playerMarkedDone: z.boolean().optional(),
    playerNote: z.string().max(1000).nullable().optional(),
  })]), (_e, axisId, input) => collab.devPlanSetProgress(axisId, input))

  const isoDate = z.string().datetime()
  const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
  const timeOnly = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
  const eventKind = z.enum(['tournament', 'team_review', 'one_on_one', 'soloq_block', 'rest', 'other'])
  const eventInput = z.object({ kind: eventKind, title: z.string().trim().min(1).max(120), startsAt: isoDate, endsAt: isoDate, notes: z.string().max(2000).nullable().optional() })

  validatedHandle('calendar:list-events', z.tuple([uuid, isoDate, isoDate]), (_e, groupId, from, to) => collab.calendarListEvents(groupId, from, to))
  validatedHandle('calendar:create-event', z.tuple([uuid, eventInput]), (_e, groupId, input) => collab.calendarCreateEvent(groupId, input))
  validatedHandle('calendar:update-event', z.tuple([uuid, eventInput]), (_e, id, input) => collab.calendarUpdateEvent(id, input))
  validatedHandle('calendar:delete-event', z.tuple([uuid]), (_e, id) => collab.calendarDeleteEvent(id))

  const ruleInput = z.object({ weekday: z.number().int().min(0).max(6), startTime: timeOnly, endTime: timeOnly })
  validatedHandle('availability:list-rules', z.tuple([uuid]), (_e, groupId) => collab.availabilityListRules(groupId))
  validatedHandle('availability:set-rule', z.tuple([uuid, ruleInput]), (_e, groupId, input) => collab.availabilitySetRule(groupId, input))
  validatedHandle('availability:delete-rule', z.tuple([uuid]), (_e, id) => collab.availabilityDeleteRule(id))

  const exceptionInput = z.object({
    date: dateOnly, available: z.boolean(), startTime: timeOnly.nullable().optional(), endTime: timeOnly.nullable().optional(),
    note: z.string().max(500).nullable().optional(),
  })
  validatedHandle('availability:list-exceptions', z.tuple([uuid, dateOnly, dateOnly]), (_e, groupId, from, to) => collab.availabilityListExceptions(groupId, from, to))
  validatedHandle('availability:set-exception', z.tuple([uuid, exceptionInput]), (_e, groupId, input) => collab.availabilitySetException(groupId, input))
  validatedHandle('availability:delete-exception', z.tuple([uuid]), (_e, id) => collab.availabilityDeleteException(id))
}
