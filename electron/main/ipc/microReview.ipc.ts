/**
 * Micro-review IPC (docs/PLAN_MICRO_REVIEW.md). Deterministic, local:
 * reads the cached Riot timeline (MatchCache, filled by ensureMatchCache),
 * runs the AnomalyDetector, stores QCM answers, verifies session
 * objectives and runs the calibration flash.
 *
 * Channels:
 *   microreview:get                 → MicroReviewPayload
 *   microreview:answer              → MicroReviewAnswerResult
 *   microreview:verify-objectives   → ObjectiveVerificationPayload | null
 *   microreview:calibration-status  → CalibrationStatus | null
 *   microreview:calibration-submit  → CalibrationResult
 */

import { mayFallBack, readStoredAnalysis, shouldRetry } from '../analysisCompat'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import type { Prisma } from '../../../prisma-client'
import { getPrisma } from '../database'
import { markShortReview } from '../shortReview'
import { isPlausibleOffset, mistakeVideoTimeMs } from '../mistakeBookmarks'
import { mistakeWindow } from '../mistakeWindowCore'
import { removeMistake, undoMistakeCorrection } from '../mistakeCorrections'
import { teamContextForMatch } from '../teamContext'
import { timelineFromRow } from '../matchStore'
import { validatedHandle, id } from './validate'
import { ensureMatchCache } from './stats.ipc'
import { analyzeGame, isSupportedGame, type CriticalMoment, type GameAnalysis } from '../../../src/lib/microReview/anomalyDetector'
import { seasonOf } from '../../../src/lib/microReview/gameClock'
import { verifySessionObjectives } from '../../../src/lib/microReview/objectiveVerification'
import { CALIBRATION_EVERY, calibrationDue, calibrationGap, measuredDistribution } from '../../../src/lib/microReview/calibration'
import { tagFamily, FAMILIES, type MistakeFamily } from '../../../src/lib/mistakeInsights'
import type {
  CalibrationResult, CalibrationStatus, MicroReviewAnswerResult, MicroReviewAnswerView, MicroReviewPayload, ObjectiveVerificationPayload,
} from '../../../src/lib/microReview/types'
import { microReviewPushAnswer } from '../cloud/collab'
import { momentWindow } from '../mistakeDedupe'
import { mistakeSlug } from '../../../src/lib/mistakeSlug'

/** Bump when the detector's output changes, to recompute cached analyses. 6: V5 laning + V6 role patterns; 7: V7–V10 jungle, mid and support patterns; 8: season-2026 clock (16.x games 35 s earlier, wiki respawn timers); 9: plates stay up after 14:00 (dive, mid roam on plates, side-lane T1); 10: #45 game data (Herald eye 15:00-22:00, pit fights from 15:00, M8 Baron deaths only once the Baron is up); 11: current season only (15.x games not analysed, Atakhan removed); 12: 20/11 cards (no cross-map blame for laners in soloQ before 14:00, greed only after the spawn, setup in mid / river, places in words, exact / estimated positions, header and markers); 13: extraMoments (21/11, the next key moments offered after the 3); 14: no engine markers (21/11, « Repères de la micro-review »: error / consequence / conclusion removed, the player sets precise timestamps); 15: mid roam ledger (26/11, `GameAnalysis.roams` stored for the mid, mid-roam-unpaid pattern behind DETECTOR_SPEC.roam.enabled); 16: roam ledger of every laner, jungler gank ledger, role-quest gap (`roams`, `ganks`, `quest`; their cards behind DETECTOR_SPEC flags, phases 2-4). */
export const ANALYSIS_VERSION = 16
export const MICRO_REVIEW_XP = 30

async function userPuuids(userId: string): Promise<string[]> {
  const prisma = getPrisma()
  const [user, accounts] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }),
    prisma.account.findMany({ where: { userId } }),
  ])
  return [user?.puuid, ...accounts.map((a) => a.puuid)].filter((p): p is string => !!p)
}

/** Cached analysis, or computed from MatchCache. `fetch`: allow a Riot fetch when the timeline is not cached yet. */
/** Last failed recompute per game (this run of the app): the stored analysis is served until RETRY_AFTER_MS has passed. */
const recomputeFailedAt = new Map<string, number>()

