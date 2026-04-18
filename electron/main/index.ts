import { app, BrowserWindow, ipcMain, protocol } from 'electron'

// Suppress Chromium GPU shader disk-cache errors on Windows (access-denied / cache locked).
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache')

import { join } from 'path'
import { createReadStream, statSync, readFileSync, existsSync } from 'fs'
import { autoUpdater } from 'electron-updater'
import { initDatabase, getPrisma } from './database'
import { GameDetector } from './gameDetector'
import { recordingManager, isFfmpegAvailable, generateThumbnailForRecording, mergeAudioIntoVideo, type PcmAudioFormat } from './recorder'
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

// ── System audio capture (WASAPI loopback via native-audio-node — bypasses Chromium entirely) ──
let _sysAudioRecorder: InstanceType<typeof import('native-audio-node').SystemAudioRecorder> | null = null
let _sysAudioChunks: Buffer[] = []
interface SysAudioMeta { sampleRate: number; channelsPerFrame: number; encoding: string }
let _sysAudioMeta: SysAudioMeta | null = null

async function startSystemAudioCapture(): Promise<void> {
  if (_sysAudioRecorder) return
  try {
    const { SystemAudioRecorder } = await import('native-audio-node')
    _sysAudioChunks = []
    _sysAudioMeta = null

    _sysAudioRecorder = new SystemAudioRecorder({
      sampleRate: 44100,
      chunkDurationMs: 200,
      stereo: true,
      emitSilence: true,
    })

    _sysAudioRecorder.on('metadata', (meta) => {
      _sysAudioMeta = { sampleRate: meta.sampleRate, channelsPerFrame: meta.channelsPerFrame, encoding: meta.encoding }
      console.log(`[audio] System audio format: ${meta.encoding} ${meta.sampleRate}Hz ${meta.channelsPerFrame}ch`)
    })

    _sysAudioRecorder.on('data', (chunk) => {
      _sysAudioChunks.push(chunk.data)
    })

    _sysAudioRecorder.on('error', (err) => {
      console.error('[audio] System audio capture error:', err)
    })

    await _sysAudioRecorder.start()
    console.log('[audio] System audio capture started (WASAPI loopback)')
  } catch (err) {
    console.error('[audio] Failed to start system audio capture:', err)
    _sysAudioRecorder = null
  }
}

interface SystemAudioResult { buffer: Buffer; encoding: string; sampleRate: number; channels: number }

