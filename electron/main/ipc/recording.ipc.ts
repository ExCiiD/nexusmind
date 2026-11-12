import { ipcMain, dialog, app, BrowserWindow, desktopCapturer, shell } from 'electron'
import { getPrisma } from '../database'
import { z } from 'zod'
import { validatedHandle, id, httpsUrl, youtubeUrl as youtubeUrlSchema } from './validate'
import { getActiveRecorder } from '../recorderBackend'
import {
  recordingManager,
  isFfmpegAvailable,
  generateThumbnailForRecording,
  createClip,
  getFileSize,
  probeReadable,
  waitUntilReadable,
  type ClipOptions,
} from '../recorder'
import { getAudioDevicesSummary, resolveMicDeviceName } from '../audio'
import { existsSync, readdirSync, statSync, unlinkSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, extname, dirname, basename } from 'path'
import { matchRecordingToGame } from '../recordingMatch'
import {
  getAnyQueueMatchIds,
  getMatch,
  getMatchTimeline,
  extractPlayerStats,
  isQueueSessionEligible,
} from '../riotClient'

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mkv', '.avi', '.mov', '.webm', '.flv'])

// ── Dismissed paths: prevents re-import of user-deleted recordings on scan ──

function getDismissedPathsFile(): string {
  const dataDir = join(app.getPath('userData'), 'data')
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true })
  return join(dataDir, 'dismissed_recordings.json')
}

function loadDismissedPaths(): Set<string> {
  try {
    const raw = readFileSync(getDismissedPathsFile(), 'utf-8')
    const arr = JSON.parse(raw)
    return new Set(Array.isArray(arr) ? arr : [])
  } catch {
    return new Set()
  }
}

function saveDismissedPaths(paths: Set<string>): void {
  try {
    writeFileSync(getDismissedPathsFile(), JSON.stringify([...paths]), 'utf-8')
  } catch { /* non-fatal */ }
}

function dismissPath(filePath: string): void {
  const paths = loadDismissedPaths()
  paths.add(filePath)
  saveDismissedPaths(paths)
}

/** Deletes a recording's video file + thumbnail from disk. */
function deleteRecordingFiles(rec: { filePath?: string | null; thumbnailPath?: string | null }) {
  if (rec.filePath && existsSync(rec.filePath)) {
    try { unlinkSync(rec.filePath) } catch { /* ignore */ }
  }
  if (rec.thumbnailPath && existsSync(rec.thumbnailPath)) {
    try { unlinkSync(rec.thumbnailPath) } catch { /* ignore */ }
  }
}

/** Deletes a clip's video file + thumbnail from disk. */
function deleteClipFiles(clip: { filePath?: string | null; thumbnailPath?: string | null }) {
  if (clip.filePath && existsSync(clip.filePath)) {
    try { unlinkSync(clip.filePath) } catch { /* ignore */ }
  }
  if (clip.thumbnailPath && existsSync(clip.thumbnailPath)) {
    try { unlinkSync(clip.thumbnailPath) } catch { /* ignore */ }
  }
}

function getRecordingPaths(userRecordingPath?: string | null): Record<string, string> {
  return {
    nexusmind: recordingManager.getRecordingsDir(userRecordingPath),
  }
}

function findVideoFiles(dir: string): Array<{ path: string; createdAt: Date; size: number }> {
  if (!existsSync(dir)) return []
  try {
    return readdirSync(dir)
      .filter((f) => {
        const full = join(dir, f)
        try { return statSync(full).isFile() && VIDEO_EXTENSIONS.has(extname(f).toLowerCase()) }
        catch { return false }
      })
      .map((f) => {
        const fullPath = join(dir, f)
        const stat = statSync(fullPath)
        return { path: fullPath, createdAt: stat.birthtime, size: stat.size }
      })
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  } catch {
    return []
  }
}

/**
 * Discovers clip video files (filenames starting with `clip_`) in a recording
 * directory and registers any that are missing from the Clip table.
 * Matches each orphan to its most likely parent Recording by creation date.
 */
async function reconcileOrphanClips(baseDir: string): Promise<number> {
  if (!existsSync(baseDir)) return 0

  const prisma = getPrisma()
  let reconciled = 0

  // Also check legacy clips/ subfolder if it exists
  const dirsToScan = [baseDir]
  const legacyClipsDir = join(baseDir, 'clips')
  if (existsSync(legacyClipsDir)) dirsToScan.push(legacyClipsDir)

  const clipFiles: Array<{ path: string; createdAt: Date; size: number }> = []
  for (const dir of dirsToScan) {
    for (const f of findVideoFiles(dir)) {
      if (basename(f.path).startsWith('clip_')) clipFiles.push(f)
    }
  }
  if (clipFiles.length === 0) return 0

  const existingClips: Array<{ filePath: string }> = await prisma.$queryRawUnsafe(
    `SELECT "filePath" FROM "Clip"`,
  )
  const knownPaths = new Set(existingClips.map((c) => c.filePath))

  const parentRecordings = await prisma.recording.findMany({
    where: { filePath: { not: null } },
    select: { id: true, filePath: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  })
  const normalizeDir = (p: string) => p.replace(/\\/g, '/').toLowerCase()
  const baseDirNorm = normalizeDir(baseDir)
  const recordingsInDir = parentRecordings.filter(
    (r) => r.filePath && normalizeDir(dirname(r.filePath)) === baseDirNorm,
  )

  for (const file of clipFiles) {
    if (knownPaths.has(file.path)) continue

    const parent = recordingsInDir.find((r) => r.createdAt <= file.createdAt)
    if (!parent) continue

    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "Clip" ("id","recordingId","filePath","title","startMs","endMs","createdAt")
         VALUES (?,?,?,?,0,0,?)`,
        `clip_reconciled_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        parent.id,
        file.path,
        basename(file.path, extname(file.path)),
        file.createdAt.toISOString(),
      )
      reconciled++
    } catch (err) {
      console.warn('[recording:scan] Failed to reconcile clip:', file.path, err)
    }
  }

  return reconciled
}

// ── Orphan-recording backfill ────────────────────────────────────────────────
//
// Recordings end up "orphan" (gameId = null) when the user captured a video
// outside an active NexusMind session OR on an account that wasn't linked
// at the time. The scan flow only matches orphans to EXISTING Game rows —
// it can't create new ones. This module fills that gap: for each orphan,
// query Riot's match history on every linked account and create a Game row
// (in a one-off "review-only" session) when a match lines up with the
// recording's wall-clock timestamp.
//
// Cheap-by-design: 1 short match-IDs call per account + N short match
// fetches (cached after the first time). Only runs when there's at least
// one orphan, so a typical scan with no orphans pays nothing.

const REVIEW_ONLY_OBJECTIVE_ID = '__review_only__'

/**
 * Returns the per-user session that hosts backfilled Game rows for games
 * the user played outside of any active NexusMind session. Created on
 * first need, then reused. Always marked `status: 'closed'` and tagged
 * via `objectiveId` so other queries can filter it out of session KPIs.
 */