/**
 * The game's analysis for the current engine. When the recompute is impossible (timeline purged, Riot offline…) and an
 * analysis of an older version is stored, that one is returned (stale: true) so the game keeps its cards; the recompute
 * is tried again after RETRY_AFTER_MS (21/11/2026, audit P3). Never for another mode or an older season.
 */
export async function ensureGameAnalysis(gameId: string, fetch: boolean): Promise<{ analysis: GameAnalysis | null; reason?: string; stale?: boolean }> {
  const prisma = getPrisma()
  const cached = await prisma.gameAnalysis.findUnique({ where: { gameId } })
  if (cached && cached.version === ANALYSIS_VERSION) {
    try { return { analysis: JSON.parse(cached.payload) as GameAnalysis } } catch { /* recompute */ }
  }
  const stored = cached && cached.version !== ANALYSIS_VERSION ? readStoredAnalysis(cached.payload) : null
  if (stored && !shouldRetry(recomputeFailedAt.get(gameId), Date.now())) return { analysis: stored, stale: true, reason: 'recompute-pending' }
  const result = await recomputeGameAnalysis(gameId, fetch)
  if (result.analysis) {
    recomputeFailedAt.delete(gameId)
    return result
  }
  if (stored && mayFallBack(result.reason)) {
    recomputeFailedAt.set(gameId, Date.now())
    console.warn(`[microreview] recompute impossible (${result.reason}): game ${gameId} keeps its version ${cached?.version} analysis`)
    return { analysis: stored, stale: true, reason: result.reason }
  }
  return result
}

async function recomputeGameAnalysis(gameId: string, fetch: boolean): Promise<{ analysis: GameAnalysis | null; reason?: string }> {
  const prisma = getPrisma()
  let matchJson: string | null = null
  let timelineJson: string | null = null
  let selector: { puuids: string[]; championName: string; teamContext?: boolean }
  if (fetch) {
    const loaded = await ensureMatchCache(gameId, false, 'microreview')
    if (!loaded.ok) return { analysis: null, reason: loaded.reason }
    matchJson = loaded.matchJson
    timelineJson = loaded.timelineJson
    selector = { puuids: loaded.userPuuids, championName: loaded.game.champion }
  } else {
    const game = await prisma.game.findUnique({ where: { id: gameId }, include: { session: { select: { userId: true } } } })
    if (!game) return { analysis: null, reason: 'no-game' }
    const cache = await prisma.matchCache.findUnique({ where: { matchId: game.matchId } })
    const cachedTimeline = cache ? timelineFromRow(prisma, game.matchId, cache.timelineJson) : null
    if (!cache?.matchJson || !cachedTimeline) return { analysis: null, reason: 'not-cached' }
    matchJson = cache.matchJson
    timelineJson = cachedTimeline
    selector = { puuids: await userPuuids(game.session.userId), championName: game.champion }
  }
  let analysis: GameAnalysis | null = null
  try {
    const match = JSON.parse(matchJson)
    // Another map or game mode: the detector's geometry and timers do not apply.
    if (!isSupportedGame(match)) return { analysis: null, reason: 'unsupported-mode' }
    // A game of an older season (15.x): the engine only knows the current clock. Its cached analysis is left as it is.
    if (seasonOf(match) !== 'current') return { analysis: null, reason: 'previous-season' }
    // Team session, custom or tournament: cross-map remarks apply (20/11/2026). Unknown counts as soloQ.
    const matchId: string = match?.metadata?.matchId ?? ''
    selector = { ...selector, teamContext: matchId ? await teamContextForMatch(matchId, match) : false }
    analysis = analyzeGame(match, JSON.parse(timelineJson), selector)
  } catch (err) {
    console.warn('[microreview] analysis failed:', (err as Error)?.message ?? err)
  }
  if (!analysis) return { analysis: null, reason: 'player-not-resolved' }
  const payload = JSON.stringify(analysis)
  await prisma.gameAnalysis.upsert({
    where: { gameId },
    create: { gameId, version: ANALYSIS_VERSION, payload },
    update: { version: ANALYSIS_VERSION, payload },
  })
  return { analysis }
}

