import { ipcMain, dialog, app } from 'electron'
import { getPrisma } from '../database'
import {
  recordingManager,
  isFfmpegAvailable,
  generateThumbnail,
  generateThumbnailForRecording,
  createClip,
  getFileSize,
  type ClipOptions,
} from '../recorder'
import { existsSync, readdirSync, statSync, unlinkSync } from 'fs'
import { join, extname, dirname, basename } from 'path'
import { homedir } from 'os'
import { matchRecordingToGame } from '../recordingMatch'

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mkv', '.avi', '.mov', '.webm', '.flv'])

function getKnownRecordingPaths(): Record<string, string> {
  const local = process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local')
  const roaming = process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming')

  return {
    outplayed: join(local, 'Outplayed', 'Videos', 'League of Legends'),
    insightcapture: join(roaming, 'InsightCapture', 'recordings'),
    obs: join(homedir(), 'Videos'),
    // NexusMind's own capture folder
    nexusmind: recordingManager.getRecordingsDir(),
  }
}

function findVideoFiles(dir: string): Array<{ path: string; createdAt: Date; size: number }> {
  if (!existsSync(dir)) return []
  try {
    return readdirSync(dir)
      .filter((f) => VIDEO_EXTENSIONS.has(extname(f).toLowerCase()))
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

export function registerRecordingHandlers() {
  ipcMain.handle('recording:scan', async () => {
    const prisma = getPrisma()
    const user = await prisma.user.findFirst({ where: { isActive: true } })
    if (!user) throw new Error('No user found')

    const paths = getKnownRecordingPaths()

    // Include the user's external recording folder if configured
    if (user.externalRecordingPath) {
      paths['external'] = user.externalRecordingPath
    }

    const allFiles: Array<{ path: string; createdAt: Date; source: string }> = []

    for (const [source, dir] of Object.entries(paths)) {
      const files = findVideoFiles(dir).map((f) => ({ ...f, source }))
      allFiles.push(...files)
    }

    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const games = await prisma.game.findMany({
      where: {
        session: { userId: user.id },
        gameEndAt: { gte: cutoff },
        recording: null,
      },
      orderBy: { gameEndAt: 'desc' },
    })

    const matched: Array<{ gameId: string; filePath: string; source: string }> = []

    for (const game of games) {
      for (const file of allFiles) {
        if (matchRecordingToGame(file.createdAt, game.gameEndAt, game.duration)) {
          matched.push({ gameId: game.id, filePath: file.path, source: file.source })
          break
        }
      }
    }

    const newlyMatchedIds: Array<{ id: string; filePath: string }> = []
    for (const match of matched) {
      const rec = await prisma.recording.upsert({
        where: { gameId: match.gameId },
        create: { gameId: match.gameId, filePath: match.filePath, source: match.source },
        update: { filePath: match.filePath, source: match.source },
      })
      if (!rec.thumbnailPath) newlyMatchedIds.push({ id: rec.id, filePath: match.filePath })
    }

    // Save unmatched video files as orphaned recordings (gameId = null)
    const matchedPaths = new Set(matched.map((m) => m.filePath))
    const existingPaths = new Set(
      (await prisma.recording.findMany({ select: { filePath: true } }))
        .map((r) => r.filePath)
        .filter(Boolean) as string[]
    )
    let orphanedCount = 0
    const newlyOrphanedIds: Array<{ id: string; filePath: string }> = []
    for (const file of allFiles) {
      if (!matchedPaths.has(file.path) && !existingPaths.has(file.path)) {
        const rec = await prisma.recording.create({
          data: { filePath: file.path, source: file.source, createdAt: file.createdAt },
        })
        newlyOrphanedIds.push({ id: rec.id, filePath: file.path })
        orphanedCount++
      }
    }

    // Reset stale thumbnailPath values where the file no longer exists on disk
    const allWithThumb = await prisma.recording.findMany({
      where: { thumbnailPath: { not: null } },
      select: { id: true, thumbnailPath: true },
    })
    for (const rec of allWithThumb) {
      if (rec.thumbnailPath && !existsSync(rec.thumbnailPath)) {
        await prisma.$executeRawUnsafe(`UPDATE "Recording" SET "thumbnailPath" = NULL WHERE "id" = ?`, rec.id)
      }
    }

    // Generate thumbnails for all recordings that still have none
    const allWithoutThumb = await prisma.recording.findMany({
      where: { filePath: { not: null }, thumbnailPath: null },
      select: { id: true, filePath: true },
    })
    for (const { id, filePath } of allWithoutThumb) {
      generateThumbnailForRecording(id, filePath!).catch(() => {})
    }

    return {
      scanned: allFiles.length,
      matched: matched.length,
      orphaned: orphanedCount,
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

    // Open the dialog directly in the user's external recordings folder if set
    if (user?.externalRecordingPath) {
      dialogOptions.defaultPath = user.externalRecordingPath
    }

    const result = await dialog.showOpenDialog(dialogOptions)
    if (result.canceled || !result.filePaths[0]) return null

    const rec = await prisma.recording.upsert({
      where: { gameId },
      create: { gameId, filePath: result.filePaths[0], source: 'manual' },
      update: { filePath: result.filePaths[0], source: 'manual' },
    })

    // Generate thumbnail in background
    generateThumbnailForRecording(rec.id, result.filePaths[0]).catch(() => {})

    return rec
  })

  ipcMain.handle('recording:set-youtube', async (_event, gameId: string, youtubeUrl: string | null) => {
    const prisma = getPrisma()
    return prisma.recording.upsert({
      where: { gameId },
      create: { gameId, youtubeUrl, source: 'youtube' },
      update: { youtubeUrl },
    })
  })

  ipcMain.handle('recording:delete', async (_event, gameId: string) => {
    const prisma = getPrisma()
    await prisma.recording.deleteMany({ where: { gameId } })
    return { success: true }
  })

  ipcMain.handle('recording:delete-by-id', async (_event, recordingId: string) => {
    const prisma = getPrisma()
    await prisma.recording.delete({ where: { id: recordingId } })
    return { success: true }
  })

  ipcMain.handle('recording:get-scan-paths', async () => {
    const prisma = getPrisma()
    const user = await prisma.user.findFirst({ where: { isActive: true } })
    const paths = getKnownRecordingPaths()
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
    return { ...recordingManager.getStatus(), ffmpegAvailable: isFfmpegAvailable() }
  })

  ipcMain.handle('recording:start-capture', async () => {
    const prisma = getPrisma()
    const user = await prisma.user.findFirst({ where: { isActive: true } })
    const path = await recordingManager.startRecording({
      recordingPath: user?.recordingPath,
      recordQuality: user?.recordQuality,
      recordFps: user?.recordFps,
      recordEncoder: user?.recordEncoder,
    })
    return { started: !!path, filePath: path }
  })

  ipcMain.handle('recording:pick-folder', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Select recordings folder',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (result.canceled || !result.filePaths[0]) return null
    return result.filePaths[0]
  })

  ipcMain.handle('recording:stop-capture', async (_event, gameId?: string) => {
    const path = recordingManager.stopRecording()
    if (!path) return { stopped: false }

    // If a gameId is provided, link the recording immediately
    if (gameId) {
      try {
        const prisma = getPrisma()
        const rec = await prisma.recording.upsert({
          where: { gameId },
          create: { gameId, filePath: path, source: 'capture' },
          update: { filePath: path, source: 'capture' },
        })
        recordingManager.clearPendingRecording()
        // Generate thumbnail in background
        generateThumbnailForRecording(rec.id, path).catch(() => {})
      } catch (err) {
        console.error('[recording] Failed to link manual capture:', err)
      }
    }

    return { stopped: true, filePath: path }
  })

  ipcMain.handle('recording:get-recordings-dir', () => {
    return recordingManager.getRecordingsDir()
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

    // Generate thumbnail for the clip
    const thumbPath = join(dirname(clipPath), `${basename(clipPath, '.mp4')}.thumb.jpg`)
    const thumbOffset = Math.min(30, ((opts.endMs - opts.startMs) / 1000) * 0.12)
    const thumbResult = await generateThumbnail(clipPath, thumbPath, thumbOffset)

    const clip = await prisma.$executeRawUnsafe(
      `INSERT INTO "Clip" ("id","recordingId","filePath","thumbnailPath","title","startMs","endMs","linkedNoteText","createdAt")
       VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`,
      `clip_${Date.now()}`,
      opts.recordingId,
      clipPath,
      thumbResult ?? null,
      opts.title ?? null,
      opts.startMs,
      opts.endMs,
      opts.linkedNoteText ?? null,
    )

    return {
      filePath: clipPath,
      thumbnailPath: thumbResult ?? null,
      title: opts.title ?? null,
      startMs: opts.startMs,
      endMs: opts.endMs,
      fileSize: getFileSize(clipPath),
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

  ipcMain.handle('clip:set-youtube', async (_e, clipId: string, youtubeUrl: string) => {
    await getPrisma().$executeRawUnsafe(
      `UPDATE "Clip" SET "youtubeUrl" = ? WHERE "id" = ?`,
      youtubeUrl,
      clipId,
    )
    return true
  })

  ipcMain.handle('clip:set-temp-share', async (_e, clipId: string, url: string, expiryHours: number) => {
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