async function getOrCreateReviewOnlySession(userId: string): Promise<string> {
  const prisma = getPrisma()
  const existing = await prisma.session.findFirst({
    where: { userId, objectiveId: REVIEW_ONLY_OBJECTIVE_ID },
  })
  if (existing) return existing.id
  const created = await prisma.session.create({
    data: {
      userId,
      objectiveId: REVIEW_ONLY_OBJECTIVE_ID,
      status: 'closed',
      sessionConclusion:
        'System container for backfilled games (videos linked to Riot matches that were played outside any active session).',
    },
  })
  console.log(`[backfill] Created review-only session ${created.id} for user ${userId}`)
  return created.id
}

interface BackfillResult {
  /** Total orphans considered this run. */
  considered: number
  /** Orphans that got linked to a (new or existing) Game row. */
  linked: number
  /** Orphans we couldn't find a match for. */
  notFound: number
  /** Orphans skipped because the matching game already has a recording. */
  skipped: number
}

/**
 * For each candidate orphan recording, look it up in Riot's match history
 * (all linked accounts, all queues), create / reuse the Game row, and
 * link it. `recordingIds` lets callers backfill a specific recording
 * instead of every orphan — used by the manual "Try to link" button.
 *
 * Returns a tally so the caller can show a toast like
 * "Linked 1 recording, 2 not found".
 */
