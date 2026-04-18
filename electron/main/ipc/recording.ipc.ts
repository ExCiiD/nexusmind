import { ipcMain, dialog, app, BrowserWindow, desktopCapturer } from 'electron'
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
import { existsSync, readdirSync, statSync, unlinkSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, extname, dirname, basename } from 'path'
import { matchRecordingToGame } from '../recordingMatch'

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

    console.log('[scan] Done:', { scanned: allFiles.length, matched: matched.length, orphaned: orphanedCount, pruned: pruneCount })

    return {
      scanned: allFiles.length,
      matched: matched.length,
      orphaned: orphanedCount,
      dismissed: dismissed.size,
      pruned: pruneCount,
      clipsReconciled,
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
      // #region agent log
      fetch('http://127.0.0.1:7592/ingest/2e2c5cfc-8184-45ae-9d68-00280a0bc26b',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'a7df7e'},body:JSON.stringify({sessionId:'a7df7e',location:'recording.ipc.ts:link-file',message:'link-file called',data:{gameId,filePath},timestamp:Date.now(),hypothesisId:'H1'})}).catch(()=>{});
      // #endregion
      const existing = await prisma.recording.findUnique({ where: { gameId } })
      // #region agent log
      fetch('http://127.0.0.1:7592/ingest/2e2c5cfc-8184-45ae-9d68-00280a0bc26b',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'a7df7e'},body:JSON.stringify({sessionId:'a7df7e',location:'recording.ipc.ts:link-file-lookup',message:'findUnique result',data:{gameId,existingId:existing?.id??null},timestamp:Date.now(),hypothesisId:'H1'})}).catch(()=>{});
      // #endregion
      const rec = existing
        ? await prisma.recording.update({ where: { id: existing.id }, data: { filePath, source: 'manual' } })
        : await prisma.recording.create({ data: { gameId, filePath, source: 'manual' } })

      generateThumbnailForRecording(rec.id, filePath).catch(() => {})

      return rec
    } catch (err) {
      // #region agent log
      fetch('http://127.0.0.1:7592/ingest/2e2c5cfc-8184-45ae-9d68-00280a0bc26b',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'a7df7e'},body:JSON.stringify({sessionId:'a7df7e',location:'recording.ipc.ts:link-file-error',message:'link-file failed',data:{gameId,error:String(err)},timestamp:Date.now(),hypothesisId:'H1'})}).catch(()=>{});
      // #endregion
      console.error('[recording:link-file] Failed to link recording:', err)
      return { error: 'link_failed', message: (err as Error)?.message ?? String(err) }
    }
  })

  ipcMain.handle('recording:set-youtube', async (_event, gameId: string, youtubeUrl: string | null) => {
    const prisma = getPrisma()
    const existing = await prisma.recording.findUnique({ where: { gameId } })
    return existing
      ? prisma.recording.update({ where: { id: existing.id }, data: { youtubeUrl } })
      : prisma.recording.create({ data: { gameId, youtubeUrl, source: 'youtube' } })
  })

  ipcMain.handle('recording:delete', async (_event, gameId: string) => {
    const prisma = getPrisma()
    const recordings = await prisma.recording.findMany({ where: { gameId } })
    const status = recordingManager.getStatus()
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
    const captureStatus = recordingManager.getStatus()
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
      audioDesktopEnabled: user?.recordAudioDesktop ?? true,
      audioDesktopDevice: user?.recordAudioDesktopDevice,
      audioMicEnabled: user?.recordAudioMic ?? false,
      audioMicDevice: user?.recordAudioMicDevice,
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
        const existingRec = await prisma.recording.findUnique({ where: { gameId } })
        const rec = existingRec
          ? await prisma.recording.update({ where: { id: existingRec.id }, data: { filePath: path, source: 'capture' } })
          : await prisma.recording.create({ data: { gameId, filePath: path, source: 'capture' } })
        recordingManager.clearPendingRecording()
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

    // Generate thumbnail for the clip
    const thumbPath = join(dirname(clipPath), `${basename(clipPath, '.mp4')}.thumb.jpg`)
    const thumbOffset = Math.min(30, ((opts.endMs - opts.startMs) / 1000) * 0.12)
    const thumbResult = await generateThumbnail(clipPath, thumbPath, thumbOffset)

    const clipId = `clip_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    await prisma.$executeRawUnsafe(
      `INSERT INTO "Clip" ("id","recordingId","filePath","thumbnailPath","title","startMs","endMs","linkedNoteText","createdAt")
       VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`,
      clipId,
      opts.recordingId,
      clipPath,
      thumbResult ?? null,
      opts.title ?? null,
      opts.startMs,
      opts.endMs,
      opts.linkedNoteText ?? null,
    )
    console.log(`[clip:create] Clip saved to DB: ${clipId} → ${clipPath}`)

    return {
      id: clipId,
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
