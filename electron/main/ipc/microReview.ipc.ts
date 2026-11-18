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

import { z } from 'zod'
import { randomUUID } from 'crypto'
import type { Prisma } from '../../../prisma-client'
import { getPrisma } from '../database'
import { validatedHandle, id } from './validate'
import { ensureMatchCache } from './stats.ipc'
import { analyzeGame, isSupportedGame, type GameAnalysis } from '../../../src/lib/microReview/anomalyDetector'
import { verifySessionObjectives } from '../../../src/lib/microReview/objectiveVerification'
import { CALIBRATION_EVERY, calibrationDue, calibrationGap, measuredDistribution } from '../../../src/lib/microReview/calibration'
import { tagFamily, FAMILIES, type MistakeFamily } from '../../../src/lib/mistakeInsights'
import type {
  CalibrationResult, CalibrationStatus, MicroReviewAnswerResult, MicroReviewAnswerView, MicroReviewPayload, ObjectiveVerificationPayload,
} from '../../../src/lib/microReview/types'
import { microReviewPushAnswer } from '../cloud/collab'
import { momentWindow } from '../mistakeDedupe'

/** Bump when the detector's output changes, to recompute cached analyses. 6: V5 laning + V6 role patterns; 7: V7–V10 jungle, mid and support patterns. */
export const ANALYSIS_VERSION = 7
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
export async function ensureGameAnalysis(gameId: string, fetch: boolean): Promise<{ analysis: GameAnalysis | null; reason?: string }> {
  const prisma = getPrisma()
  const cached = await prisma.gameAnalysis.findUnique({ where: { gameId } })
  if (cached && cached.version === ANALYSIS_VERSION) {
    try { return { analysis: JSON.parse(cached.payload) as GameAnalysis } } catch { /* recompute */ }
  }
  let matchJson: string | null = null
  let timelineJson: string | null = null
  let selector: { puuids: string[]; championName: string }
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
    if (!cache?.matchJson || !cache.timelineJson) return { analysis: null, reason: 'not-cached' }
    matchJson = cache.matchJson
    timelineJson = cache.timelineJson
    selector = { puuids: await userPuuids(game.session.userId), championName: game.champion }
  }
  let analysis: GameAnalysis | null = null
  try {
    const match = JSON.parse(matchJson)
    // Another map or game mode: the detector's geometry and timers do not apply.
    if (!isSupportedGame(match)) return { analysis: null, reason: 'unsupported-mode' }
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
}): MicroReviewAnswerView => ({
  id: a.id, momentKey: a.momentKey, trigger: a.trigger as MicroReviewAnswerView['trigger'], gameTimeSec: a.gameTimeSec,
  outcome: a.outcome as MicroReviewAnswerView['outcome'], tagSlug: a.tagSlug, reason: a.reason, viaOther: a.viaOther,
  note: a.note, mistakeId: a.mistakeId, createdAt: a.createdAt.toISOString(),
})

async function resolveTag(slug: string | null | undefined, customLabel: string | null | undefined) {
  const prisma = getPrisma()
  if (customLabel?.trim()) {
    const label = customLabel.trim().slice(0, 60)
    const base = label.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'custom'
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
  summary: z.object({
    gameTimeSec: z.number().int().min(0).max(36000),
    zone: z.string().max(20).nullable(),
    head: summaryPart,
    extras: z.array(summaryPart).max(4),
  }).nullable().optional(),
  videoTimeSec: z.number().int().min(0).max(36000).nullable().optional(),
})

export function registerMicroReviewHandlers(): void {
  validatedHandle('microreview:get', z.tuple([id]), async (_e, gameId): Promise<MicroReviewPayload | null> => {
    const prisma = getPrisma()
    const game = await prisma.game.findUnique({ where: { id: gameId }, include: { session: { select: { userId: true } }, recording: true } })
    if (!game) return null
    const userId = game.session.userId
    const { analysis, reason } = await ensureGameAnalysis(gameId, true)
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
      pastAnswers: past,
      recording: rec ? { id: rec.id, filePath: rec.filePath, youtubeUrl: rec.youtubeUrl, startOffsetSec: rec.startOffsetSec, createdAt: rec.createdAt.toISOString() } : null,
    }
  })

  validatedHandle('microreview:answer', z.tuple([answerSchema]), async (_e, input): Promise<MicroReviewAnswerResult> => {
    const prisma = getPrisma()
    const game = await prisma.game.findUnique({ where: { id: input.gameId }, include: { session: { select: { userId: true } }, recording: { select: { id: true } } } })
    if (!game) throw new Error('Game not found')
    const userId = game.session.userId

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
    else if (old && oldOrigin === 'confirmed-auto') writes.push(prisma.mistake.update({ where: { id: old.id }, data: { autoDetected: true } }))

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
        if (auto) writes.push(prisma.mistake.update({ where: { id: near.id }, data: { autoDetected: false } }))
        mistakeId = near.id
      } else {
        mistakeId = randomUUID()
        mistakeOrigin = 'created'
        writes.push(prisma.mistake.create({
          data: {
            id: mistakeId, gameId: input.gameId, tagId: tag.id, gameTimeSec: input.gameTimeSec,
            severity: input.trigger === 'critical-death' ? 3 : 2,
            note: input.note?.trim().slice(0, 1000) || null,
            recordingId: game.recording?.id ?? null, autoDetected: false,
          },
        }))
      }
    }

    const data = {
      userId, trigger: input.trigger, gameTimeSec: input.gameTimeSec, outcome: input.outcome, tagSlug,
      reason: input.reason ?? null, viaOther: input.viaOther, note: input.note?.trim() || null,
      role, champion: game.champion, mistakeId, mistakeOrigin,
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

    return { answer: toView(row), xpAwarded, completed }
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
    const answers = await prisma.microReviewAnswer.count({ where: { gameId } })
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
