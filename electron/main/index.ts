import { app, BrowserWindow, ipcMain, protocol } from 'electron'

// Suppress Chromium GPU shader disk-cache errors on Windows (access-denied / cache locked).
// The GPU shader cache is unnecessary for a desktop Electron app and only produces noise.
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache')

import { join } from 'path'
import { createReadStream, statSync, readFileSync, existsSync } from 'fs'
import { autoUpdater } from 'electron-updater'
import { initDatabase, getPrisma } from './database'
import { GameDetector } from './gameDetector'
import { recordingManager, isFfmpegAvailable, generateThumbnailForRecording } from './recorder'
import { registerAuthHandlers } from './ipc/auth.ipc'
import { registerSessionHandlers } from './ipc/session.ipc'
import { registerReviewHandlers } from './ipc/review.ipc'
import { registerAssessmentHandlers } from './ipc/assessment.ipc'
import { registerAnalyticsHandlers } from './ipc/analytics.ipc'
import { registerAIHandlers } from './ipc/ai.ipc'
import { registerStatsHandlers } from './ipc/stats.ipc'
import { registerAccountHandlers } from './ipc/account.ipc'
import { registerDevHandlers } from './ipc/dev.ipc'
import { registerRecordingHandlers } from './ipc/recording.ipc'
import { registerExternalReviewHandlers } from './ipc/externalReview.ipc'
import { registerShareHandlers } from './ipc/share.ipc'
import { registerCoachingHandlers } from './ipc/coaching.ipc'
import { registerYoutubeHandlers } from './ipc/youtube.ipc'
import { agentLog } from './debugAgentLog'

/** Resolves DB recording id for post-game navigation (path normalization + latest-capture fallback). */
async function resolveCaptureRecordingIdForGameEnd(
  matchData: { game?: { id: string } | null },
  pendingPath: string | null,
): Promise<string | undefined> {
  const prisma = getPrisma()
  if (matchData.game?.id) {
    const rec = await prisma.recording.findFirst({ where: { gameId: matchData.game.id } })
    return rec?.id ?? undefined
  }
  const norm = (p: string) => p.replace(/\\/g, '/').toLowerCase()
  if (pendingPath) {
    const exact = await prisma.recording.findFirst({ where: { filePath: pendingPath } })
    if (exact?.id) return exact.id
    const n = norm(pendingPath)
    const recent = await prisma.recording.findMany({
      where: { gameId: null },
      orderBy: { createdAt: 'desc' },
      take: 32,
    })
    const hit = recent.find((r) => r.filePath && norm(r.filePath) === n)
    if (hit?.id) return hit.id
  }
  const fallback = await prisma.recording.findFirst({
    where: { gameId: null, source: 'capture' },
    orderBy: { createdAt: 'desc' },
  })
  return fallback?.id ?? undefined
}

// Register before app is ready — allows the renderer to load local files via nxm:// URLs
// This bypasses the cross-origin restriction that blocks file:// in dev mode
protocol.registerSchemesAsPrivileged([{
  scheme: 'nxm',
  privileges: { secure: true, supportFetchAPI: true, stream: true },
}])

let mainWindow: BrowserWindow | null = null
let gameDetector: GameDetector | null = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    backgroundColor: '#010A13',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#010A13',
      symbolColor: '#A09B8C',
      height: 36,
    },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  recordingManager.setMainWindow(mainWindow)

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  ipcMain.handle('window:minimize', () => mainWindow?.minimize())
  ipcMain.handle('window:maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow?.maximize()
    }
  })
  ipcMain.handle('window:close', () => mainWindow?.close())
}

