import { app, BrowserWindow, desktopCapturer, ipcMain, screen } from 'electron'
import { spawn } from 'child_process'
import { createWriteStream, existsSync, mkdirSync, statSync, unlinkSync, WriteStream } from 'fs'
import { join } from 'path'
import { getFfmpegBinaryPath, type RecordingSettings } from './recorder'

const QUALITY_HEIGHT: Record<string, number> = {
  source: 0,
  '1440p': 1440,
  '1080p': 1080,
  '720p': 720,
}

const ENCODER_BITRATE_KBPS: Record<string, number> = {
  source: 12000,
  '1440p': 10000,
  '1080p': 6000,
  '720p': 3500,
}

/**
 * WgcRecorder — video capture via Windows Graphics Capture (WGC).
 *
 * Architecture:
 *   main process (this class)
 *     └── owns a hidden BrowserWindow (capture renderer)
 *         └── uses `desktopCapturer` + `getUserMedia` + `MediaRecorder`
 *         └── streams WebM chunks back through IPC
 *
 * Why WGC over ddagrab:
 *   ddagrab (DXGI Desktop Duplication) loses its duplication handle whenever
 *   the capture target changes presentation mode (FSE flip-model transitions
 *   are frequent during a League of Legends match). There is no recovery path
 *   in `ddagrab.c` — the filter returns `AVERROR_EXTERNAL` on ACCESS_LOST and
 *   is effectively dead for the rest of the session. WGC uses a different API
 *   (`Windows.Graphics.Capture`) that is stateless vs. the target's swap chain
 *   and is explicitly designed to handle presentation-mode flips.
 *
 * Phase 1 scope: video only. Audio (mic + desktop) arrives in Phase 2.
 */
export class WgcRecorder {
  private captureWindow: BrowserWindow | null = null
  private writeStream: WriteStream | null = null
  private currentFilePath: string | null = null
  private lastOutputPath: string | null = null
  private pendingRecording: string | null = null

  private isRecording = false
  private isStopping = false
  private startedAt = 0
  private lastSettings: RecordingSettings = {}

  private donePromise: Promise<void> | null = null
  private doneResolve: (() => void) | null = null

  private rendererReadyResolver: (() => void) | null = null
  private rendererReadyPromise: Promise<void> | null = null

  private ipcBound = false

  getRecordingsDir(customPath?: string | null): string {
    const dir = customPath && customPath.trim()
      ? customPath.trim()
      : join(app.getPath('userData'), 'recordings')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    return dir
  }

  /**
   * Wire IPC handlers exactly once per app lifetime. We cannot register them
   * lazily inside `startRecording` because a second recording session would
   * throw `Attempted to register a second handler`.
   */
  private bindIpcOnce() {
    if (this.ipcBound) return
    this.ipcBound = true

    ipcMain.handle('wgc:list-screen-sources', async () => {
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
      return sources.map((s) => ({ id: s.id, name: s.name, display_id: s.display_id }))
    })

    ipcMain.on(
      'wgc:started',
      (
        _event,
        info: {
          mimeType: string
          width: number
          height: number
          audioTracks?: number
          audioDesktop?: boolean
          audioMic?: boolean
        },
      ) => {
        const audioTracks = info.audioTracks ?? 0
        const audioInfo = `audioTracks=${audioTracks} desktop=${info.audioDesktop ?? false} mic=${info.audioMic ?? false}`
        console.log(
          `[wgcRecorder] capture renderer signalled started — ${info.width}x${info.height} mimeType=${info.mimeType} ${audioInfo}`,
        )
        if (audioTracks === 0) {
          console.warn('[wgcRecorder] no audio tracks in combined stream — VOD will be silent')
        }
        this.rendererReadyResolver?.()
      },
    )

    ipcMain.on('wgc:chunk', (_event, chunk: ArrayBuffer, _isLast: boolean) => {
      if (!this.writeStream || !this.currentFilePath) return
      this.writeStream.write(Buffer.from(chunk))
    })

    ipcMain.on('wgc:stopped', () => {
      console.log('[wgcRecorder] capture renderer signalled stopped')
      this.finalizeStop()
    })

    ipcMain.on('wgc:error', (_event, message: string) => {
      console.error(`[wgcRecorder] capture renderer error: ${message}`)
    })
  }

  private async ensureCaptureWindow(): Promise<BrowserWindow> {
    if (this.captureWindow && !this.captureWindow.isDestroyed()) return this.captureWindow

    const win = new BrowserWindow({
      show: false,
      width: 320,
      height: 240,
      frame: false,
      skipTaskbar: true,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        backgroundThrottling: false,
      },
    })

    this.captureWindow = win

