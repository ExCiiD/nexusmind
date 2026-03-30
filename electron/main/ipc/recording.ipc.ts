import { ipcMain, dialog } from 'electron'
import { getPrisma } from '../database'
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
  // Recording file is created just after game ends; check within 10 min window
  const diff = recordingCreatedAt.getTime() - gameEndAt.getTime()
  return diff >= -60_000 && diff <= windowMs
}

export function registerRecordingHandlers() {
  ipcMain.handle('recording:scan', async () => {
    const prisma = getPrisma()
    const user = await prisma.user.findFirst()
    if (!user) throw new Error('No user found')

    const paths = getKnownRecordingPaths()
    const allFiles: Array<{ path: string; createdAt: Date; source: string }> = []

    for (const [source, dir] of Object.entries(paths)) {
      const files = findVideoFiles(dir).map((f) => ({ ...f, source }))
      allFiles.push(...files)
    }

    // Find unrecorded games in the last 30 days
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

    // Auto-create recordings for matched games
    for (const match of matched) {
      await prisma.recording.upsert({
        where: { gameId: match.gameId },
        create: {
          gameId: match.gameId,
          filePath: match.filePath,
          source: match.source,
        },
        update: {
          filePath: match.filePath,
          source: match.source,
        },
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
    const result = await dialog.showOpenDialog({
      title: 'Select Recording File',
      filters: [
        { name: 'Video Files', extensions: ['mp4', 'mkv', 'avi', 'mov', 'webm', 'flv'] },
      ],
      properties: ['openFile'],
    })
    if (result.canceled || !result.filePaths[0]) return null

    const prisma = getPrisma()
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
}