async function bootstrap() {
  // Serve local video files via nxm:// with proper Range/206 support for seeking.
  // net.fetch('file://') does NOT honour Range headers, so we read the file ourselves.
  protocol.handle('nxm', (request) => {
    const raw = request.url.replace('nxm://', '')
    const filePath = decodeURIComponent(raw.startsWith('/') ? raw : `/${raw}`)
      .replace(/\//g, '\\')
      .replace(/^\\/,  '')


    // Security: only serve media files — block directory traversal and arbitrary access
    const ALLOWED_EXTS = ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.flv', '.jpg', '.jpeg', '.png', '.webp']
    const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase()
    if (!ALLOWED_EXTS.includes(ext)) {
      return new Response('Forbidden: not a media file', { status: 403 })
    }
    const normalized = filePath.replace(/\\/g, '/').toLowerCase()
    if (normalized.includes('..')) {
      return new Response('Forbidden: path traversal', { status: 403 })
    }

    // Serve images directly (no Range support needed)
    const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp']
    if (IMAGE_EXTS.includes(ext)) {
      try {
        const data = readFileSync(filePath)
        const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg'
        return new Response(data, { status: 200, headers: { 'Content-Type': mime, 'Cache-Control': 'max-age=3600' } })
      } catch {
        return new Response('File not found', { status: 404 })
      }
    }

    let size: number
    try {
      size = statSync(filePath).size
    } catch {
      return new Response('File not found', { status: 404 })
    }

    const rangeHeader = request.headers.get('Range')
    if (rangeHeader) {
      const match = /bytes=(\d+)-(\d*)/.exec(rangeHeader)
      const start = match ? parseInt(match[1], 10) : 0
      const end = match && match[2] ? parseInt(match[2], 10) : size - 1
      const chunkSize = end - start + 1

      const stream = createReadStream(filePath, { start, end })
      const readable = new ReadableStream({
        start(controller) {
          stream.on('data', (chunk: Buffer | string) => controller.enqueue(typeof chunk === 'string' ? Buffer.from(chunk) : chunk))
          stream.on('end', () => controller.close())
          stream.on('error', (err) => controller.error(err))
        },
        cancel() { stream.destroy() },
      })

      return new Response(readable, {
        status: 206,
        headers: {
          'Content-Range': `bytes ${start}-${end}/${size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': String(chunkSize),
          'Content-Type': 'video/mp4',
        },
      })
    }

    // No Range header — serve the full file
    const stream = createReadStream(filePath)
    const readable = new ReadableStream({
      start(controller) {
        stream.on('data', (chunk: Buffer | string) => controller.enqueue(typeof chunk === 'string' ? Buffer.from(chunk) : chunk))
        stream.on('end', () => controller.close())
        stream.on('error', (err) => controller.error(err))
      },
      cancel() { stream.destroy() },
    })

    return new Response(readable, {
      status: 200,
      headers: {
        'Accept-Ranges': 'bytes',
        'Content-Length': String(size),
        'Content-Type': 'video/mp4',
      },
    })
  })

  await initDatabase()

  registerAuthHandlers()
  registerSessionHandlers()
  registerReviewHandlers()
  registerAssessmentHandlers()
  registerAnalyticsHandlers()
  registerAIHandlers()
  registerStatsHandlers()
  registerAccountHandlers()
  registerRecordingHandlers()
  registerExternalReviewHandlers()
  registerShareHandlers()
  registerCoachingHandlers()
  registerYoutubeHandlers()

  createWindow()
  registerDevHandlers(mainWindow!)
  setupAutoUpdater()

  gameDetector = new GameDetector(
    // onGameEnd: called after Riot API confirms the match
    async (matchData) => {
      mainWindow?.restore()
      mainWindow?.show()
      mainWindow?.focus()

      // Link any pending recording to this game (game is null for practice tool / untracked games)
      const pendingRecording = recordingManager.getPendingRecording()
      // #region agent log
      agentLog(
        'index.ts:onGameEnd',
        'entry',
        {
          gameId: matchData.game?.id ?? null,
          pendingTail: pendingRecording ? pendingRecording.slice(-120) : null,
          isSessionEligible: matchData.isSessionEligible,
        },
        'L1',
      )
      // #endregion

      if (matchData.game?.id) {
        if (!pendingRecording) {
          // #region agent log
          agentLog('index.ts:onGameEnd', 'skip-link-no-pending', { gameId: matchData.game.id }, 'L2')
          // #endregion
        }
        if (pendingRecording) {
          try {
            const prisma = getPrisma()
            const existing = await prisma.recording.findFirst({
              where: { filePath: pendingRecording, gameId: null },
            })
            // #region agent log
            agentLog(
              'index.ts:onGameEnd',
              'after-findFirst',
              {
                existingRecordingId: existing?.id ?? null,
                gameId: matchData.game.id,
                pendingTail: pendingRecording.slice(-120),
              },
              'L3',
            )
            // #endregion
            const rec = existing
              ? await prisma.recording.update({
                  where: { id: existing.id },
                  data: { gameId: matchData.game.id, source: 'capture' },
                })
              : await prisma.recording.upsert({
                  where: { gameId: matchData.game.id },
                  create: { gameId: matchData.game.id, filePath: pendingRecording, source: 'capture' },
                  update: { filePath: pendingRecording, source: 'capture' },
                })
            recordingManager.clearPendingRecording()
            mainWindow?.webContents.send('recording:linked', {
              gameId: matchData.game.id,
              filePath: pendingRecording,
            })
            console.log(`[main] Auto-linked recording to game ${matchData.game.id}`)
            generateThumbnailForRecording(rec.id, pendingRecording).catch((err) =>
              console.warn('[main] Thumbnail generation failed:', err),
            )
          } catch (err) {
            console.error('[main] Failed to link recording:', err)
            // #region agent log
            agentLog('index.ts:onGameEnd', 'link-prisma-error', { message: (err as Error)?.message ?? String(err) }, 'L3')
            // #endregion
          }
        }
      } else {
        if (pendingRecording) {
          console.log('[main] No game ID yet — recording kept pending for background enrich to link')
          // #region agent log
          agentLog('index.ts:onGameEnd', 'keep-pending-for-enrich', { pendingTail: pendingRecording.slice(-120), hasStats: matchData.stats != null }, 'L1')
          // #endregion
        }
      }

      let captureRecordingId: string | undefined
      try {
        captureRecordingId = await resolveCaptureRecordingIdForGameEnd(matchData, pendingRecording)
      } catch {
        /* ignore */
      }

      const payload = {
        ...matchData,
        captureRecordingId,
        suggestExternalReview: !matchData.game?.id && Boolean(captureRecordingId),
      }

      mainWindow?.webContents.send('game:ended', payload)

      if (matchData.isSessionEligible === false) {
        console.log('[main] Non-eligible queue — session review prompts may be suppressed in UI')
      }
    },

    // onGameStart: fires when live client responds for the first time
    async () => {
      try {
        const prisma = getPrisma()
        const user = await prisma.user.findFirst({ where: { isActive: true } })
        console.log(`[main] Game detected — autoRecord: ${user?.autoRecord}, ffmpeg: ${isFfmpegAvailable()}`)
        if (user?.autoRecord) {
          const path = await recordingManager.startRecording({
            recordingPath: user.recordingPath,
            recordQuality: user.recordQuality,
            recordFps: user.recordFps,
            recordEncoder: user.recordEncoder,
          })
          if (path) {
            mainWindow?.minimize()
            queueMicrotask(() => mainWindow?.webContents.send('recording:started'))
            console.log('[main] Recording started →', path)
          } else {
            console.warn('[main] startRecording() returned null — ffmpeg may be unavailable')
          }
        }
      } catch (err) {
        console.error('[main] onGameStart error:', err)
      }
    },

    // onGameRawEnd: fires immediately when live client stops (before Riot API match resolution)
    async () => {
      const stoppedPath = recordingManager.stopRecording()
      // #region agent log
      agentLog(
        'index.ts:onGameRawEnd',
        'after-stopRecording',
        { stoppedTail: stoppedPath ? stoppedPath.slice(-120) : null, hadPath: !!stoppedPath },
        'L2',
      )
      // #endregion
      if (!stoppedPath) return

      console.log(`[main] Recording stop signal sent → ${stoppedPath}`)
      await recordingManager.waitForDone(30_000)
      console.log(`[main] Recording finalized → ${stoppedPath}`)

      try {
        const prisma = getPrisma()
        const existing = await prisma.recording.findFirst({ where: { filePath: stoppedPath } })
        if (!existing) {
          await prisma.recording.create({ data: { filePath: stoppedPath, source: 'capture' } })
        }
      } catch (err) {
        console.error('[main] Failed to pre-persist recording:', err)
      }
      mainWindow?.webContents.send('recording:stopped', { filePath: stoppedPath })
    },
  )

  gameDetector.start()
}

app.whenReady().then(bootstrap)

app.on('window-all-closed', () => {
  recordingManager.stopRecording()
  gameDetector?.stop()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

function setupAutoUpdater() {
  if (!app.isPackaged) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', () => {
    mainWindow?.webContents.send('updater:update-available')
  })

  autoUpdater.on('update-downloaded', () => {
    mainWindow?.webContents.send('updater:update-downloaded')
  })

  autoUpdater.on('error', (err) => {
    console.error('[updater]', err.message)
  })

  ipcMain.handle('updater:install-now', () => {
    autoUpdater.quitAndInstall()
  })

  autoUpdater.checkForUpdatesAndNotify().catch(() => {})
}

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})