const toView = (a: {
  id: string; momentKey: string; trigger: string; gameTimeSec: number; outcome: string; tagSlug: string | null
  reason: string | null; viaOther: boolean; note: string | null; mistakeId: string | null; createdAt: Date
  errorAtSec?: number | null; consequenceAtSec?: number | null
}): MicroReviewAnswerView => ({
  id: a.id, momentKey: a.momentKey, trigger: a.trigger as MicroReviewAnswerView['trigger'], gameTimeSec: a.gameTimeSec,
  outcome: a.outcome as MicroReviewAnswerView['outcome'], tagSlug: a.tagSlug, reason: a.reason, viaOther: a.viaOther,
  note: a.note, mistakeId: a.mistakeId, createdAt: a.createdAt.toISOString(),
  errorAtSec: a.errorAtSec ?? null, consequenceAtSec: a.consequenceAtSec ?? null,
})

function parseIdList(raw: string | null | undefined): string[] {
  try { const v = JSON.parse(raw ?? '[]'); return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [] } catch { return [] }
}

export async function resolveTag(slug: string | null | undefined, customLabel: string | null | undefined) {
  const prisma = getPrisma()
  if (customLabel?.trim()) {
    const label = customLabel.trim().slice(0, 60)
    const base = mistakeSlug(label)
    const existing = await prisma.mistakeTag.findFirst({ where: { label, isBuiltIn: false } })
    if (existing) return existing
    let s = base
    for (let i = 1; await prisma.mistakeTag.findUnique({ where: { slug: s } }); i++) s = `${base}-${i}`
    return prisma.mistakeTag.create({ data: { slug: s, label, category: 'micro', isBuiltIn: false } })
  }
  if (!slug) return null
  return prisma.mistakeTag.findUnique({ where: { slug } })
}

const triggerSchema = z.enum(['critical-death', 'absent-objective', 'early-deficit'])
const slugSchema = z.string().max(64).regex(/^[a-z0-9-]+$/)
const summaryPart = z.object({ key: z.string().max(40), params: z.record(z.union([z.string().max(60), z.number()])).optional() })
const momentKeySchema = z.string().min(1).max(64).regex(/^[a-z-]+@[0-9]+$/)
/** « Not a mistake » (Front's shape): the trigger and the time are read from the key; when sent, they must match it. */
const dismissInput = z.object({
  gameId: id,
  momentKey: momentKeySchema,
  trigger: triggerSchema.optional(),
  gameTimeSec: z.number().int().min(0).max(36000).optional(),
}).strip().refine((v) => (v.trigger === undefined || v.momentKey.startsWith(`${v.trigger}@`)) && (v.gameTimeSec === undefined || v.momentKey.endsWith(`@${v.gameTimeSec}`)), 'momentKey does not match')
const answerSchema = z.object({
  gameId: id,
  momentKey: z.string().min(1).max(64).regex(/^[a-z-]+@\d+$/),
  trigger: triggerSchema,
  gameTimeSec: z.number().int().min(0).max(36000),
  outcome: z.enum(['mistake', 'justified', 'custom']),
  tagSlug: slugSchema.nullable().optional(),
  customLabel: z.string().max(60).nullable().optional(),
  reason: z.string().max(40).regex(/^[A-Za-z0-9]+$/).nullable().optional(),
  viaOther: z.boolean(),
  note: z.string().max(1000).nullable().optional(),
  /** 21/11/2026, Front's name for « Raisons de l'erreur d'après moi »: stored as the note (wins over `note`). */
  myReasons: z.string().max(1000).nullable().optional(),
  /** 21/11/2026: extra error tags beyond the proposed one, each a manual mistake at the moment's time. */
  extraTags: z.array(z.object({
    tagSlug: slugSchema.nullable().optional(),
    customLabel: z.string().max(60).nullable().optional(),
    note: z.string().max(280).nullable().optional(),
  }).strict()).max(5).optional(),
  /** 21/11/2026: the answered moment becomes a bookmark at its time, with this label (the card's short title). */
  bookmarkLabel: z.string().max(80).nullable().optional(),
  summary: z.object({
    gameTimeSec: z.number().int().min(0).max(36000),
    zone: z.string().max(20).nullable(),
    head: summaryPart,
    extras: z.array(summaryPart).max(4),
  }).nullable().optional(),
  videoTimeSec: z.number().int().min(0).max(36000).nullable().optional(),
  /** 21/11/2026 « Repères de la micro-review »: optional precise timestamps (game seconds), one or both. */
  errorAtSec: z.number().int().min(0).max(36000).nullable().optional(),
  consequenceAtSec: z.number().int().min(0).max(36000).nullable().optional(),
})

