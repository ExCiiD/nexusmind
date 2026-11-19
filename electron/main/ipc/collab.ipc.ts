import { z } from 'zod'
import { validatedHandle } from './validate'
import * as collab from '../cloud/collab'
import { GROUP_LOGO_MAX_BYTES, LOOK_ID } from '../../../src/lib/collabCore'

const uuid = z.string().uuid()
const recordId = z.string().min(1).max(128)
const role = z.enum(['coach', 'manager', 'analyst', 'player'])
const objectiveId = z.string().min(1).max(64)

export function registerCollabHandlers() {
  validatedHandle('collab:list-groups', z.tuple([]), () => collab.listMyGroups())
  validatedHandle('collab:create-group', z.tuple([z.string().trim().min(1).max(80), z.enum(['team', 'coaching'])]),
    (_e, name, kind) => collab.createGroup(name, kind))
  validatedHandle('collab:create-invite', z.tuple([uuid, role, z.number().int().min(1).max(30)]),
    (_e, groupId, r, days) => collab.createInvite(groupId, r, days))
  validatedHandle('collab:join', z.tuple([z.string().trim().toUpperCase().regex(/^[A-Z0-9]{6,16}$/, 'invalid code'), z.string().trim().max(40).nullish()]),
    (_e, code, riotId) => collab.joinGroup(code, riotId ?? null))
  validatedHandle('collab:leave', z.tuple([uuid]), (_e, groupId) => collab.leaveGroup(groupId))
  validatedHandle('collab:delete-group', z.tuple([uuid, z.literal('DELETE')]), (_e, groupId) => collab.deleteGroup(groupId))
  validatedHandle('collab:remove-member', z.tuple([uuid, uuid]), (_e, groupId, userId) => collab.removeMember(groupId, userId))
  validatedHandle('collab:set-captain', z.tuple([uuid, uuid, z.boolean()]), (_e, groupId, userId, isCaptain) => collab.setCaptain(groupId, userId, isCaptain))
  validatedHandle('collab:set-member-role', z.tuple([uuid, uuid, role]), (_e, groupId, userId, r) => collab.setMemberRole(groupId, userId, r))
  validatedHandle('collab:set-sharing', z.tuple([uuid, z.object({ shareReviews: z.boolean(), shareStats: z.boolean(), shareTeam: z.boolean(), shareWellbeing: z.boolean() })]),
    (_e, groupId, s) => collab.setSharing(groupId, s))

  validatedHandle('collab:player-sessions', z.tuple([uuid]), (_e, playerId) => collab.getPlayerSessions(playerId))
  const lookId = z.string().regex(LOOK_ID)
  validatedHandle('collab:set-my-look', z.tuple([z.object({ iconId: lookId, bannerId: lookId })]), (_e, look) => collab.setMyLook(look))
  validatedHandle('collab:list-member-looks', z.tuple([]), () => collab.listMemberLooks())
  const logoImage = z.object({
    bytes: z.instanceof(Uint8Array).refine((b) => b.byteLength > 0 && b.byteLength <= GROUP_LOGO_MAX_BYTES, 'logo too large'),
    contentType: z.enum(['image/webp', 'image/png', 'image/jpeg']),
  })
  validatedHandle('collab:set-group-logo', z.tuple([uuid, logoImage.nullable()]), (_e, groupId, image) => collab.setGroupLogo(groupId, image))

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
  const devPlanDateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
  const devPlanPeriod = z.object({ periodStart: devPlanDateOnly.nullable().optional(), periodEnd: devPlanDateOnly.nullable().optional() }).optional()
  validatedHandle('devplan:create', z.tuple([uuid, uuid, z.string().trim().min(1).max(80), z.array(axisInput).min(1).max(3), devPlanPeriod]),
    (_e, groupId, playerId, title, axes, period) => collab.devPlanCreate(groupId, playerId, title, axes, period))
  validatedHandle('devplan:set-axis-status', z.tuple([uuid, axisStatus]), (_e, axisId, status) => collab.devPlanSetAxisStatus(axisId, status))
  validatedHandle('devplan:add-axis', z.tuple([uuid, axisInput]), (_e, planId, axis) => collab.devPlanAddAxis(planId, axis))
  validatedHandle('devplan:delete-axis', z.tuple([uuid]), (_e, axisId) => collab.devPlanDeleteAxis(axisId))
  validatedHandle('devplan:add-checkin', z.tuple([uuid, z.string().trim().min(1).max(4000)]), (_e, planId, note) => collab.devPlanAddCheckin(planId, note))
  validatedHandle('devplan:set-progress', z.tuple([uuid, z.object({
    playerMarkedDone: z.boolean().optional(),
    playerNote: z.string().max(1000).nullable().optional(),
  })]), (_e, axisId, input) => collab.devPlanSetProgress(axisId, input))

  const isoDate = z.string().datetime()
  const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
  const timeOnly = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
  const eventKind = z.enum(['tournament', 'team_review', 'one_on_one', 'soloq_block', 'rest', 'other', 'scrim', 'flex', 'meeting', 'warmup_draft'])
  const attendeeScope = z.enum(['whole_team', 'all_players', 'all_staff', 'custom'])
  const eventInput = z.object({
    kind: eventKind, title: z.string().trim().min(1).max(120), startsAt: isoDate, endsAt: isoDate, notes: z.string().max(2000).nullable().optional(),
    linkedScrimId: uuid.nullable().optional(), attendeeScope: attendeeScope.optional(), attendeeUserIds: z.array(uuid).max(50).optional(),
  })

  validatedHandle('calendar:list-events', z.tuple([uuid, isoDate, isoDate]), (_e, groupId, from, to) => collab.calendarListEvents(groupId, from, to))
  validatedHandle('calendar:get-event', z.tuple([uuid]), (_e, id) => collab.calendarGetEvent(id))
  validatedHandle('calendar:create-event', z.tuple([uuid, eventInput]), (_e, groupId, input) => collab.calendarCreateEvent(groupId, input))
  validatedHandle('calendar:update-event', z.tuple([uuid, eventInput]), (_e, id, input) => collab.calendarUpdateEvent(id, input))
  validatedHandle('calendar:delete-event', z.tuple([uuid]), (_e, id) => collab.calendarDeleteEvent(id))
  validatedHandle('calendar:respond', z.tuple([uuid, z.enum(['confirmed', 'declined']), z.string().trim().max(300).nullable().optional()]),
    (_e, eventId, status, note) => collab.calendarRespond(eventId, status, note))

  const eventRequestInput = z.object({
    eventName: z.string().trim().min(1).max(120), peopleConcerned: z.array(z.string().trim().min(1).max(80)).max(30),
    preferredStart: isoDate.nullable().optional(), preferredEnd: isoDate.nullable().optional(),
  })
  validatedHandle('calendar:create-request', z.tuple([uuid, eventRequestInput]), (_e, groupId, input) => collab.calendarCreateRequest(groupId, input))
  validatedHandle('calendar:list-requests', z.tuple([uuid]), (_e, groupId) => collab.calendarListRequests(groupId))
  validatedHandle('calendar:set-request-status', z.tuple([uuid, z.enum(['accepted', 'declined'])]), (_e, id, status) => collab.calendarSetRequestStatus(id, status))
  validatedHandle('calendar:delete-request', z.tuple([uuid]), (_e, id) => collab.calendarDeleteRequest(id))

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

  validatedHandle('calendar:get-subscription', z.tuple([uuid]), (_e, groupId) => collab.calendarGetSubscription(groupId))
  validatedHandle('calendar:create-subscription', z.tuple([uuid]), (_e, groupId) => collab.calendarCreateSubscription(groupId))
  validatedHandle('calendar:revoke-subscription', z.tuple([uuid]), (_e, id) => collab.calendarRevokeSubscription(id))

  const discussionSubjectType = z.enum(['scrim', 'draft'])
  validatedHandle('discussion:list', z.tuple([discussionSubjectType, uuid]), (_e, subjectType, subjectId) => collab.discussionList(subjectType, subjectId))
  validatedHandle('discussion:add', z.tuple([uuid, discussionSubjectType, uuid, z.string().trim().min(1).max(2000)]),
    (_e, groupId, subjectType, subjectId, body) => collab.discussionAdd(groupId, subjectType, subjectId, body))
  validatedHandle('discussion:delete', z.tuple([uuid]), (_e, id) => collab.discussionDelete(id))

  const vodUrl = z.string().trim().url().max(500)
  const teamTag = z.enum(['rotation', 'objective_setup', 'communication', 'other'])
  const sessionInput = z.object({ scrimId: uuid.nullable().optional(), title: z.string().trim().min(1).max(120), vodUrl })
  const commentInput = z.object({ videoTimeSec: z.number().int().min(0).max(36000).nullable().optional(), teamTag: teamTag.nullable().optional(), body: z.string().trim().min(1).max(2000) })
  const assignmentInput = z.object({ playerId: uuid, rangeStartSec: z.number().int().min(0), rangeEndSec: z.number().int().min(0) })
  const assignmentStatus = z.enum(['pending', 'done'])

  validatedHandle('vodreview:list-sessions', z.tuple([uuid]), (_e, groupId) => collab.vodReviewListSessions(groupId))
  validatedHandle('vodreview:create-session', z.tuple([uuid, sessionInput]), (_e, groupId, input) => collab.vodReviewCreateSession(groupId, input))
  validatedHandle('vodreview:delete-session', z.tuple([uuid]), (_e, id) => collab.vodReviewDeleteSession(id))
  validatedHandle('vodreview:add-comment', z.tuple([uuid, commentInput]), (_e, sessionId, input) => collab.vodReviewAddComment(sessionId, input))
  validatedHandle('vodreview:delete-comment', z.tuple([uuid]), (_e, id) => collab.vodReviewDeleteComment(id))
  validatedHandle('vodreview:add-action-item', z.tuple([uuid, z.string().trim().min(1).max(500)]), (_e, sessionId, text) => collab.vodReviewAddActionItem(sessionId, text))
  validatedHandle('vodreview:set-action-item-done', z.tuple([uuid, z.boolean()]), (_e, id, done) => collab.vodReviewSetActionItemDone(id, done))
  validatedHandle('vodreview:delete-action-item', z.tuple([uuid]), (_e, id) => collab.vodReviewDeleteActionItem(id))
  validatedHandle('vodreview:set-assignment', z.tuple([uuid, assignmentInput]), (_e, sessionId, input) => collab.vodReviewSetAssignment(sessionId, input))
  validatedHandle('vodreview:set-assignment-status', z.tuple([uuid, assignmentStatus]), (_e, id, status) => collab.vodReviewSetAssignmentStatus(id, status))
  validatedHandle('vodreview:delete-assignment', z.tuple([uuid]), (_e, id) => collab.vodReviewDeleteAssignment(id))

  // Micro-review, coach side (docs/PLAN_MICRO_REVIEW.md)
  const slug = z.string().min(1).max(64).regex(/^[a-z0-9-]+$/)
  validatedHandle('microreview-cloud:player-answers', z.tuple([uuid]), (_e, playerId) => collab.microReviewCloudPlayerAnswers(playerId))
  validatedHandle('microreview-cloud:my-verdicts', z.tuple([]), () => collab.microReviewCloudMyVerdicts())
  validatedHandle('microreview-cloud:set-verdict', z.tuple([z.object({
    answerId: uuid,
    groupId: uuid,
    status: z.enum(['validated', 'corrected']),
    correctedOutcome: z.enum(['mistake', 'justified']).nullable().optional(),
    correctedTag: slug.nullable().optional(),
    note: z.string().trim().max(1000).nullable().optional(),
  })]), (_e, v) => collab.microReviewCloudSetVerdict(v))
  validatedHandle('team-codex:list', z.tuple([z.array(uuid).max(20)]), (_e, groupIds) => collab.teamCodexList(groupIds))
  validatedHandle('team-codex:add', z.tuple([z.object({
    groupId: uuid,
    role: z.enum(['any', 'TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY']),
    mistakeSlug: slug,
    phase: z.enum(['any', 'early', 'mid', 'late']),
    fundamentalId: z.string().min(1).max(64),
    radarAxis: z.string().max(16).optional(),
    headline: z.string().trim().min(1).max(140),
    tacticalRule: z.string().trim().min(1).max(1000),
    drillObjective: z.string().trim().min(1).max(300),
    videoRef: z.string().trim().max(500).nullable().optional(),
  })]), (_e, r) => collab.teamCodexAdd(r))
  validatedHandle('team-codex:delete', z.tuple([uuid]), (_e, id) => collab.teamCodexDelete(id))

  const checkinInput = z.object({
    energy: z.number().int().min(1).max(5), mood: z.number().int().min(1).max(5), sleep: z.number().int().min(1).max(5),
    note: z.string().max(500).nullable().optional(),
  })
  validatedHandle('wellbeing:add-checkin', z.tuple([checkinInput]), (_e, input) => collab.wellbeingAddCheckin(input))
  validatedHandle('wellbeing:list-mine', z.tuple([z.number().int().min(1).max(200).optional()]), (_e, limit) => collab.wellbeingListMine(limit))
  validatedHandle('wellbeing:list-for-group', z.tuple([z.array(uuid).max(50)]), (_e, playerIds) => collab.wellbeingListForGroup(playerIds))
  validatedHandle('wellbeing:get-load-threshold', z.tuple([uuid]), (_e, groupId) => collab.wellbeingGetLoadThreshold(groupId))
  validatedHandle('wellbeing:set-load-threshold', z.tuple([uuid, z.number().int().min(1).max(100)]), (_e, groupId, hours) => collab.wellbeingSetLoadThreshold(groupId, hours))

  const announcementInput = z.object({ title: z.string().trim().min(1).max(120), body: z.string().trim().min(1).max(4000), pinned: z.boolean().optional() })
  validatedHandle('announcements:list', z.tuple([uuid]), (_e, groupId) => collab.announcementsList(groupId))
  validatedHandle('announcements:create', z.tuple([uuid, announcementInput]), (_e, groupId, input) => collab.announcementsCreate(groupId, input))
  validatedHandle('announcements:set-pinned', z.tuple([uuid, z.boolean()]), (_e, id, pinned) => collab.announcementsSetPinned(id, pinned))
  validatedHandle('announcements:delete', z.tuple([uuid]), (_e, id) => collab.announcementsDelete(id))
  validatedHandle('announcements:list-my-dismissals', z.tuple([]), () => collab.announcementsListMyDismissals())
  validatedHandle('announcements:dismiss', z.tuple([uuid]), (_e, announcementId) => collab.announcementsDismiss(announcementId))

  const taskInput = z.object({ title: z.string().trim().min(1).max(200), assigneeId: uuid.nullable().optional(), dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional() })
  const taskStatus = z.enum(['open', 'done'])
  validatedHandle('tasks:list', z.tuple([uuid]), (_e, groupId) => collab.tasksList(groupId))
  validatedHandle('tasks:create', z.tuple([uuid, taskInput]), (_e, groupId, input) => collab.tasksCreate(groupId, input))
  validatedHandle('tasks:set-status', z.tuple([uuid, taskStatus]), (_e, id, status) => collab.tasksSetStatus(id, status))
  validatedHandle('tasks:delete', z.tuple([uuid]), (_e, id) => collab.tasksDelete(id))

  validatedHandle('staffnotes:list', z.tuple([uuid, uuid]), (_e, groupId, playerId) => collab.staffNotesList(groupId, playerId))
  validatedHandle('staffnotes:add', z.tuple([uuid, uuid, z.string().trim().min(1).max(4000)]), (_e, groupId, playerId, body) => collab.staffNotesAdd(groupId, playerId, body))
  validatedHandle('staffnotes:delete', z.tuple([uuid]), (_e, id) => collab.staffNotesDelete(id))

  validatedHandle('report:get-weekly', z.tuple([uuid, dateOnly]), (_e, groupId, weekStart) => collab.reportGetWeekly(groupId, weekStart))
  validatedHandle('report:get-for-event', z.tuple([uuid, uuid]), (_e, groupId, eventId) => collab.reportGetForEvent(groupId, eventId))

  const mistakeTrend = z.object({ label: z.string(), thisWeek: z.number(), lastWeek: z.number(), direction: z.enum(['up', 'down', 'flat']) })
  const playerWeeklyReport = z.object({
    playerId: z.string(), displayName: z.string(), gamesPlayed: z.number(), winrate: z.number().nullable(),
    reviewsDone: z.number(), reviewsPending: z.number(), mistakeTrends: z.array(mistakeTrend),
    objectivesAssigned: z.number(), objectivesCompleted: z.number(),
    experimentVerdicts: z.array(z.object({ problemId: z.string(), verdict: z.string().nullable() })),
  })
  const teamWeeklyReport = z.object({
    groupId: z.string(), weekStart: z.string(), weekEnd: z.string(),
    players: z.array(playerWeeklyReport), totalGames: z.number(), avgWinrate: z.number().nullable(),
  })
  validatedHandle('report:create-share', z.tuple([uuid, z.string().trim().min(1).max(80), teamWeeklyReport]),
    (_e, groupId, groupName, r) => collab.reportCreateShare(groupId, groupName, r))
  validatedHandle('report:revoke-share', z.tuple([uuid]), (_e, id) => collab.reportRevokeShare(id))

  const trialRole = z.enum(['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'])
  const trialStatus = z.enum(['trialing', 'kept', 'rejected'])
  const candidateInput = z.object({
    displayName: z.string().trim().min(1).max(64), role: trialRole,
    periodStart: dateOnly.nullable().optional(), periodEnd: dateOnly.nullable().optional(), notes: z.string().max(4000).nullable().optional(),
  })
  const evaluationInput = z.object({ criterion: z.string().trim().min(1).max(80), score: z.number().int().min(1).max(5), note: z.string().max(1000).nullable().optional() })

  validatedHandle('trials:list', z.tuple([uuid]), (_e, groupId) => collab.trialsList(groupId))
  validatedHandle('trials:create', z.tuple([uuid, candidateInput]), (_e, groupId, input) => collab.trialsCreate(groupId, input))
  validatedHandle('trials:set-status', z.tuple([uuid, trialStatus]), (_e, id, status) => collab.trialsSetStatus(id, status))
  validatedHandle('trials:delete', z.tuple([uuid]), (_e, id) => collab.trialsDelete(id))
  validatedHandle('trials:add-evaluation', z.tuple([uuid, evaluationInput]), (_e, candidateId, input) => collab.trialsAddEvaluation(candidateId, input))
  validatedHandle('trials:delete-evaluation', z.tuple([uuid]), (_e, id) => collab.trialsDeleteEvaluation(id))

  validatedHandle('scrims:list-for-group', z.tuple([uuid]), (_e, groupId) => collab.scrimsListForGroup(groupId))
}