async function stopSystemAudioCapture(): Promise<SystemAudioResult | null> {
  if (!_sysAudioRecorder) return null
  try {
    await _sysAudioRecorder.stop()
  } catch { /* ignore stop errors */ }
  _sysAudioRecorder = null

  if (_sysAudioChunks.length === 0 || !_sysAudioMeta) {
    console.warn('[audio] System audio capture returned no data')
    return null
  }

  const buffer = Buffer.concat(_sysAudioChunks)
  const result: SystemAudioResult = {
    buffer,
    encoding: _sysAudioMeta.encoding,
    sampleRate: _sysAudioMeta.sampleRate,
    channels: _sysAudioMeta.channelsPerFrame,
  }
  _sysAudioChunks = []
  _sysAudioMeta = null
  return result
}

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
      mainWindow?.show()
      mainWindow?.focus()

      const pendingRecording = recordingManager.getPendingRecording()

      const pendingFileValid = pendingRecording
        ? (() => { try { return existsSync(pendingRecording) && statSync(pendingRecording).size > 0 } catch { return false } })()
        : false

      if (matchData.game?.id) {
        if (!pendingRecording || !pendingFileValid) {
          if (pendingRecording && !pendingFileValid) {
            console.warn(`[main] Pending recording empty/missing — not linking: ${pendingRecording}`)
            recordingManager.clearPendingRecording()
          }
        }
        if (pendingRecording && pendingFileValid) {
          try {
            const prisma = getPrisma()
            const existing = await prisma.recording.findFirst({
              where: { filePath: pendingRecording, gameId: null },
            })
            let rec
            if (existing) {
              rec = await prisma.recording.update({
                where: { id: existing.id },
                data: { gameId: matchData.game.id, source: 'capture' },
              })
            } else {
              const byGame = await prisma.recording.findUnique({ where: { gameId: matchData.game.id } })
              rec = byGame
                ? await prisma.recording.update({ where: { id: byGame.id }, data: { filePath: pendingRecording, source: 'capture' } })
                : await prisma.recording.create({ data: { gameId: matchData.game.id, filePath: pendingRecording, source: 'capture' } })
            }
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
          }
        }
      } else {
        if (pendingRecording && pendingFileValid) {
          console.log('[main] No game ID yet — recording kept pending for background enrich to link')
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
            audioDesktopEnabled: user.recordAudioDesktop,
            audioDesktopDevice: user.recordAudioDesktopDevice,
            audioMicEnabled: user.recordAudioMic,
            audioMicDevice: user.recordAudioMicDevice,
          })
          if (path) {
            mainWindow?.webContents.send('recording:started')
            console.log('[main] Recording started →', path)
          } else {
            console.warn('[main] startRecording() returned null — ffmpeg may be unavailable')
          }

          if (user.recordAudioDesktop && path) {
            startSystemAudioCapture()
          }
        }
      } catch (err) {
        console.error('[main] onGameStart error:', err)
      }
    },

    // onGameRawEnd: fires immediately when live client stops (before Riot API match resolution)
    async () => {
      const stoppedPath = recordingManager.stopRecording()
      if (!stoppedPath) return

      console.log(`[main] Recording stop signal sent → ${stoppedPath}`)

      const [, sysAudio] = await Promise.all([
        recordingManager.waitForDone(30_000),
        stopSystemAudioCapture(),
      ])

      console.log(`[main] Recording finalized → ${stoppedPath}`)

      const fileSize = existsSync(stoppedPath)
        ? (() => { try { return statSync(stoppedPath).size } catch { return 0 } })()
        : 0

      if (fileSize === 0) {
        console.warn(`[main] Recording file empty or missing — skipping DB persist: ${stoppedPath}`)
        recordingManager.clearPendingRecording()
        return
      }

      if (sysAudio) {
        console.log(`[main] System audio received (${(sysAudio.buffer.length / 1024).toFixed(0)} KB, ${sysAudio.encoding}) — merging…`)
        try {
          await mergeAudioIntoVideo(stoppedPath, sysAudio.buffer, {
            encoding: sysAudio.encoding,
            sampleRate: sysAudio.sampleRate,
            channels: sysAudio.channels,
          })
        } catch (err) {
          console.error('[main] Audio merge failed:', err)
        }
      } else {
        console.log('[main] No system audio captured — video keeps mic-only audio')
      }

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
  // Register the manual-check IPC handler even in dev so the UI can
  // surface a clear message ("not available in development") instead of
  // a cryptic "No handler registered" error.
  if (!app.isPackaged) {
    ipcMain.handle('updater:check', async () => ({
      status: 'dev-mode',
      updateAvailable: false,
    }))
    return
  }

  // File-based logging so we can diagnose auto-update failures post-mortem
  // (console.error is invisible to end-users in packaged builds).
  try {
    const logsDir = app.getPath('logs')
    const logPath = join(logsDir, 'updater.log')
    const updaterLogger = {
      info: (msg: string) => appendUpdaterLog(logPath, 'INFO', msg),
      warn: (msg: string) => appendUpdaterLog(logPath, 'WARN', msg),
      error: (msg: string) => appendUpdaterLog(logPath, 'ERROR', msg),
      debug: (msg: string) => appendUpdaterLog(logPath, 'DEBUG', msg),
    }
    ;(autoUpdater as unknown as { logger: typeof updaterLogger }).logger = updaterLogger
    updaterLogger.info(`autoUpdater init - app version ${app.getVersion()}`)
  } catch {
    /* logging best-effort */
  }

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowPrerelease = true

  autoUpdater.on('update-available', (info) => {
    mainWindow?.webContents.send('updater:update-available', info?.version)
  })

  autoUpdater.on('update-not-available', () => {
    mainWindow?.webContents.send('updater:update-not-available')
  })

  autoUpdater.on('download-progress', (progress) => {
    mainWindow?.webContents.send('updater:download-progress', Math.round(progress.percent))
  })

  autoUpdater.on('update-downloaded', () => {
    mainWindow?.webContents.send('updater:update-downloaded')
  })

  autoUpdater.on('error', (err) => {
    console.error('[updater]', err.message)
    mainWindow?.webContents.send('updater:error', err.message)
  })

  ipcMain.handle('updater:install-now', () => {
    autoUpdater.quitAndInstall()
  })

  ipcMain.handle('updater:check', async () => {
    try {
      const result = await autoUpdater.checkForUpdates()

      // electron-updater returns `null` when a check is already in progress
      // (throttling) or when the updater is unable to run. Surface that as
      // an "unknown" state so the UI doesn't falsely report "up to date".
      if (!result) {
        return { status: 'unknown', updateAvailable: false } as const
      }

      // `updateInfo` is always populated with the latest release metadata,
      // even when you are already on that version. The correct signal for
      // "update available" is `isUpdateAvailable` (electron-updater v6+).
      const isUpdateAvailable = (result as unknown as { isUpdateAvailable?: boolean }).isUpdateAvailable
        ?? compareVersionsNewer(result.updateInfo?.version, app.getVersion())

      return {
        status: isUpdateAvailable ? 'available' : 'up-to-date',
        updateAvailable: Boolean(isUpdateAvailable),
        currentVersion: app.getVersion(),
        latestVersion: result.updateInfo?.version,
      } as const
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[updater] manual check failed:', message)
      return { status: 'error', updateAvailable: false, error: message } as const
    }
  })

  autoUpdater.checkForUpdatesAndNotify().catch((err) => {
    console.error('[updater] initial check failed:', err?.message || err)
  })
}