export function registerMicroReviewHandlers(): void {
  validatedHandle('microreview:get', z.tuple([id]), async (_e, gameId): Promise<MicroReviewPayload | null> => {
    const prisma = getPrisma()
    const game = await prisma.game.findUnique({ where: { id: gameId }, include: { session: { select: { userId: true } }, recording: true } })
    if (!game) return null
    const userId = game.session.userId
    // "I do my reviews myself" (21/11/2026): no micro-review is computed nor shown for this player.
    const owner = await prisma.user.findUnique({ where: { id: userId }, select: { selfReview: true } })
    const { analysis, reason } = owner?.selfReview ? { analysis: null, reason: 'self-review' } : await ensureGameAnalysis(gameId, true)
    const role = analysis?.position || game.role
    const [answers, past] = await Promise.all([
      prisma.microReviewAnswer.findMany({ where: { gameId }, orderBy: { gameTimeSec: 'asc' } }),
      prisma.microReviewAnswer.findMany({ where: { userId, role }, select: { role: true, champion: true, tagSlug: true, viaOther: true }, orderBy: { createdAt: 'desc' }, take: 500 }),
    ])
    const rec = game.recording
    return {
      gameId, matchId: game.matchId, champion: game.champion, role, win: game.win,
      gameEndAt: game.gameEndAt.toISOString(), durationSec: game.duration,
      analysis, reason,
      answers: answers.map(toView),
      // « Not a mistake » moments (21/11/2026): greyed out when the review is reopened.
      dismissedMomentKeys: answers.filter((a) => a.outcome === 'dismissed').map((a) => a.momentKey),
      pastAnswers: past,
      recording: rec ? { id: rec.id, filePath: rec.filePath, youtubeUrl: rec.youtubeUrl, startOffsetSec: rec.startOffsetSec, createdAt: rec.createdAt.toISOString() } : null,
    }
  })

  /**
   * « Not a mistake » (21/11/2026, DECISIONS): erases the moment's auto-detected mistake(s), those of the game within
   * the moment's window (mistakeDedupe.momentWindow), through the usual dismiss path: IgnoredMistake (never created
   * again) and a MistakeCorrection 'not_a_mistake'. What a previous answer to that moment added is undone first. The
   * moment is stored as answered 'dismissed': no longer offered, no short review, no prefilled note, nothing sent to
   * the coach. Returns the erased mistakes' ids. Undo (« Annuler »): microreview:restore-moment.
   */
  validatedHandle('microreview:dismiss-moment', z.tuple([dismissInput]), async (_e, { gameId, momentKey }) => {
    const prisma = getPrisma()
    const game = await prisma.game.findUnique({ where: { id: gameId }, include: { session: { select: { userId: true } } } })
    if (!game) throw new Error('NOT_FOUND')
    const owner = await prisma.user.findUnique({ where: { id: game.session.userId }, select: { selfReview: true } })
    if (owner?.selfReview) throw new Error('SELF_REVIEW')
    const [trigger, secText] = momentKey.split('@')
    const gameTimeSec = Number(secText)
    const answerKey = { gameId_momentKey: { gameId, momentKey } }

    // Undo what a previous answer to this moment did (its own mistake, extra tags, bookmark).
    const previous = await prisma.microReviewAnswer.findUnique({ where: answerKey })
    if (previous?.outcome === 'dismissed') return { success: true, dismissedMistakeIds: parseIdList(previous.extraMistakeIds) }
    if (previous) {
      const undo: any[] = []
      if (previous.mistakeId && previous.mistakeOrigin === 'created') undo.push(prisma.mistake.deleteMany({ where: { id: previous.mistakeId } }))
      // A detected mistake this answer had confirmed is a detected one again, erased just below.
      if (previous.mistakeId && previous.mistakeOrigin === 'confirmed-auto') undo.push(prisma.mistake.updateMany({ where: { id: previous.mistakeId }, data: { autoDetected: true, startSec: null, endSec: null } }))
      const extras = parseIdList(previous.extraMistakeIds)
      if (extras.length) undo.push(prisma.mistake.deleteMany({ where: { id: { in: extras }, autoDetected: false } }))
      if (previous.bookmarkId) undo.push(prisma.bookmark.deleteMany({ where: { id: previous.bookmarkId } }))
      if (undo.length) await prisma.$transaction(undo)
    }

    const span = momentWindow(trigger)
    const detected = await prisma.mistake.findMany({
      where: { gameId, autoDetected: true, gameTimeSec: { gte: gameTimeSec - span.before, lte: gameTimeSec + span.after } },
      select: { id: true },
    })
    const dismissedMistakeIds: string[] = []
    for (const m of detected) {
      await removeMistake(m.id, { reason: 'not_a_mistake' })
      dismissedMistakeIds.push(m.id)
    }
    const role = game.role ?? ''
    const data = {
      userId: game.session.userId, trigger, gameTimeSec, outcome: 'dismissed', tagSlug: null, reason: null, viaOther: false, note: null,
      role, champion: game.champion, mistakeId: null, mistakeOrigin: null,
      extraMistakeIds: JSON.stringify(dismissedMistakeIds), bookmarkId: null, errorAtSec: null, consequenceAtSec: null,
    }
    await prisma.microReviewAnswer.upsert({ where: answerKey, create: { gameId, momentKey, ...data }, update: data })
    return { success: true, dismissedMistakeIds }
  })

  /** Undoes « Not a mistake » while the app runs: the erased mistakes come back, the moment is offered again. */
  validatedHandle('microreview:restore-moment', z.tuple([dismissInput]), async (_e, { gameId, momentKey }) => {
    const prisma = getPrisma()
    const row = await prisma.microReviewAnswer.findUnique({ where: { gameId_momentKey: { gameId, momentKey } } })
    if (!row || row.outcome !== 'dismissed') throw new Error('NOT_UNDOABLE')
    for (const mistakeId of parseIdList(row.extraMistakeIds)) await undoMistakeCorrection(mistakeId).catch(() => {})
    await prisma.microReviewAnswer.delete({ where: { id: row.id } })
    return { success: true }
  })

  validatedHandle('microreview:answer', z.tuple([answerSchema]), async (_e, input): Promise<MicroReviewAnswerResult> => {
    const prisma = getPrisma()
    const game = await prisma.game.findUnique({ where: { id: input.gameId }, include: { session: { select: { userId: true } }, recording: { select: { id: true, startOffsetSec: true } } } })
    if (!game) throw new Error('Game not found')
    const userId = game.session.userId
    if (input.myReasons !== undefined) input.note = input.myReasons
    // The player's precise timestamps: the mistake covers [error − 5 s, consequence + 5 s] (BAD_TIMESTAMPS if outside the game).
    const win = mistakeWindow(input.errorAtSec, input.consequenceAtSec, game.duration)
    const mistakeTime = win?.gameTimeSec ?? input.gameTimeSec
    const windowData = win ? { startSec: win.startSec, endSec: win.endSec } : {}
    // "I do my reviews myself" (21/11/2026): nothing of the micro-review is saved for this player.
    const owner = await prisma.user.findUnique({ where: { id: userId }, select: { selfReview: true } })
    if (owner?.selfReview) throw new Error('SELF_REVIEW')

    // Resolve the tag first: an unknown tag must fail before anything is undone.
    const tag = input.outcome === 'justified' ? null : await resolveTag(input.tagSlug, input.outcome === 'custom' ? input.customLabel : null)
    if (input.outcome !== 'justified' && !tag) throw new Error('Unknown mistake tag')
    const tagSlug: string | null = tag?.slug ?? null

    // The current analysis: the player's role in that game, and the moments that exist today.
    const stored = await prisma.gameAnalysis.findUnique({ where: { gameId: input.gameId } })
    let parsed: GameAnalysis | null = null
    try { parsed = stored ? (JSON.parse(stored.payload) as GameAnalysis) : null } catch { parsed = null }
    const role = parsed?.position || game.role
    const keys = parsed?.moments.map((m) => m.key) ?? []
    const span = momentWindow(input.trigger)
    const answerKey = { gameId_momentKey: { gameId: input.gameId, momentKey: input.momentKey } }

    // Everything is read first, then written as ONE transaction (a single
    // batch: no lock is held across awaits): the Mistake Library and the
    // answer change together or not at all.
    const writes: Prisma.PrismaPromise<unknown>[] = []

    // Re-answering undoes exactly what the previous answer did to the Mistake Library.
    const previous = await prisma.microReviewAnswer.findUnique({ where: answerKey })
    const old = previous?.mistakeId ? await prisma.mistake.findUnique({ where: { id: previous.mistakeId } }) : null
    // Rows written before `mistakeOrigin` existed marked their own mistakes with a note prefix.
    const oldOrigin = old ? previous?.mistakeOrigin ?? (old.note?.startsWith('[micro-review]') ? 'created' : 'existing') : null
    if (old && oldOrigin === 'created') writes.push(prisma.mistake.delete({ where: { id: old.id } }))
    else if (old && oldOrigin === 'confirmed-auto') writes.push(prisma.mistake.update({ where: { id: old.id }, data: { autoDetected: true, startSec: null, endSec: null } }))
    // …and its extra tags and its bookmark (21/11/2026).
    const oldExtras = parseIdList(previous?.extraMistakeIds)
    if (oldExtras.length) writes.push(prisma.mistake.deleteMany({ where: { id: { in: oldExtras }, autoDetected: false } }))
    if (previous?.bookmarkId) writes.push(prisma.bookmark.deleteMany({ where: { id: previous.bookmarkId } }))

    let mistakeId: string | null = null
    let mistakeOrigin: 'created' | 'confirmed-auto' | 'existing' | null = null
    if (tag) {
      // The same tag already sits on that moment: confirm an auto-detected one, reuse a manual one — never duplicate.
      const near = await prisma.mistake.findFirst({
        where: {
          gameId: input.gameId, tagId: tag.id, gameTimeSec: { gte: input.gameTimeSec - span.before, lte: input.gameTimeSec + span.after },
          // …the row the previous answer had created is on its way out.
          ...(old && oldOrigin === 'created' ? { id: { not: old.id } } : {}),
        },
        orderBy: { gameTimeSec: 'asc' },
      })
      if (near) {
        // Created by an answer to a moment the analysis no longer has (the detector changed since):
        // this answer takes the row over, so re-answering it "justified" removes the mistake.
        const orphan = keys.length ? await prisma.microReviewAnswer.findFirst({
          where: { gameId: input.gameId, mistakeId: near.id, mistakeOrigin: 'created', momentKey: { notIn: [...keys, input.momentKey] } },
        }) : null
        if (orphan) writes.push(prisma.microReviewAnswer.update({ where: { id: orphan.id }, data: { mistakeId: null, mistakeOrigin: null } }))
        // Auto-detected as stored — or as the undo above is about to make it again.
        const auto = near.autoDetected || (near.id === old?.id && oldOrigin === 'confirmed-auto')
        mistakeOrigin = orphan ? 'created' : auto ? 'confirmed-auto' : 'existing'
        if (auto) writes.push(prisma.mistake.update({ where: { id: near.id }, data: { autoDetected: false, ...windowData } }))
        else if (win) writes.push(prisma.mistake.update({ where: { id: near.id }, data: windowData }))
        mistakeId = near.id
      } else {
        mistakeId = randomUUID()
        mistakeOrigin = 'created'
        writes.push(prisma.mistake.create({
          data: {
            id: mistakeId, gameId: input.gameId, tagId: tag.id, gameTimeSec: mistakeTime, ...windowData,
            severity: input.trigger === 'critical-death' ? 3 : 2,
            note: input.note?.trim().slice(0, 1000) || null,
            recordingId: game.recording?.id ?? null, autoDetected: false,
          },
        }))
      }
    }

    // Extra error tags (21/11/2026): one manual mistake each at the moment's time, never the proposed tag again.
    const extraMistakeIds: string[] = []
    const extraSlugs = new Set<string>(tagSlug ? [tagSlug] : [])
    for (const extra of input.extraTags ?? []) {
      const t = await resolveTag(extra.tagSlug, extra.customLabel)
      if (!t || extraSlugs.has(t.slug)) continue
      extraSlugs.add(t.slug)
      const eid = randomUUID()
      extraMistakeIds.push(eid)
      writes.push(prisma.mistake.create({
        data: {
          id: eid, gameId: input.gameId, tagId: t.id, gameTimeSec: mistakeTime, ...windowData,
          severity: input.trigger === 'critical-death' ? 3 : 2, note: extra.note?.trim().slice(0, 280) || null,
          recordingId: game.recording?.id ?? null, autoDetected: false,
        },
      }))
    }
    // The answered moment as a bookmark at its time, when the recording's offset is known (21/11/2026).
    let bookmarkId: string | null = null
    const offset = game.recording?.startOffsetSec
    if (game.recording && isPlausibleOffset(offset)) {
      bookmarkId = randomUUID()
      writes.push(prisma.bookmark.create({
        data: {
          id: bookmarkId, recordingId: game.recording.id, videoTimeMs: Math.max(0, mistakeVideoTimeMs(win?.startSec ?? input.gameTimeSec, offset)),
          label: input.bookmarkLabel?.trim().slice(0, 80) || null, color: '#E66556',
        },
      }))
    }

    const data = {
      userId, trigger: input.trigger, gameTimeSec: input.gameTimeSec, outcome: input.outcome, tagSlug,
      reason: input.reason ?? null, viaOther: input.viaOther, note: input.note?.trim() || null,
      role, champion: game.champion, mistakeId, mistakeOrigin,
      extraMistakeIds: JSON.stringify(extraMistakeIds), bookmarkId,
      errorAtSec: input.errorAtSec ?? null, consequenceAtSec: input.consequenceAtSec ?? null,
    }
    const upsert = prisma.microReviewAnswer.upsert({ where: answerKey, create: { gameId: input.gameId, momentKey: input.momentKey, ...data }, update: data })
    const results = await prisma.$transaction([...writes, upsert])
    const row = results[results.length - 1] as Awaited<typeof upsert>

    // XP once per game, when every moment of the current analysis has an answer. The flag is claimed
    // first, atomically (false → true): two answers landing together can never both be paid.
    let xpAwarded = 0
    const answered = keys.length ? await prisma.microReviewAnswer.count({ where: { gameId: input.gameId, momentKey: { in: keys } } }) : 0
    const completed = keys.length > 0 && answered >= keys.length
    if (completed) {
      const claimed = await prisma.gameAnalysis.updateMany({ where: { gameId: input.gameId, reviewXpAwarded: false }, data: { reviewXpAwarded: true } })
      if (claimed.count === 1) {
        await prisma.user.update({ where: { id: userId }, data: { xp: { increment: MICRO_REVIEW_XP } } })
        xpAwarded = MICRO_REVIEW_XP
      }
    }

    // Best effort: share with the player's coaches (no-op when signed out / table absent).
    void microReviewPushAnswer({
      localId: row.id, matchId: game.matchId, champion: game.champion, role, gameTimeSec: row.gameTimeSec,
      videoTimeSec: input.videoTimeSec ?? null, trigger: input.trigger, outcome: input.outcome, tagSlug,
      reason: row.reason, note: row.note, summary: input.summary ?? null,
    })

    // « Review courte » (20/11/2026): one answered moment marks the game reviewed (never over a full review).
    await markShortReview(input.gameId, 'microReview').catch(() => {})

    return { answer: toView(row), xpAwarded, completed }
  })

  // 21/11/2026: the next key moments, offered once the 3 are answered (GameAnalysis.extraMoments, ANALYSIS_VERSION 13).
  validatedHandle('microreview:more-moments', z.tuple([id]), async (_e, gameId): Promise<CriticalMoment[]> => {
    const prisma = getPrisma()
    const game = await prisma.game.findUnique({ where: { id: gameId }, select: { session: { select: { user: { select: { selfReview: true } } } } } })
    if (!game || game.session.user.selfReview) return []
    const { analysis } = await ensureGameAnalysis(gameId, false)
    return analysis?.extraMoments ?? []
  })

  validatedHandle('microreview:verify-objectives', z.tuple([id]), async (_e, gameId): Promise<ObjectiveVerificationPayload | null> => {
    const prisma = getPrisma()
    const game = await prisma.game.findUnique({
      where: { id: gameId },
      include: { session: { select: { objectiveId: true, objectiveIds: true } }, mistakes: { include: { tag: { select: { slug: true } } } }, review: { select: { id: true } } },
    })
    if (!game) return null
    let objectiveIds: string[] = []
    try { objectiveIds = JSON.parse(game.session.objectiveIds) } catch { /* legacy */ }
    if (!objectiveIds.length && game.session.objectiveId) objectiveIds = [game.session.objectiveId]
    if (!objectiveIds.length) return null
    const { analysis } = await ensureGameAnalysis(gameId, false)
    const answers = await prisma.microReviewAnswer.count({ where: { gameId, outcome: { not: 'dismissed' } } })
    return verifySessionObjectives(objectiveIds, {
      tags: game.mistakes.map((m) => m.tag.slug),
      contested: analysis?.contested ?? null,
      csDiff10: analysis?.laneAt10?.csDiff ?? null,
      reviewed: !!game.review || answers > 0,
    })
  })

  validatedHandle('microreview:calibration-status', z.tuple([]), async (): Promise<CalibrationStatus | null> => {
    const prisma = getPrisma()
    const user = await prisma.user.findFirst({ where: { isActive: true } })
    if (!user) return null
    const last = await prisma.calibrationFlash.findFirst({ where: { userId: user.id }, orderBy: { createdAt: 'desc' } })
    const gamesSinceLast = await prisma.game.count({
      where: { session: { userId: user.id }, isSessionEligible: true, ...(last ? { gameEndAt: { gt: last.createdAt } } : {}) },
    })
    const { distribution, basisGames } = await recentDistribution(user.id)
    return { due: calibrationDue(gamesSinceLast), gamesSinceLast, every: CALIBRATION_EVERY, lastAt: last?.createdAt.toISOString() ?? null, distribution, basisGames }
  })

  validatedHandle('microreview:calibration-submit', z.tuple([z.enum(FAMILIES as [MistakeFamily, ...MistakeFamily[]])]), async (_e, perceived): Promise<CalibrationResult> => {
    const prisma = getPrisma()
    const user = await prisma.user.findFirst({ where: { isActive: true } })
    if (!user) throw new Error('No active user')
    const { distribution, tags } = await recentDistribution(user.id)
    const gap = calibrationGap(perceived, distribution)
    await prisma.calibrationFlash.create({ data: { userId: user.id, perceived, measuredTop: gap.measuredTop, gapPts: gap.gapPts, evidence: gap.evidence } })
    // The flash replaces the long periodic form: push the old date-based reminder back.
    await prisma.user.update({ where: { id: user.id }, data: { nextAssessmentAt: new Date(Date.now() + Math.max(7, user.assessmentFreqDays) * 86_400_000) } })
    const counts = new Map<string, number>()
    for (const t of tags) if (gap.measuredTop && tagFamily(t.slug, t.category) === gap.measuredTop) counts.set(t.slug, (counts.get(t.slug) ?? 0) + 1)
    const topTagSlug = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null
    return { ...gap, distribution, topTagSlug }
  })
}

/** Family distribution of the mistakes of the player's last 15 games (micro-review answers included, `justified` ones never create a tag). */
async function recentDistribution(userId: string) {
  const prisma = getPrisma()
  const games = await prisma.game.findMany({
    where: { session: { userId }, isSessionEligible: true },
    orderBy: { gameEndAt: 'desc' },
    take: CALIBRATION_EVERY,
    select: { id: true, mistakes: { select: { tag: { select: { slug: true, category: true } } } } },
  })
  const tags = games.flatMap((g) => g.mistakes.map((m) => m.tag))
  return { distribution: measuredDistribution(tags), basisGames: games.length, tags }
}
