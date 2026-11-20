import { getPrisma } from './database'
import { timelineFromRow } from './matchStore'
import { detectMistakes, type MistakeCandidate } from './mistakeDetector'
import { planAutoBookmarks, type AutoBookmarkCandidate } from './mistakeBookmarks'
import { applySeverityDelta } from './mistakeTuning'
import { mistakeDuplicateIndex } from './mistakeDedupe'

/**
 * Audit E11 (19/11/2026): the Mistake Library auto-detection, in one place. The post-game path
 * (prefetchGameAnalysis, the events refresh) and the "Auto-detect" button (`mistake:auto-detect`) used to run
 * two copies, and the button's copy ignored the severity the player taught the app (MX3) and never bookmarked
 * severity-3 mistakes (MX5). Both now call autoDetectMistakes.
 *
 * Reads the cached match and timeline only, never Riot. Skips a candidate whose tag is unknown or archived,
 * and every mistake the game already has (see mistakeDedupe.ts), so it can run any number of times.
 */
export type AutoDetectResult = {
  created: number
  skipped: number
  reason: 'ok' | 'no-game' | 'no-cache' | 'detector-error'
}

/** A cached match and its timeline, already parsed (the post-game path parses them once, audit E09). */
export type ParsedMatch = { match: unknown; timeline: unknown }

export async function autoDetectMistakes(gameId: string, parsed?: ParsedMatch | null): Promise<AutoDetectResult> {
  const prisma = getPrisma()
  const game = await prisma.game.findUnique({ where: { id: gameId } })
  if (!game?.matchId) return { created: 0, skipped: 0, reason: 'no-game' }
  let source: { match: unknown; timeline: unknown }
  if (parsed) {
    source = parsed
  } else {
    const cache = await prisma.matchCache.findUnique({ where: { matchId: game.matchId } })
    const timeline = cache ? timelineFromRow(prisma, game.matchId, cache.timelineJson) : null
    if (!cache?.matchJson || !timeline) return { created: 0, skipped: 0, reason: 'no-cache' }
    source = { match: cache.matchJson, timeline }
  }

  const user = await prisma.user.findFirst({ where: { isActive: true } })
  const accounts = user ? await prisma.account.findMany({ where: { userId: user.id } }) : []
  const userPuuids = user ? [user.puuid, ...accounts.map((a) => a.puuid)].filter((p) => !!p) : []

  let candidates: MistakeCandidate[]
  try {
    candidates = detectMistakes(source.timeline as any, source.match as any, {
      puuids: userPuuids,
      championName: game.champion,
      win: game.win,
    })
  } catch (err) {
    console.warn('[mistake] detector failed:', (err as Error)?.message ?? err)
    return { created: 0, skipped: 0, reason: 'detector-error' }
  }
  if (candidates.length === 0) return { created: 0, skipped: 0, reason: 'ok' }

  const slugs = [...new Set(candidates.map((c) => c.tagSlug))]
  const tags = await prisma.mistakeTag.findMany({ where: { slug: { in: slugs }, archivedAt: null } })
  const tagBySlug = new Map(tags.map((t) => [t.slug, t]))

  // Every mistake the game already has, whoever made it (auto, micro-review answer, by hand).
  const known = await mistakeDuplicateIndex(gameId)

  // MX3: per-tag severity learned from this player repeatedly deleting it.
  const tunings = user
    ? await prisma.mistakeTagTuning.findMany({ where: { userId: user.id, tagId: { in: tags.map((t) => t.id) } } })
    : []
  const deltaByTagId = new Map(tunings.map((t) => [t.tagId, t.severityDelta]))

  let created = 0
  let skipped = 0
  const newlyCreated: AutoBookmarkCandidate[] = []
  for (const c of candidates) {
    const tag = tagBySlug.get(c.tagSlug)
    if (!tag) { skipped++; continue }
    if (known.has(tag.id, c.gameTimeSec)) { skipped++; continue }
    const severity = applySeverityDelta(Math.min(3, Math.max(1, c.severity ?? 2)), deltaByTagId.get(tag.id) ?? 0)
    await prisma.mistake.create({
      data: {
        gameId,
        tagId: tag.id,
        gameTimeSec: Math.max(0, Math.floor(c.gameTimeSec)),
        note: c.note ?? null,
        severity,
        autoDetected: true,
      },
    })
    created++
    newlyCreated.push({ tagSlug: c.tagSlug, tagLabel: tag.label, gameTimeSec: c.gameTimeSec, severity })
    known.add(tag.id, c.gameTimeSec)
  }
  if (created > 0) console.log(`[mistake] auto-detected ${created} mistake(s) for game ${gameId} (${skipped} skipped)`)
  if (newlyCreated.some((c) => c.severity >= 3)) await autoBookmarkSevereMistakes(gameId, game.duration, newlyCreated)
  return { created, skipped, reason: 'ok' }
}

/** The post-game path: never throws, the player did not ask for it. */
export async function autoDetectMistakesSilently(gameId: string, parsed?: ParsedMatch | null): Promise<void> {
  try {
    await autoDetectMistakes(gameId, parsed)
  } catch (err) {
    console.warn('[mistake] auto-detect failed:', (err as Error)?.message ?? err)
  }
}

/**
 * MX5: a severity-3 mistake with a linked recording gets a bookmark at `t − 15s`, so the clip is ready to
 * re-watch without hunting for it. Best-effort: skipped entirely when the recording has no trustworthy
 * `startOffsetSec` (see mistakeBookmarks.ts).
 */
async function autoBookmarkSevereMistakes(gameId: string, gameDurationSec: number, candidates: AutoBookmarkCandidate[]): Promise<void> {
  try {
    const prisma = getPrisma()
    const recording = await prisma.recording.findUnique({ where: { gameId } })
    if (!recording) return
    const existing = await prisma.bookmark.findMany({ where: { recordingId: recording.id }, select: { videoTimeMs: true } })
    const plan = planAutoBookmarks(candidates, {
      startOffsetSec: recording.startOffsetSec,
      gameDurationSec,
      existingVideoTimesMs: existing.map((b) => b.videoTimeMs),
    })
    for (const b of plan) {
      await prisma.bookmark.create({ data: { recordingId: recording.id, videoTimeMs: b.videoTimeMs, label: b.label, color: '#E24C3A' } })
    }
    if (plan.length) console.log(`[mistake] auto-bookmarked ${plan.length} mistake(s) for game ${gameId}`)
  } catch (err) {
    console.warn('[mistake] auto-bookmark failed:', (err as Error)?.message ?? err)
  }
}