async function backfillOrphanRecordings(opts: { recordingIds?: string[] } = {}): Promise<BackfillResult> {
  const prisma = getPrisma()
  const user = await prisma.user.findFirst({ where: { isActive: true } })
  if (!user) return { considered: 0, linked: 0, notFound: 0, skipped: 0 }

  // Pull all puuids we know about — main account + every linked smurf.
  const accounts = await prisma.account.findMany({ where: { userId: user.id } })
  const allAccounts: Array<{ puuid: string; region: string }> = [
    { puuid: user.puuid, region: user.region },
    ...accounts.map((a) => ({ puuid: a.puuid, region: a.region })),
  ].filter((a) => typeof a.puuid === 'string' && a.puuid.length > 0)
  if (allAccounts.length === 0) return { considered: 0, linked: 0, notFound: 0, skipped: 0 }

  // Candidate orphans: those with a real file on disk and no game link.
  const orphans = await prisma.recording.findMany({
    where: {
      gameId: null,
      filePath: { not: null },
      ...(opts.recordingIds ? { id: { in: opts.recordingIds } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: opts.recordingIds ? opts.recordingIds.length : 50,
  })
  if (orphans.length === 0) return { considered: 0, linked: 0, notFound: 0, skipped: 0 }

  console.log(`[backfill] Considering ${orphans.length} orphan recording(s) across ${allAccounts.length} account(s)`)

  // Fetch recent match IDs across all queues, per account. Sequential to
  // stay friendly with Riot's rate limit — these are quick calls.
  const matchIdsByAccount: Array<{ puuid: string; region: string; matchIds: string[] }> = []
  for (const acc of allAccounts) {
    try {
      const ids = await getAnyQueueMatchIds(acc.puuid, acc.region, 20)
      matchIdsByAccount.push({ ...acc, matchIds: ids })
      console.log(`[backfill] Fetched ${ids.length} recent match IDs for puuid ${acc.puuid.slice(0, 8)}…`)
    } catch (err) {
      console.warn(`[backfill] Failed to fetch match IDs for ${acc.puuid.slice(0, 8)}…:`, (err as Error)?.message ?? err)
    }
  }

  // Pre-fetch match data once per matchId (cache then network) so we don't
  // re-download the same payload for several orphans that happen to share
  // an account's history window.
  const matchDataCache = new Map<string, { data: any; region: string }>()
  async function loadMatch(matchId: string, region: string): Promise<any | null> {
    if (matchDataCache.has(matchId)) return matchDataCache.get(matchId)!.data
    const cached = await prisma.matchCache.findUnique({ where: { matchId } })
    if (cached?.matchJson) {
      try {
        const parsed = JSON.parse(cached.matchJson)
        matchDataCache.set(matchId, { data: parsed, region })
        return parsed
      } catch { /* fall through to network */ }
    }
    try {
      const md = await getMatch(matchId, region)
      if (md) {
        matchDataCache.set(matchId, { data: md, region })
        // Persist for future timeline lookups (event extractor).
        await prisma.matchCache
          .upsert({
            where: { matchId },
            create: { matchId, matchJson: JSON.stringify(md) },
            update: { matchJson: JSON.stringify(md) },
          })
          .catch(() => {})
        return md
      }
    } catch (err) {
      console.warn(`[backfill] getMatch(${matchId}) failed:`, (err as Error)?.message ?? err)
    }
    return null
  }

  let linked = 0
  let notFound = 0
  let skipped = 0

  for (const orphan of orphans) {
    let bestMatch: { matchData: any; puuid: string; region: string; matchId: string } | null = null

    // Try every account's recent matches in order, stop at first time-fit.
    for (const acc of matchIdsByAccount) {
      for (const matchId of acc.matchIds) {
        const md = await loadMatch(matchId, acc.region)
        if (!md?.info) continue
        const gameEndMs: number | undefined = md.info.gameEndTimestamp
        const durationSec: number | undefined = md.info.gameDuration
        if (!gameEndMs || !durationSec) continue
        if (matchRecordingToGame(orphan.createdAt, new Date(gameEndMs), durationSec)) {
          bestMatch = { matchData: md, puuid: acc.puuid, region: acc.region, matchId }
          break
        }
      }
      if (bestMatch) break
    }

    if (!bestMatch) {
      console.log(`[backfill] No Riot match found for orphan ${orphan.id} (createdAt=${orphan.createdAt.toISOString()})`)
      notFound++
      continue
    }

    // Reuse an existing Game row if we already have one for this matchId,
    // otherwise create one in the review-only session.
    let gameId: string
    const existingGame = await prisma.game.findUnique({ where: { matchId: bestMatch.matchId } })
    if (existingGame) {
      const existingRec = await prisma.recording.findUnique({ where: { gameId: existingGame.id } })
      if (existingRec && existingRec.id !== orphan.id) {
        console.log(`[backfill] Game ${existingGame.id} already linked to recording ${existingRec.id}; skipping orphan ${orphan.id}`)
        skipped++
        continue
      }
      gameId = existingGame.id
    } else {
      const stats = extractPlayerStats(bestMatch.matchData, bestMatch.puuid)
      if (!stats) {
        console.warn(`[backfill] extractPlayerStats failed for match ${bestMatch.matchId} puuid ${bestMatch.puuid.slice(0, 8)}…`)
        notFound++
        continue
      }
      const queueType = stats.queueType ?? 'unknown'
      const sessionEligible = isQueueSessionEligible(queueType)
      const reviewSessionId = await getOrCreateReviewOnlySession(user.id)
      const newGame = await prisma.game.create({
        data: {
          sessionId: reviewSessionId,
          matchId: bestMatch.matchId,
          champion: stats.champion,
          role: stats.role,
          kills: stats.kills,
          deaths: stats.deaths,
          assists: stats.assists,
          cs: stats.cs,
          visionScore: stats.visionScore,
          duration: stats.duration,
          win: stats.win,
          gameEndAt: stats.gameEndAt,
          queueType,
          // Backfilled games are always outside a real session, so they
          // never count toward session KPIs — even if queue is ranked.
          isSessionEligible: false,
          opponentChampion: stats.opponentChampion ?? null,
        },
      })
      gameId = newGame.id
      console.log(
        `[backfill] Created Game ${gameId} from match ${bestMatch.matchId} ` +
          `(${stats.champion}, ${stats.win ? 'WIN' : 'LOSS'}, queue=${queueType}, eligible=${sessionEligible})`,
      )
    }

    // Compute startOffsetSec so the markers line up with video time.
    // Source the recording start instant from the FILE's birthtime (when
    // available), NOT from the DB createdAt column — for orphan rows
    // created by older flows the column might hold the DB insertion time
    // rather than the actual recording start, which would yield an offset
    // of hundreds of seconds and push every marker outside the video range.
    //
    // Fallback chain: file birthtime → file mtime → orphan.createdAt.
    let startOffsetSec: number | null = null
    try {
      const gameEndMs: number = bestMatch.matchData.info.gameEndTimestamp
      const durationSec: number = bestMatch.matchData.info.gameDuration
      const gameStartMs = gameEndMs - durationSec * 1000

      let recordingStartMs: number | null = null
      if (orphan.filePath && existsSync(orphan.filePath)) {
        try {
          const s = statSync(orphan.filePath)
          recordingStartMs = s.birthtimeMs || s.mtimeMs || null
        } catch { /* file unreadable */ }
      }
      if (recordingStartMs == null) recordingStartMs = orphan.createdAt.getTime()

      const candidate = (recordingStartMs - gameStartMs) / 1000
      // Sanity: a real offset is small (a few minutes max). Anything wilder
      // means the recording wasn't actually for this game OR one of our
      // timestamps is bogus; in that case we leave startOffsetSec null and
      // let the player fall back to the duration-based heuristic (which
      // assumes recording ended ~at gameEnd, almost always true).
      if (Math.abs(candidate) <= 600) {
        startOffsetSec = candidate
      } else {
        console.warn(
          `[backfill] Computed startOffsetSec=${candidate.toFixed(1)}s for ${orphan.id} is implausible — leaving null so the player uses the duration-based fallback.`,
        )
      }
    } catch (err) {
      console.warn('[backfill] startOffsetSec computation failed:', (err as Error)?.message ?? err)
    }

    await prisma.recording.update({
      where: { id: orphan.id },
      data: {
        gameId,
        ...(startOffsetSec !== null ? { startOffsetSec } : {}),
      },
    })
    linked++
    console.log(`[backfill] Linked recording ${orphan.id} → game ${gameId}` + (startOffsetSec !== null ? ` (offset=${startOffsetSec.toFixed(1)}s)` : ''))

    // Eagerly cache the match-timeline-v5 blob NOW so the player doesn't
    // have to hit Riot the first time the user opens the recording (and
    // also so we surface any fetch failure during the visible backfill
    // step instead of silently in the player). The event extractor needs
    // BOTH matchJson and timelineJson — matchJson is already cached by
    // loadMatch() above, timelineJson is the missing piece.
    try {
      const existingCache = await prisma.matchCache.findUnique({ where: { matchId: bestMatch.matchId } })
      if (!existingCache?.timelineJson) {
        const timelineData = await getMatchTimeline(bestMatch.matchId, bestMatch.region)
        if (timelineData) {
          await prisma.matchCache.upsert({
            where: { matchId: bestMatch.matchId },
            create: {
              matchId: bestMatch.matchId,
              matchJson: JSON.stringify(bestMatch.matchData),
              timelineJson: JSON.stringify(timelineData),
            },
            update: { timelineJson: JSON.stringify(timelineData) },
          })
          const frameCount = timelineData?.info?.frames?.length ?? 0
          console.log(`[backfill] Cached timeline for ${bestMatch.matchId} (${frameCount} frames)`)
        }
      }
    } catch (err) {
      console.warn(`[backfill] Timeline pre-fetch for ${bestMatch.matchId} failed (player will retry):`, (err as Error)?.message ?? err)
    }
  }

  return { considered: orphans.length, linked, notFound, skipped }
}

export function registerRecordingHandlers() {
  ipcMain.handle('recording:scan', async () => {
    const prisma = getPrisma()
    const user = await prisma.user.findFirst({ where: { isActive: true } })
    if (!user) throw new Error('No user found')

    const paths = getRecordingPaths(user.recordingPath)

    if (user.externalRecordingPath) {
      paths['external'] = user.externalRecordingPath
    }

    console.log('[scan] Active directories:', paths)

    // ── Step 1a: Fix dangling gameIds (game was deleted, recording remains) ──
    const danglingRows: Array<{ id: string }> = await prisma.$queryRawUnsafe(
      `SELECT r.id FROM "Recording" r LEFT JOIN "Game" g ON r."gameId" = g.id WHERE r."gameId" IS NOT NULL AND g.id IS NULL`,
    )
    if (danglingRows.length > 0) {
      console.log(`[scan] Fixing ${danglingRows.length} recording(s) with dangling gameId`)
      for (const row of danglingRows) {
        await prisma.$executeRawUnsafe(`UPDATE "Recording" SET "gameId" = NULL WHERE "id" = ?`, row.id)
      }
    }

    // ── Step 1b: Prune stale DB entries (file missing or outside active dirs) ──
    let pruneCount = 0
    const activeDirs = new Set(Object.values(paths).map((d) => d.replace(/\\/g, '/').toLowerCase()))
    const allRecordings = await prisma.recording.findMany({
      where: { filePath: { not: null } },
      select: { id: true, filePath: true, gameId: true },
    })
    for (const rec of allRecordings) {
      if (!rec.filePath) continue
      const norm = rec.filePath.replace(/\\/g, '/').toLowerCase()
      const parentDir = norm.substring(0, norm.lastIndexOf('/'))
      const isInActiveDir = [...activeDirs].some((d) => parentDir === d || parentDir.startsWith(d + '/'))
      if (!isInActiveDir || !existsSync(rec.filePath)) {
        console.log('[scan] Pruning stale recording:', rec.filePath, { isInActiveDir, exists: existsSync(rec.filePath) })
        await prisma.$executeRawUnsafe(`DELETE FROM "Clip" WHERE "recordingId" = ?`, rec.id)
        await prisma.recording.delete({ where: { id: rec.id } })
        pruneCount++
      }
    }

    // ── Step 2: Prune dismissed paths for files that no longer exist ──────
    const dismissed = loadDismissedPaths()
    if (dismissed.size > 0) {
      let pruned = false
      for (const p of dismissed) {
        if (!existsSync(p)) { dismissed.delete(p); pruned = true }
      }
      if (pruned) saveDismissedPaths(dismissed)
    }

    // ── Step 3: Scan video files on disk ─────────────────────────────────
    const allFiles: Array<{ path: string; createdAt: Date; source: string }> = []

    for (const [source, dir] of Object.entries(paths)) {
      const files = findVideoFiles(dir).map((f) => ({ ...f, source }))
      console.log(`[scan] Found ${files.length} video files in ${dir} (${source})`)
      allFiles.push(...files)
    }

    // ── Step 4: Match files to unlinked games ────────────────────────────
    //
    // Deduplication invariants enforced here (fixes duplicate VOD records bug):
    //   1) A given filePath can only ever be matched to ONE game per scan.
    //   2) A filePath that is already linked to ANY existing Recording is
    //      treated as off-limits for new matches in this scan.
    //
    // Without these guards, `matchRecordingToGame` (±5 min window) could happily
    // match the same video to several back-to-back games, producing duplicate
    // Recording rows pointing to the same `filePath`.
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const games = await prisma.game.findMany({
      where: {
        session: { userId: user.id },
        gameEndAt: { gte: cutoff },
        recording: null,
      },
      orderBy: { gameEndAt: 'desc' },
    })

    const alreadyLinkedPaths = new Set(
      (await prisma.recording.findMany({
        where: { filePath: { not: null } },
        select: { filePath: true },
      }))
        .map((r) => r.filePath)
        .filter(Boolean) as string[],
    )

    const matched: Array<{ gameId: string; filePath: string; source: string }> = []
    const matchedFilePaths = new Set<string>()

    for (const game of games) {
      for (const file of allFiles) {
        if (matchedFilePaths.has(file.path)) continue
        if (alreadyLinkedPaths.has(file.path)) continue
        if (matchRecordingToGame(file.createdAt, game.gameEndAt, game.duration)) {
          matched.push({ gameId: game.id, filePath: file.path, source: file.source })
          matchedFilePaths.add(file.path)
          break
        }
      }
    }

    const newlyMatchedIds: Array<{ id: string; filePath: string }> = []
    for (const match of matched) {
      const existing = await prisma.recording.findUnique({ where: { gameId: match.gameId } })
      const rec = existing
        ? await prisma.recording.update({ where: { id: existing.id }, data: { filePath: match.filePath, source: match.source } })
        : await prisma.recording.create({ data: { gameId: match.gameId, filePath: match.filePath, source: match.source } })
      if (!rec.thumbnailPath) newlyMatchedIds.push({ id: rec.id, filePath: match.filePath })
    }

    // ── Step 5: Create orphan records (DB is clean from step 1) ──────────
    const matchedPaths = new Set(matched.map((m) => m.filePath))
    const existingPaths = new Set(
      (await prisma.recording.findMany({ select: { filePath: true } }))
        .map((r) => r.filePath)
        .filter(Boolean) as string[],
    )
    let orphanedCount = 0
    const newlyOrphanedIds: Array<{ id: string; filePath: string }> = []
    for (const file of allFiles) {
      if (basename(file.path).startsWith('clip_')) continue
      const inMatched = matchedPaths.has(file.path)
      const inExisting = existingPaths.has(file.path)
      const inDismissed = dismissed.has(file.path)
      if (!inMatched && !inExisting && !inDismissed) {
        console.log('[scan] Creating orphan for:', file.path)
        const rec = await prisma.recording.create({
          data: { filePath: file.path, source: file.source, createdAt: file.createdAt },
        })
        newlyOrphanedIds.push({ id: rec.id, filePath: file.path })
        orphanedCount++
      } else if (!basename(file.path).startsWith('clip_')) {
        console.log('[scan] Skipping file:', file.path, { inMatched, inExisting, inDismissed })
      }
    }

    // ── Step 6: Regenerate thumbnails ────────────────────────────────────
    const allWithThumb = await prisma.recording.findMany({
      where: { thumbnailPath: { not: null } },
      select: { id: true, thumbnailPath: true },
    })
    for (const rec of allWithThumb) {
      if (!rec.thumbnailPath) continue
      let shouldReset = false
      if (!existsSync(rec.thumbnailPath)) {
        shouldReset = true
      } else {
        try {
          const thumbSize = statSync(rec.thumbnailPath).size
          if (thumbSize < 3000) shouldReset = true
        } catch { shouldReset = true }
      }
      if (shouldReset) {
        await prisma.$executeRawUnsafe(`UPDATE "Recording" SET "thumbnailPath" = NULL WHERE "id" = ?`, rec.id)
      }
    }

    const allWithoutThumb = await prisma.recording.findMany({
      where: { filePath: { not: null }, thumbnailPath: null },
      select: { id: true, filePath: true },
    })
    const THUMB_CONCURRENCY = 3
    for (let i = 0; i < allWithoutThumb.length; i += THUMB_CONCURRENCY) {
      const batch = allWithoutThumb.slice(i, i + THUMB_CONCURRENCY)
      await Promise.allSettled(
        batch.map(({ id, filePath }) => generateThumbnailForRecording(id, filePath!)),
      )
    }

    // ── Step 7: Reconcile orphan clip files ──────────────────────────────
    let clipsReconciled = 0
    const uniqueDirs = new Set(Object.values(paths))
    for (const dir of uniqueDirs) {
      clipsReconciled += await reconcileOrphanClips(dir)
    }

    // ── Step 8: Final dedup safety net — remove duplicate Recording rows ─
    //
    // Even with Step 4's guards, legacy data from older scans may already
    // contain duplicates (multiple Recording rows pointing to the same
    // filePath). We collapse them by keeping ONE row per filePath, prioritizing
    // rows that already have a gameId (so we don't lose game associations).
    let duplicatesRemoved = 0
    const dupGroups: Array<{ filePath: string; cnt: bigint }> = await prisma.$queryRawUnsafe(
      `SELECT "filePath", COUNT(*) as cnt FROM "Recording" WHERE "filePath" IS NOT NULL GROUP BY "filePath" HAVING COUNT(*) > 1`,
    )
    for (const group of dupGroups) {
      const rows = await prisma.recording.findMany({
        where: { filePath: group.filePath },
        orderBy: [{ gameId: 'desc' }, { createdAt: 'asc' }],
      })
      const keep = rows[0]
      const toDelete = rows.slice(1)
      for (const row of toDelete) {
        await prisma.$executeRawUnsafe(`DELETE FROM "Clip" WHERE "recordingId" = ?`, row.id)
        await prisma.recording.delete({ where: { id: row.id } })
        duplicatesRemoved++
      }
      console.log(`[scan] Collapsed ${rows.length} duplicate recordings → kept ${keep.id} for ${group.filePath}`)
    }

    // ── Step 9: Sweep orphan .thumb.jpg files (clip thumbnails no longer used) ──
    //
    // We've removed clip thumbnail generation (to avoid 2 files per clip).
    // Existing .thumb.jpg files still on disk for clips have no DB reference
    // anymore — wipe them.
    let orphanThumbsRemoved = 0
    try {
      const knownThumbs = new Set<string>()
      const allRecsWithThumbs = await prisma.recording.findMany({ where: { thumbnailPath: { not: null } }, select: { thumbnailPath: true } })
      for (const r of allRecsWithThumbs) if (r.thumbnailPath) knownThumbs.add(r.thumbnailPath)
      const allClipsWithThumbs: Array<{ thumbnailPath: string | null }> = await prisma.$queryRawUnsafe(
        `SELECT "thumbnailPath" FROM "Clip" WHERE "thumbnailPath" IS NOT NULL`,
      )
      for (const c of allClipsWithThumbs) if (c.thumbnailPath) knownThumbs.add(c.thumbnailPath)

      for (const dir of uniqueDirs) {
        if (!existsSync(dir)) continue
        try {
          for (const f of readdirSync(dir)) {
            if (!f.endsWith('.thumb.jpg')) continue
            const full = join(dir, f)
            if (knownThumbs.has(full)) continue
            // Only sweep clip thumbnails (paired with clip_*.mp4 files)
            const baseName = f.replace(/\.thumb\.jpg$/, '')
            if (!baseName.startsWith('clip_')) continue
            try { unlinkSync(full); orphanThumbsRemoved++ } catch { /* ignore */ }
          }
        } catch { /* ignore dir read errors */ }
      }
    } catch (err) {
      console.warn('[scan] Orphan thumb sweep failed:', err)
    }

    // ── Step 10: Riot-history backfill for orphan recordings ──────────────
    //
    // Anything still orphaned at this point couldn't be matched against an
    // existing Game row. Try to recover them by asking Riot directly:
    // each linked account's recent match list is scanned, and any match
    // whose end-time falls in the recording's ±5min window gets a freshly
    // created Game row + link. No-op (and free) when there are no orphans
    // or no linked accounts.
    let backfill: BackfillResult = { considered: 0, linked: 0, notFound: 0, skipped: 0 }
    try {
      backfill = await backfillOrphanRecordings()
      if (backfill.considered > 0) {
        console.log(
          `[scan] Backfill: considered=${backfill.considered} linked=${backfill.linked} notFound=${backfill.notFound} skipped=${backfill.skipped}`,
        )
      }
    } catch (err) {
      console.warn('[scan] Backfill failed (non-fatal):', err)
    }

    console.log('[scan] Done:', { scanned: allFiles.length, matched: matched.length, orphaned: orphanedCount, pruned: pruneCount, duplicatesRemoved, orphanThumbsRemoved, backfillLinked: backfill.linked })

    return {
      scanned: allFiles.length,
      matched: matched.length + backfill.linked,
      orphaned: Math.max(0, orphanedCount - backfill.linked),
      dismissed: dismissed.size,
      pruned: pruneCount,
      clipsReconciled,
      duplicatesRemoved,
      orphanThumbsRemoved,
      backfillLinked: backfill.linked,
      backfillNotFound: backfill.notFound,
      paths: Object.entries(paths).map(([source, dir]) => ({
        source,
        dir,
        exists: existsSync(dir),
      })),
    }
  })

  ipcMain.handle('recording:get', async (_event, gameId: string) => {
    const prisma = getPrisma()
    return prisma.recording.findUnique({ where: { gameId } })
  })

  ipcMain.handle('recording:get-by-id', async (_event, recordingId: string) => {
    const prisma = getPrisma()
    return prisma.recording.findUnique({ where: { id: recordingId } })
  })

  ipcMain.handle('recording:link-file', async (_event, gameId: string) => {
    const prisma = getPrisma()

    const user = await prisma.user.findFirst({ where: { isActive: true } })

    const dialogOptions: Electron.OpenDialogOptions = {
      title: 'Select Recording File',
      filters: [
        { name: 'Video Files', extensions: ['mp4', 'mkv', 'avi', 'mov', 'webm', 'flv'] },
      ],
      properties: ['openFile'],
    }

    // Prefer the in-app recordings folder when it exists on disk, so the
    // picker opens where NexusMind's own captures are saved. Fall back to the
    // external recordings folder, then to the user's Videos directory.
    const recordingsDir = user?.recordingPath
      ? recordingManager.getRecordingsDir(user.recordingPath)
      : recordingManager.getRecordingsDir()

    if (recordingsDir && existsSync(recordingsDir)) {
      dialogOptions.defaultPath = recordingsDir
    } else if (user?.externalRecordingPath && existsSync(user.externalRecordingPath)) {
      dialogOptions.defaultPath = user.externalRecordingPath
    }

    const parentWindow = BrowserWindow.getFocusedWindow() ?? undefined
    const result = parentWindow
      ? await dialog.showOpenDialog(parentWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions)

    if (result.canceled || !result.filePaths[0]) return null

    const filePath = result.filePaths[0]

    if (!existsSync(filePath)) {
      console.error(`[recording:link-file] Selected file does not exist: ${filePath}`)
      return { error: 'file_not_found', message: `File not found: ${filePath}` }
    }

    try {
      const existing = await prisma.recording.findUnique({ where: { gameId } })
      const rec = existing
        ? await prisma.recording.update({ where: { id: existing.id }, data: { filePath, source: 'manual' } })
        : await prisma.recording.create({ data: { gameId, filePath, source: 'manual' } })

      generateThumbnailForRecording(rec.id, filePath).catch(() => {})

      return rec
    } catch (err) {
      console.error('[recording:link-file] Failed to link recording:', err)
      return { error: 'link_failed', message: (err as Error)?.message ?? String(err) }
    }
  })

  validatedHandle('recording:set-youtube', z.tuple([id, youtubeUrlSchema.nullable()]), async (_event, gameId, youtubeUrl) => {
    const prisma = getPrisma()
    const existing = await prisma.recording.findUnique({ where: { gameId } })
    return existing
      ? prisma.recording.update({ where: { id: existing.id }, data: { youtubeUrl } })
      : prisma.recording.create({ data: { gameId, youtubeUrl, source: 'youtube' } })
  })

  ipcMain.handle('recording:delete', async (_event, gameId: string) => {
    const prisma = getPrisma()
    const recordings = await prisma.recording.findMany({ where: { gameId } })
    const status = getActiveRecorder().getStatus()
    for (const rec of recordings) {
      if (status.isRecording && rec.filePath && status.filePath === rec.filePath) {
        throw new Error('Cannot delete a recording that is currently being captured.')
      }
    }
    for (const rec of recordings) {
      if (rec.filePath) dismissPath(rec.filePath)
      deleteRecordingFiles(rec)
      const clips: any[] = await prisma.$queryRawUnsafe(
        `SELECT * FROM "Clip" WHERE "recordingId" = ?`, rec.id,
      )
      for (const clip of clips) deleteClipFiles(clip)
      await prisma.$executeRawUnsafe(`DELETE FROM "Clip" WHERE "recordingId" = ?`, rec.id)
    }
    await prisma.recording.deleteMany({ where: { gameId } })
    return { success: true }
  })

  ipcMain.handle('recording:delete-by-id', async (_event, recordingId: string) => {
    const prisma = getPrisma()
    const rec = await prisma.recording.findUnique({ where: { id: recordingId } })
    if (!rec) return { success: false }
    const captureStatus = getActiveRecorder().getStatus()
    if (captureStatus.isRecording && rec.filePath && captureStatus.filePath === rec.filePath) {
      throw new Error('Cannot delete a recording that is currently being captured.')
    }
    if (rec.filePath) dismissPath(rec.filePath)
    deleteRecordingFiles(rec)
    const clips: any[] = await prisma.$queryRawUnsafe(
      `SELECT * FROM "Clip" WHERE "recordingId" = ?`, rec.id,
    )
    for (const clip of clips) deleteClipFiles(clip)
    await prisma.$executeRawUnsafe(`DELETE FROM "Clip" WHERE "recordingId" = ?`, rec.id)
    await prisma.recording.delete({ where: { id: recordingId } })
    return { success: true }
  })

  // Manual backfill — used by the "Try to link" button on orphan
  // recording cards. Passing a recordingId limits the lookup to that
  // single orphan (cheaper / faster than rescanning everything).
  ipcMain.handle('recording:backfill-orphans', async (_event, recordingId?: string) => {
    return backfillOrphanRecordings(recordingId ? { recordingIds: [recordingId] } : {})
  })

  ipcMain.handle('recording:unlink', async (_event, gameId: string) => {
    const prisma = getPrisma()
    await prisma.recording.updateMany({ where: { gameId }, data: { gameId: null } })
    return { success: true }
  })

  ipcMain.handle('recording:reset-dismissed', async () => {
    saveDismissedPaths(new Set())
    return { success: true }
  })

  ipcMain.handle('recording:get-scan-paths', async () => {
    const prisma = getPrisma()
    const user = await prisma.user.findFirst({ where: { isActive: true } })
    const paths = getRecordingPaths(user?.recordingPath)
    if (user?.externalRecordingPath) {
      paths['external'] = user.externalRecordingPath
    }
    return Object.entries(paths).map(([source, dir]) => ({
      source,
      dir,
      exists: existsSync(dir),
    }))
  })

  // ── Capture control ──────────────────────────────────────────────────────────

  ipcMain.handle('recording:get-capture-status', () => {
    // MUST query the currently active recorder (WGC or ddagrab). Using the
    // legacy `recordingManager` unconditionally caused the sidebar badge to
    // flip off mid-game when WGC was the real capture engine.
    const status = getActiveRecorder().getStatus()
    return { ...status, ffmpegAvailable: isFfmpegAvailable() }
  })

  ipcMain.handle('recording:start-capture', async () => {
    const prisma = getPrisma()
    const user = await prisma.user.findFirst({ where: { isActive: true } })

    // Resolve mic device at the moment capture starts so that:
    //   - A stored device id/name maps to a current ffmpeg-compatible device name.
    //   - "Default" (null/empty) is translated to the live Windows default input,
    //     instead of silently dropping audio (which was the previous behaviour).
    const micEnabled = user?.recordAudioMic ?? false
    const micDeviceName = micEnabled
      ? await resolveMicDeviceName(user?.recordAudioMicDevice ?? null)
      : null
    if (micEnabled && !micDeviceName) {
      console.warn('[recording] Mic enabled but no input device resolved — recording will have no microphone track')
    }

    // Use the active recorder (WGC or ddagrab) — previously hard-coded to
    // `recordingManager` (ddagrab), which silently no-op'd when WGC was the
    // active backend and made manual capture a no-op for the default install.
    const path = await getActiveRecorder().startRecording({
      recordingPath: user?.recordingPath,
      recordQuality: user?.recordQuality,
      recordFps: user?.recordFps,
      recordEncoder: user?.recordEncoder,
      audioDesktopEnabled: user?.recordAudioDesktop ?? true,
      audioDesktopDevice: user?.recordAudioDesktopDevice,
      audioMicEnabled: micEnabled,
      audioMicDevice: micDeviceName,
    })
    return { started: !!path, filePath: path }
  })

  // Lists audio devices via native-audio-node (stable OS-level ids, no Chromium
  // permission prompt, no "Default - " ephemeral label prefix issues).
  ipcMain.handle('audio:list-devices', async () => {
    return getAudioDevicesSummary()
  })

  // Opens the native Windows sound panel so the user can change their default
  // output/input. Uses the ms-settings URI scheme on Windows; falls back to
  // the legacy mmsys.cpl control panel applet if the URI scheme is unavailable.
  ipcMain.handle('system:open-sound-settings', async () => {
    if (process.platform !== 'win32') {
      return { opened: false, reason: 'unsupported-platform' as const }
    }
    try {
      // Modern Windows 10/11 — opens Settings > System > Sound directly.
      await shell.openExternal('ms-settings:sound')
      return { opened: true as const }
    } catch {
      try {
        // Legacy fallback — opens the classic Sound control panel.
        await shell.openPath('C:\\Windows\\System32\\mmsys.cpl')
        return { opened: true as const }
      } catch (err) {
        return { opened: false, reason: 'failed' as const, error: (err as Error).message }
      }
    }
  })

  ipcMain.handle('recording:pick-folder', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Select recordings folder',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (result.canceled || !result.filePaths[0]) return null
    return result.filePaths[0]
  })

  ipcMain.handle('recording:stop-capture', async (event, gameId?: string) => {
    // Same flow as the auto game-end path:
    //   1) stopRecording() returns the initial path (.webm for WGC)
    //   2) waitForDone() blocks until ffmpeg/remux completes (or 90s timeout)
    //   3) probe + poll until the file demuxes cleanly
    //   4) only THEN persist + link, so the UI never sees a 0:00 file
    const activeRecorder = getActiveRecorder()
    const initialPath = activeRecorder.stopRecording()
    if (!initialPath) return { stopped: false }

    const win = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow()
    win?.webContents.send('recording:processing', { gameId, source: 'manual' })

    await activeRecorder.waitForDone(90_000)
    let finalPath = activeRecorder.getPendingRecording() ?? initialPath

    // Block raw .webm — same guard as the auto path.
    if (finalPath.toLowerCase().endsWith('.webm')) {
      console.warn('[recording] Manual stop produced a .webm — remux likely still in flight')
      const probe = await probeReadable(finalPath)
      if (!probe.ok) {
        win?.webContents.send('recording:failed', { reason: 'remux_pending', filePath: finalPath })
        return { stopped: true, filePath: finalPath, ready: false as const }
      }
      // If remux DID complete, getPendingRecording() should now return the .mp4
      finalPath = activeRecorder.getPendingRecording() ?? finalPath
    }

    let probe = await probeReadable(finalPath)
    if (!probe.ok) {
      const dur = await waitUntilReadable(finalPath, { timeoutMs: 60_000, intervalMs: 2_000 })
      probe = { ok: dur > 0, durationSec: dur }
    }

    let rec: { id: string } | null = null
    if (gameId) {
      try {
        const prisma = getPrisma()
        const existingRec = await prisma.recording.findUnique({ where: { gameId } })
        rec = existingRec
          ? await prisma.recording.update({ where: { id: existingRec.id }, data: { filePath: finalPath, source: 'capture' } })
          : await prisma.recording.create({ data: { gameId, filePath: finalPath, source: 'capture' } })
        activeRecorder.clearPendingRecording()
        if (rec) generateThumbnailForRecording(rec.id, finalPath).catch(() => {})
      } catch (err) {
        console.error('[recording] Failed to link manual capture:', err)
      }
    }

    win?.webContents.send('recording:ready', {
      recordingId: rec?.id ?? null,
      gameId,
      filePath: finalPath,
      durationSec: probe.durationSec,
    })
    if (gameId && rec) {
      win?.webContents.send('recording:linked', { gameId, filePath: finalPath })
    }

    return { stopped: true, filePath: finalPath, ready: probe.ok, durationSec: probe.durationSec }
  })

  ipcMain.handle('recording:get-recordings-dir', () => {
    return recordingManager.getRecordingsDir()
  })

  ipcMain.handle('recording:get-desktop-source', async () => {
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
    return sources[0]?.id ?? null
  })

  /**
   * Returns all recordings joined with their game/session data, sorted newest first.
   * Used by the Replays page to show a browsable library of recorded games.
   */
  ipcMain.handle('recording:list-with-games', async () => {
    const prisma = getPrisma()
    const user = await prisma.user.findFirst({ where: { isActive: true } })
    if (!user) return []

    const accounts = await prisma.account.findMany({ where: { userId: user.id } })
    const allPuuids = [user.puuid, ...accounts.map((a) => a.puuid)]

    const recordings = await prisma.recording.findMany({
      include: {
        game: {
          include: {
            session: { select: { objectiveId: true } },
            review: { select: { id: true } },
          },
        },
      },
      where: {
        OR: [
          { game: { session: { userId: user.id } } },
          { gameId: null },
        ],
      },
      orderBy: { createdAt: 'desc' },
    })

    const matchIds = recordings.map((r) => r.game?.matchId).filter(Boolean) as string[]
    const caches = await prisma.matchCache.findMany({
      where: { matchId: { in: matchIds } },
      select: { matchId: true, matchJson: true },
    })
    const cacheByMatchId = new Map(caches.map((c) => [c.matchId, c.matchJson]))

    const defaultName = user.displayName || user.summonerName

    // Fetch clip counts per recording
    const recordingIds = recordings.map((r) => r.id)
    const clipCounts: Array<{ recordingId: string; cnt: number }> = recordingIds.length > 0
      ? await prisma.$queryRawUnsafe(
          `SELECT "recordingId", COUNT(*) as cnt FROM "Clip" WHERE "recordingId" IN (${recordingIds.map(() => '?').join(',')}) GROUP BY "recordingId"`,
          ...recordingIds,
        )
      : []
    const clipCountMap = new Map(clipCounts.map((r) => [r.recordingId, Number(r.cnt)]))

    return recordings.map((rec) => {
      // Orphaned recording: no linked game
      if (!rec.game) {
        const fileName = rec.filePath
          ? rec.filePath.replace(/\\/g, '/').split('/').pop() ?? 'Recording'
          : 'Recording'
        return {
          recordingId: rec.id,
          gameId: null,
          filePath: rec.filePath,
          youtubeUrl: rec.youtubeUrl,
          source: rec.source,
          thumbnailPath: rec.thumbnailPath ?? null,
          clipCount: clipCountMap.get(rec.id) ?? 0,
          champion: fileName,
          opponentChampion: null,
          win: false,
          kills: 0,
          deaths: 0,
          assists: 0,
          duration: 0,
          gameEndAt: rec.createdAt.toISOString(),
          hasReview: false,
          reviewId: null,
          sessionObjectiveId: '',
          queueType: 'unknown',
          isSessionEligible: false,
          accountName: undefined,
          isOrphaned: true,
        }
      }

      let accountName = defaultName
      const raw = rec.game.matchId ? cacheByMatchId.get(rec.game.matchId) : null
      if (raw) {
        try {
          const matchData = JSON.parse(raw)
          const participants: any[] = matchData.info?.participants ?? []
          const matchedPuuid = allPuuids.find((p) => participants.some((pp: any) => pp.puuid === p))
          if (matchedPuuid && matchedPuuid !== user.puuid) {
            const acc = accounts.find((a) => a.puuid === matchedPuuid)
            if (acc) accountName = acc.gameName ?? defaultName
          }
        } catch { /* ignore */ }
      }

      return {
        recordingId: rec.id,
        gameId: rec.gameId,
        filePath: rec.filePath,
        youtubeUrl: rec.youtubeUrl,
        source: rec.source,
        thumbnailPath: rec.thumbnailPath ?? null,
        clipCount: clipCountMap.get(rec.id) ?? 0,
        champion: rec.game.champion,
        opponentChampion: rec.game.opponentChampion,
        win: rec.game.win,
        kills: rec.game.kills,
        deaths: rec.game.deaths,
        assists: rec.game.assists,
        duration: rec.game.duration,
        gameEndAt: rec.game.gameEndAt.toISOString(),
        hasReview: rec.game.review !== null,
        reviewId: rec.game.review?.id ?? null,
        sessionObjectiveId: rec.game.session?.objectiveId ?? '',
        queueType: rec.game.queueType,
        isSessionEligible: rec.game.isSessionEligible,
        accountName,
        isOrphaned: false,
      }
    })
  })

  // ── Thumbnail ────────────────────────────────────────────────────────────────

  ipcMain.handle('recording:generate-thumbnail', async (_e, recordingId: string) => {
    const prisma = getPrisma()
    const rec = await prisma.recording.findUnique({ where: { id: recordingId } })
    if (!rec?.filePath) return null
    return generateThumbnailForRecording(recordingId, rec.filePath)
  })

  // ── Clip handlers ────────────────────────────────────────────────────────────

  ipcMain.handle('clip:create', async (_e, opts: {
    recordingId: string
    startMs: number
    endMs: number
    title?: string
    linkedNoteText?: string
  }) => {
    const prisma = getPrisma()
    const rec = await prisma.recording.findUnique({ where: { id: opts.recordingId } })
    if (!rec?.filePath || !existsSync(rec.filePath)) {
      throw new Error('Source recording file not found')
    }

    const user = await prisma.user.findFirst({ where: { isActive: true } })
    const outputDir = recordingManager.getRecordingsDir(user?.recordingPath)

    const clipOptions: ClipOptions = {
      recordingId: opts.recordingId,
      filePath: rec.filePath,
      title: opts.title,
      startMs: opts.startMs,
      endMs: opts.endMs,
      linkedNoteText: opts.linkedNoteText,
      outputDir,
    }

    const clipPath = await createClip(clipOptions)
    if (!clipPath) throw new Error('Clip creation failed')

    // NOTE: We intentionally DO NOT generate a thumbnail for clips anymore.
    // Each clip used to spawn a paired `.thumb.jpg` file, doubling the file
    // count in the recordings folder for marginal UX value (the UI falls back
    // to a Scissors icon). The Recording Hub's `ClipCard` already handles a
    // null `thumbnailPath` gracefully.
    const clipId = `clip_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    await prisma.$executeRawUnsafe(
      `INSERT INTO "Clip" ("id","recordingId","filePath","thumbnailPath","title","startMs","endMs","linkedNoteText","createdAt")
       VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`,
      clipId,
      opts.recordingId,
      clipPath,
      null,
      opts.title ?? null,
      opts.startMs,
      opts.endMs,
      opts.linkedNoteText ?? null,
    )
    console.log(`[clip:create] Clip saved to DB: ${clipId} → ${clipPath}`)

    return {
      id: clipId,
      filePath: clipPath,
      thumbnailPath: null,
      title: opts.title ?? null,
      startMs: opts.startMs,
      endMs: opts.endMs,
      fileSize: getFileSize(clipPath),
    }
  })

  /**
   * Exports a clip just like `clip:create`, but additionally reveals the
   * resulting mp4 in the OS file browser (Explorer / Finder). The
   * "Export" button in the clip editor uses this — semantically distinct
   * from "Save" (which keeps the clip in-app without surfacing the file).
   * Returns the Clip row + the source `filePath` so the renderer can show
   * a toast with the actual on-disk location.
   */
  ipcMain.handle('clip:export', async (_e, opts: {
    recordingId: string
    startMs: number
    endMs: number
    title?: string
    linkedNoteText?: string
  }) => {
    const prisma = getPrisma()
    const rec = await prisma.recording.findUnique({ where: { id: opts.recordingId } })
    if (!rec?.filePath || !existsSync(rec.filePath)) {
      throw new Error('Source recording file not found')
    }

    const user = await prisma.user.findFirst({ where: { isActive: true } })
    const outputDir = recordingManager.getRecordingsDir(user?.recordingPath)

    const clipPath = await createClip({
      recordingId: opts.recordingId,
      filePath: rec.filePath,
      title: opts.title,
      startMs: opts.startMs,
      endMs: opts.endMs,
      linkedNoteText: opts.linkedNoteText,
      outputDir,
    })
    if (!clipPath) throw new Error('Clip export failed (both stream-copy and re-encode attempts errored)')

    const clipId = `clip_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    await prisma.$executeRawUnsafe(
      `INSERT INTO "Clip" ("id","recordingId","filePath","thumbnailPath","title","startMs","endMs","linkedNoteText","createdAt")
       VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`,
      clipId,
      opts.recordingId,
      clipPath,
      null,
      opts.title ?? null,
      opts.startMs,
      opts.endMs,
      opts.linkedNoteText ?? null,
    )

    // Surface the exported file in the OS file manager. Wrapped in
    // try/catch so a missing OS handler (rare, but happens in CI sandboxes)
    // doesn't fail the whole export.
    try { shell.showItemInFolder(clipPath) } catch (err) {
      console.warn('[clip:export] showItemInFolder failed:', err)
    }

    console.log(`[clip:export] Clip exported: ${clipId} → ${clipPath}`)

    return {
      id: clipId,
      filePath: clipPath,
      thumbnailPath: null,
      title: opts.title ?? null,
      startMs: opts.startMs,
      endMs: opts.endMs,
      fileSize: getFileSize(clipPath),
      revealedInFolder: true,
    }
  })

  ipcMain.handle('clip:list', async (_e, recordingId: string) => {
    const prisma = getPrisma()
    const clips: any[] = await prisma.$queryRawUnsafe(
      `SELECT * FROM "Clip" WHERE "recordingId" = ? ORDER BY "createdAt" ASC`,
      recordingId,
    )
    return clips.map((c) => ({ ...c, fileSize: getFileSize(c.filePath) }))
  })

  /**
   * Returns every clip across all recordings, enriched with parent recording +
   * game metadata so the Record Hub can display them as standalone cards.
   */
  ipcMain.handle('clip:list-all', async () => {
    const prisma = getPrisma()
    const clips: any[] = await prisma.$queryRawUnsafe(
      `SELECT c.*, r."gameId", r."filePath" as "parentFilePath", r."thumbnailPath" as "parentThumbnail"
       FROM "Clip" c
       LEFT JOIN "Recording" r ON r."id" = c."recordingId"
       ORDER BY c."createdAt" DESC`,
    )

    const gameIds = clips.map((c) => c.gameId).filter(Boolean) as string[]
    const games = gameIds.length > 0
      ? await prisma.game.findMany({ where: { id: { in: gameIds } }, select: { id: true, champion: true, opponentChampion: true, win: true, duration: true } })
      : []
    const gameMap = new Map(games.map((g) => [g.id, g]))

    return clips.map((c) => {
      const game = c.gameId ? gameMap.get(c.gameId) : null
      return {
        clipId: c.id,
        recordingId: c.recordingId,
        filePath: c.filePath,
        thumbnailPath: c.thumbnailPath ?? c.parentThumbnail ?? null,
        title: c.title,
        startMs: Number(c.startMs),
        endMs: Number(c.endMs),
        createdAt: c.createdAt,
        fileSize: getFileSize(c.filePath),
        champion: game?.champion ?? null,
        opponentChampion: game?.opponentChampion ?? null,
        win: game?.win ?? false,
        duration: game ? Number(game.duration) : 0,
      }
    })
  })

  ipcMain.handle('clip:delete', async (_e, clipId: string) => {
    const prisma = getPrisma()
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT * FROM "Clip" WHERE "id" = ?`,
      clipId,
    )
    const clip = rows[0]
    if (!clip) return false

    // Delete video file
    if (clip.filePath && existsSync(clip.filePath)) {
      try { unlinkSync(clip.filePath) } catch { /* ignore */ }
    }
    // Delete thumbnail
    if (clip.thumbnailPath && existsSync(clip.thumbnailPath)) {
      try { unlinkSync(clip.thumbnailPath) } catch { /* ignore */ }
    }

    await prisma.$executeRawUnsafe(`DELETE FROM "Clip" WHERE "id" = ?`, clipId)
    return true
  })

  validatedHandle('clip:set-youtube', z.tuple([id, youtubeUrlSchema]), async (_e, clipId, youtubeUrl) => {
    await getPrisma().$executeRawUnsafe(
      `UPDATE "Clip" SET "youtubeUrl" = ? WHERE "id" = ?`,
      youtubeUrl,
      clipId,
    )
    return true
  })

  validatedHandle('clip:set-temp-share', z.tuple([id, httpsUrl, z.number().int().min(1).max(72)]), async (_e, clipId, url, expiryHours) => {
    const expiry = new Date(Date.now() + expiryHours * 3600 * 1000).toISOString()
    await getPrisma().$executeRawUnsafe(
      `UPDATE "Clip" SET "tempShareUrl" = ?, "tempShareExpiry" = ? WHERE "id" = ?`,
      url,
      expiry,
      clipId,
    )
    return true
  })
}