    if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
      await win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/wgc-capture.html`)
    } else {
      await win.loadFile(join(__dirname, '../renderer/wgc-capture.html'))
    }

    win.on('closed', () => {
      this.captureWindow = null
    })

    return win
  }

  /**
   * Starts a WGC recording. Resolves with the path of the destination `.webm`
   * file (Phase 1). Returns `null` if the capture renderer fails to start.
   */
  async startRecording(settings: RecordingSettings = {}): Promise<string | null> {
    if (this.isRecording) return this.currentFilePath

    this.bindIpcOnce()
    this.lastSettings = settings
    this.isStopping = false
    this.pendingRecording = null

    const {
      recordingPath = null,
      recordQuality = 'source',
      recordFps = 30,
    } = settings

    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const filePath = join(this.getRecordingsDir(recordingPath), `lol_${ts}.webm`)

    const primary = screen.getPrimaryDisplay()
    const targetHeight = QUALITY_HEIGHT[recordQuality] ?? 0
    const bitrateKbps = ENCODER_BITRATE_KBPS[recordQuality] ?? 8000

    // Prefer capturing the League of Legends game window (HWND) via WGC rather
    // than the whole monitor. WGC's frame pool is tied to the target's swap
    // chain; when the target is a fullscreen-exclusive game, screen-level
    // capture sees the DWM compositor lose its backbuffer every time LoL flips
    // presentation mode (loading → in-game → result → client), producing
    // `ProcessFrame failed 0x80004005 E_FAIL` bursts and frame duplication in
    // the output. HWND-level capture attaches directly to LoL's swap chain and
    // survives those transitions (same technique OBS uses for "Window Capture
    // (WGC)" on FSE games).
    const [screenSources, windowSources] = await Promise.all([
      desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } }),
      desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 } }),
    ])

    // Window title is "League of Legends (TM) Client" during an active game.
    // We match on the leading "League of Legends" substring to also tolerate
    // lobby states and any Riot-side wording tweaks.
    const lolWindow = windowSources.find((s) => /^league of legends/i.test(s.name))

    const primaryScreen =
      screenSources.find((s) => String(s.display_id) === String(primary.id)) ?? screenSources[0]

    const chosenSource = lolWindow ?? primaryScreen
    if (!chosenSource) {
      console.error('[wgcRecorder] no capture source available — aborting recording')
      return null
    }

    const sourceKind: 'window' | 'screen' = lolWindow ? 'window' : 'screen'
    console.log(`[wgcRecorder] Using WGC — source: ${chosenSource.name} (${chosenSource.id}) [kind=${sourceKind}]`)
    console.log(`[wgcRecorder] Settings — quality: ${recordQuality}, targetHeight: ${targetHeight || 'native'}, fps: ${recordFps}, bitrate: ${bitrateKbps}kbps`)

    const win = await this.ensureCaptureWindow()

    this.currentFilePath = filePath
    this.lastOutputPath = filePath
    this.writeStream = createWriteStream(filePath)
    this.isRecording = true
    this.startedAt = Date.now()

    this.donePromise = new Promise<void>((resolve) => { this.doneResolve = resolve })
    this.rendererReadyPromise = new Promise<void>((resolve) => { this.rendererReadyResolver = resolve })

    win.webContents.send('wgc:start', {
      recordFps,
      targetHeight,
      bitrateKbps,
      sourceId: chosenSource.id,
      mainWindowId: win.webContents.id,
    })

    // Bound wait: if the renderer never signals started, we still return the
    // file path so the caller (index.ts) has something to reference in logs.
    await Promise.race([
      this.rendererReadyPromise,
      new Promise<void>((r) => setTimeout(r, 5_000)),
    ])

    console.log(`[wgcRecorder] Started → ${filePath}`)
    return filePath
  }

  stopRecording(): string | null {
    this.isStopping = true

    if (!this.isRecording) {
      const path = this.currentFilePath ?? this.lastOutputPath
      if (path) this.pendingRecording = path
      return path
    }

    const path = this.currentFilePath
    this.pendingRecording = path

    try {
      this.captureWindow?.webContents.send('wgc:stop')
    } catch (err) {
      console.warn('[wgcRecorder] failed to send stop signal to renderer:', (err as Error).message)
    }

    // Safety timer: if renderer never replies, force-finalize after 8s.
    setTimeout(() => {
      if (this.writeStream) {
        console.warn('[wgcRecorder] renderer did not confirm stop in 8s — force finalizing')
        this.finalizeStop()
      }
    }, 8_000)

    return path
  }

  private finalizeStop() {
    if (!this.isRecording) {
      this.doneResolve?.()
      return
    }
    this.isRecording = false

    if (this.writeStream) {
      const ws = this.writeStream
      this.writeStream = null
      ws.end(() => {
        const elapsed = Date.now() - this.startedAt
        const webmPath = this.currentFilePath
        const rawSize = webmPath ? safeSize(webmPath) : 0
        console.log(`[wgcRecorder] raw webm written → ${webmPath} (${rawSize} bytes, ${elapsed}ms)`)

        // MediaRecorder produces a "live" WebM stream without a Duration field,
        // without a SeekHead and without Cues. Players open it but report 0:00
        // and seeking is broken. Remux through ffmpeg (`-c copy`, no re-encode)
        // to MP4 with `-movflags +faststart` — this writes a real moov atom and
        // makes the output navigable + aligned with the existing Record Hub
        // (which expects `.mp4`). On success the original `.webm` is deleted.
        if (webmPath) {
          this.remuxToMp4(webmPath, elapsed, rawSize)
            .catch((err) => {
              console.warn(`[wgcRecorder] remux failed, keeping raw webm: ${(err as Error).message}`)
            })
            .finally(() => this.doneResolve?.())
        } else {
          this.doneResolve?.()
        }
      })
    } else {
      this.doneResolve?.()
    }
  }

  /**
   * Remux a MediaRecorder-produced `.webm` to `.mp4` with `-c copy` and
   * `-movflags +faststart`. Preserves codecs (H.264/Opus → AAC transmux only
   * if needed — here `-c copy` works because we already target h264+opus),
   * but Opus isn't legal in MP4 for most players, so we do transmux opus→aac.
   * Video stays as H.264 (copy).
   *
   * On success:
   *   - `this.currentFilePath` and `this.lastOutputPath` are rewritten to the mp4 path
   *   - the original `.webm` is deleted
   *   - `this.pendingRecording` is updated (so `getPendingRecording()` returns mp4)
   */
  private async remuxToMp4(webmPath: string, recElapsedMs: number, rawBytes: number): Promise<void> {
    const bin = getFfmpegBinaryPath()
    if (!bin) {
      throw new Error('ffmpeg binary not available for remux')
    }
    const mp4Path = webmPath.replace(/\.webm$/i, '.mp4')
    const t0 = Date.now()

    // -c:v copy  → keep H.264 bitstream (no re-encode, near-instant)
    // -c:a aac   → transmux opus→aac because Opus is not widely seekable in MP4
    // -movflags +faststart → move moov atom to file start
    // -fflags +genpts → synthesize pts if MediaRecorder didn't write them cleanly
    const args = [
      '-hide_banner',
      '-loglevel', 'error',
      '-fflags', '+genpts',
      '-i', webmPath,
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-b:a', '160k',
      '-movflags', '+faststart',
      '-y',
      mp4Path,
    ]

    await new Promise<void>((resolve, reject) => {
      const proc = spawn(bin, args, { windowsHide: true })
      let stderr = ''
      proc.stderr.on('data', (d) => { stderr += d.toString() })
      proc.on('error', (err) => reject(err))
      proc.on('exit', (code) => {
        if (code === 0) resolve()
        else reject(new Error(`ffmpeg remux exited with code ${code}: ${stderr.slice(-500)}`))
      })
    })

    const mp4Size = safeSize(mp4Path)
    try { unlinkSync(webmPath) } catch { /* ignore */ }

    this.currentFilePath = mp4Path
    this.lastOutputPath = mp4Path
    if (this.pendingRecording === webmPath) this.pendingRecording = mp4Path

    console.log(`[wgcRecorder] remuxed → ${mp4Path} (${mp4Size} bytes, remux ${Date.now() - t0}ms, rec ${recElapsedMs}ms, raw ${rawBytes} bytes)`)
  }

  async waitForDone(timeoutMs = 30_000): Promise<void> {
    if (!this.donePromise) return
    await Promise.race([
      this.donePromise,
      new Promise<void>((r) => setTimeout(r, timeoutMs)),
    ])
  }

  getPendingRecording(): string | null {
    return this.pendingRecording
  }

  clearPendingRecording() {
    this.pendingRecording = null
    this.lastOutputPath = null
  }

  getStatus(): { isRecording: boolean; filePath: string | null; ffmpegAvailable: boolean } {
    return {
      isRecording: this.isRecording,
      filePath: this.currentFilePath,
      ffmpegAvailable: true,
    }
  }

  /**
   * Closes the hidden capture window. Safe to call during app shutdown.
   */
  dispose() {
    if (this.captureWindow && !this.captureWindow.isDestroyed()) {
      try { this.captureWindow.close() } catch { /* ignore */ }
    }
    this.captureWindow = null
  }
}

function safeSize(filePath: string): number {
  try { return statSync(filePath).size } catch { return 0 }
}

export const wgcRecorder = new WgcRecorder()
