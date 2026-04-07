import { ipcMain, dialog, app } from 'electron'
import { getPrisma } from '../database'
import { recordingManager, isFfmpegAvailable } from '../recorder'
import { existsSync, readdirSync, statSync } from 'fs'
import { join, extname } from 'path'
import { homedir } from 'os'

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

function matchRecordingToGame(
  recordingCreatedAt: Date,
  gameEndAt: Date,
  windowMs = 10 * 60 * 1000,
): boolean {
  const diff = recordingCreatedAt.getTime() - gameEndAt.getTime()
  return diff >= -60_000 && diff <= windowMs
}

export function registerRecordingHandlers() {
  ipcMain.handle('recording:scan', async () => {
    const prisma = getPrisma()
    const user = await prisma.user.findFirst({ where: { isActive: true } })
    if (!user) throw new Error('No user found')

    const paths = getKnownRecordingPaths()
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
        if (matchRecordingToGame(file.createdAt, game.gameEndAt)) {
          matched.push({ gameId: game.id, filePath: file.path, source: file.source })
          break
        }
      }
    }

    for (const match of matched) {
      await prisma.recording.upsert({
        where: { gameId: match.gameId },
        create: { gameId: match.gameId, filePath: match.filePath, source: match.source },
        update: { filePath: match.filePath, source: match.source },
      })
    }

    return {
      scanned: allFiles.length,
      matched: matched.length,
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

    return prisma.recording.upsert({
      where: { gameId },
      create: { gameId, filePath: result.filePaths[0], source: 'manual' },
      update: { filePath: result.filePaths[0], source: 'manual' },
    })
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

  ipcMain.handle('recording:get-scan-paths', async () => {
    const paths = getKnownRecordingPaths()
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
        await prisma.recording.upsert({
          where: { gameId },
          create: { gameId, filePath: path, source: 'capture' },
          update: { filePath: path, source: 'capture' },
        })
        recordingManager.clearPendingRecording()
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
        game: { session: { userId: user.id } },
      },
      orderBy: { createdAt: 'desc' },
    })

    const matchIds = recordings.map((r) => r.game.matchId).filter(Boolean) as string[]
    const caches = await prisma.matchCache.findMany({
      where: { matchId: { in: matchIds } },
      select: { matchId: true, matchJson: true },
    })
    const cacheByMatchId = new Map(caches.map((c) => [c.matchId, c.matchJson]))

    const defaultName = user.displayName || user.summonerName

    return recordings.map((rec) => {
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
        sessionObjectiveId: rec.game.session.objectiveId,
        accountName,
      }
    })
  })
}