/**
 * Compare two semver-ish version strings and return true iff `candidate`
 * is strictly newer than `current`. Handles `X.Y.Z` and `X.Y.Z-beta.N`
 * (and other pre-release identifiers) well enough for our release scheme.
 * Falls back to `false` on malformed input rather than throwing so that
 * the update check is never broken by an unexpected server response.
 */
function compareVersionsNewer(candidate: string | undefined, current: string | undefined): boolean {
  if (!candidate || !current) return false
  const parse = (v: string): { core: number[]; pre: Array<string | number> } => {
    const [core, pre = ''] = v.split('-', 2)
    return {
      core: core.split('.').map((n) => Number.parseInt(n, 10) || 0),
      pre: pre ? pre.split('.').map((p) => (Number.isNaN(Number(p)) ? p : Number(p))) : [],
    }
  }
  const a = parse(candidate)
  const b = parse(current)
  for (let i = 0; i < Math.max(a.core.length, b.core.length); i++) {
    const ai = a.core[i] ?? 0
    const bi = b.core[i] ?? 0
    if (ai > bi) return true
    if (ai < bi) return false
  }
  // Core equal → version without pre-release tag is considered newer.
  if (a.pre.length === 0 && b.pre.length > 0) return true
  if (a.pre.length > 0 && b.pre.length === 0) return false
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const ap = a.pre[i]
    const bp = b.pre[i]
    if (ap === bp) continue
    if (ap === undefined) return false
    if (bp === undefined) return true
    if (typeof ap === 'number' && typeof bp === 'number') return ap > bp
    return String(ap) > String(bp)
  }
  return false
}

function appendUpdaterLog(filePath: string, level: string, message: string): void {
  try {
    const line = `[${new Date().toISOString()}] [${level}] ${message}\n`
    const fs = require('fs') as typeof import('fs')
    fs.appendFileSync(filePath, line, 'utf8')
  } catch {
    /* swallow - logging must never crash the app */
  }
}

ipcMain.handle('app:get-version', () => app.getVersion())

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})
