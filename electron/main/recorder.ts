import { spawn, ChildProcess, SpawnOptions } from 'child_process'
import { app, screen, desktopCapturer, BrowserWindow, ipcMain } from 'electron'
import { join, basename, dirname, extname } from 'path'
import { existsSync, mkdirSync, statSync, createWriteStream, renameSync, unlinkSync } from 'fs'
import type { WriteStream } from 'fs'
import { getPrisma } from './database'
import { agentLog } from './debugAgentLog'

const winSpawnOpts = (): Pick<SpawnOptions, 'windowsHide'> =>
  process.platform === 'win32' ? { windowsHide: true } : {}

let ffmpegBin: string | null = null
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('ffmpeg-static')
  ffmpegBin = typeof mod === 'string' ? mod : (mod?.default ?? null)
  if (ffmpegBin && app.isPackaged) {
    ffmpegBin = ffmpegBin.replace('app.asar', 'app.asar.unpacked')
  }
} catch {
  console.warn('[recorder] ffmpeg-static not available — auto-record disabled')
}

export function isFfmpegAvailable(): boolean {
  return ffmpegBin !== null && existsSync(ffmpegBin)
}

export interface RecordingSettings {
  recordingPath?: string | null
  recordQuality?: string
  recordFps?: number
  recordEncoder?: string
}

// ── WGC source discovery ──────────────────────────────────────────────────────

const LOL_TITLE_PATTERNS = [
  /^League of Legends \(TM\) Client$/i,
  /^League of Legends$/i,
  /^League Of Legends$/i,
]

/**
 * Finds the Chromium media source ID for the League of Legends window
 * using Electron's desktopCapturer (backed by WGC on Windows 10 1903+).
 */
async function findLolWindowSource(): Promise<Electron.DesktopCapturerSource | null> {
  const sources = await desktopCapturer.getSources({
    types: ['window'],
    thumbnailSize: { width: 1, height: 1 },
    fetchWindowIcons: false,
  })
  for (const pattern of LOL_TITLE_PATTERNS) {
    const match = sources.find((s) => pattern.test(s.name))
    if (match) return match
  }
  const loose = sources.find(
    (s) => /League/i.test(s.name) && !/Riot\s*Client/i.test(s.name),
  )
  return loose ?? null
}

const SOURCE_PROBE_DELAYS_MS = [0, 1500, 2000, 2500, 3000, 4000, 5000, 5000, 5000, 5000]

async function findLolWindowSourceWithRetries(): Promise<Electron.DesktopCapturerSource | null> {
  for (let i = 0; i < SOURCE_PROBE_DELAYS_MS.length; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, SOURCE_PROBE_DELAYS_MS[i]))
    const src = await findLolWindowSource()
    if (src) {
      console.log(`[recorder] WGC source found: "${src.name}" (id=${src.id})`)
      return src
    }
    console.log(
      `[recorder] WGC source probe ${i + 1}/${SOURCE_PROBE_DELAYS_MS.length} — League window not yet visible`,
    )
  }
  return null
}

// ── Remux WebM → MP4 ─────────────────────────────────────────────────────────

/**
 * Converts WebM capture to a proper MP4 with seekable moov atom.
 * H264 stream: fast stream-copy into MP4 container.
 * VP9/VP8 stream: re-encode to H264 (slower but necessary for MP4).
 * `-fflags +genpts` fixes duration/seek from MediaRecorder's variable-rate timestamps.
 */
function remuxToMp4(webmPath: string, mp4Path: string, mimeType?: string): Promise<boolean> {
  if (!ffmpegBin || !existsSync(ffmpegBin)) return Promise.resolve(false)

  const isH264 = mimeType?.includes('h264') ?? false
  const codecArgs = isH264
    ? ['-c', 'copy']
    : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23']

  return new Promise((resolve) => {
    const args = [
      '-hide_banner',
      '-fflags', '+genpts',
      '-i', webmPath,
      ...codecArgs,
      '-movflags', '+faststart',
      '-y',
      mp4Path,
    ]
    console.log(`[recorder] remux command: ffmpeg ${args.join(' ')}`)
    const proc = spawn(ffmpegBin!, args, {
      stdio: ['ignore', 'ignore', 'pipe'],
      ...winSpawnOpts(),
    })
    let stderr = ''
    proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString() })
    proc.on('exit', (code) => {
      if (code === 0 && existsSync(mp4Path)) {
        resolve(true)
      } else {
        console.warn('[recorder] remux stderr:', stderr.slice(-500))
        resolve(false)
      }
    })
    proc.on('error', () => resolve(false))
    setTimeout(() => { try { proc.kill() } catch { /* ok */ } resolve(false) }, 300_000)
  })
}

// ── Recording manager ─────────────────────────────────────────────────────────

export class RecordingManager {
  private isRecording = false
  private currentFilePath: string | null = null
  private pendingRecording: string | null = null
  private lastOutputPath: string | null = null
  private writeStream: WriteStream | null = null
  private webmTempPath: string | null = null
  /** Resolves once the renderer finishes recording and remux is done. */
  private donePromise: Promise<void> | null = null
  private doneResolve: (() => void) | null = null
  private mainWindow: BrowserWindow | null = null
  private ipcRegistered = false

  getRecordingsDir(customPath?: string | null): string {
    const dir = customPath && customPath.trim()
      ? customPath.trim()
      : join(app.getPath('userData'), 'recordings')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    return dir
  }

  /** Must be called once after mainWindow is created. */
  setMainWindow(win: BrowserWindow) {
    this.mainWindow = win
    if (!this.ipcRegistered) {
      this.registerIpc()
      this.ipcRegistered = true
    }
  }

  private registerIpc() {
    ipcMain.handle('wgc:chunk', (_e, chunk: ArrayBuffer) => {
      if (this.writeStream && !this.writeStream.destroyed) {
        this.writeStream.write(Buffer.from(chunk))
      }
    })

    ipcMain.handle('wgc:done', async (_e, meta: { mimeType: string }) => {
      console.log(`[recorder] WGC capture done — mime: ${meta.mimeType}`)

      await new Promise<void>((resolve) => {
        if (!this.writeStream || this.writeStream.destroyed) { resolve(); return }
        this.writeStream.end(() => resolve())
      })
      this.writeStream = null

      const webm = this.webmTempPath
      const mp4 = this.currentFilePath

      if (webm && mp4 && existsSync(webm)) {
        console.log(`[recorder] Remuxing WebM → MP4…`)
        const ok = await remuxToMp4(webm, mp4, meta.mimeType)
        if (ok) {
          try { unlinkSync(webm) } catch { /* ignore */ }
          console.log('[recorder] Remux complete → ' + mp4)
        } else {
          console.warn('[recorder] Remux failed — renaming WebM as fallback')
          try { renameSync(webm, mp4) } catch { /* keep as-is */ }
        }
      }

      this.isRecording = false
      if (mp4) {
        this.pendingRecording = mp4
        this.lastOutputPath = mp4
      }
      this.webmTempPath = null
      this.doneResolve?.()
    })

    ipcMain.handle('wgc:error', (_e, message: string) => {
      console.error('[recorder] WGC capture error:', message)
      this.writeStream?.end()
      this.writeStream = null
      this.isRecording = false
      this.doneResolve?.()
    })
  }

  /**
   * Starts a recording session using Windows Graphics Capture via the renderer.
   *
   * 1. desktopCapturer finds the League window source ID.
   * 2. Sends the source ID to the renderer which calls getUserMedia + MediaRecorder.
   * 3. Renderer streams WebM chunks back via IPC; main writes them to disk.
   * 4. On stop, remuxes WebM → MP4 if needed.
   */
  async startRecording(settings: RecordingSettings = {}): Promise<string | null> {
    if (this.isRecording) return this.currentFilePath
    if (!this.mainWindow) {
      console.warn('[recorder] mainWindow not set — cannot start WGC capture')
      return null
    }

    const { recordingPath = null, recordQuality, recordFps } = settings

    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const mp4Path = join(this.getRecordingsDir(recordingPath), `lol_${ts}.mp4`)
    const webmPath = mp4Path.replace(/\.mp4$/, '.webm')

    const source = await findLolWindowSourceWithRetries()
    if (!source) {
      console.warn('[recorder] No League window found — cannot start WGC capture')
      return null
    }

    agentLog(
      'recorder.ts:startRecording',
      'wgc-start',
      { sourceId: source.id, sourceName: source.name, quality: recordQuality, fps: recordFps },
      'WGC',
    )

    this.currentFilePath = mp4Path
    this.lastOutputPath = mp4Path
    this.webmTempPath = webmPath
    this.isRecording = true

    this.writeStream = createWriteStream(webmPath)

    this.donePromise = new Promise<void>((resolve) => { this.doneResolve = resolve })

    this.mainWindow.webContents.send('wgc:capture-start', {
      sourceId: source.id,
      filePath: mp4Path,
      quality: recordQuality ?? '1080p',
      fps: recordFps ?? 30,
    })

    console.log(`[recorder] WGC Started — source="${source.name}" quality=${recordQuality ?? '1080p'} fps=${recordFps ?? 30} → ${mp4Path}`)
    return mp4Path
  }

  stopRecording(): string | null {
    if (!this.isRecording) {
      const fallback = this.pendingRecording ?? this.lastOutputPath
      if (fallback) this.pendingRecording = fallback
      return fallback
    }

    const path = this.currentFilePath
    this.pendingRecording = path

    this.mainWindow?.webContents.send('wgc:capture-stop')

    return path
  }

  /** Waits until the renderer has finished writing + remux is done. */
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
      ffmpegAvailable: isFfmpegAvailable(),
    }
  }
}

export const recordingManager = new RecordingManager()

// ── Thumbnail generation ──────────────────────────────────────────────────────

export async function generateThumbnail(
  filePath: string,
  outputPath: string,
  offsetSecs: number,
): Promise<string | null> {
  if (!ffmpegBin || !existsSync(ffmpegBin)) return null
  if (!existsSync(filePath)) return null

  return new Promise((resolve) => {
    const args = [
      '-ss', String(Math.max(0, offsetSecs)),
      '-i', filePath,
      '-frames:v', '1',
      '-q:v', '2',
      '-y',
      outputPath,
    ]
    const proc = spawn(ffmpegBin!, args, { stdio: ['ignore', 'ignore', 'pipe'], ...winSpawnOpts() })
    proc.stderr?.resume()
    proc.on('exit', (code) => resolve(code === 0 && existsSync(outputPath) ? outputPath : null))
    proc.on('error', () => resolve(null))
    setTimeout(() => { try { proc.kill() } catch { /* ok */ } resolve(null) }, 15_000)
  })
}

/**
 * Probes video duration (seconds) via ffprobe-style ffmpeg.
 * Returns 0 if probing fails.
 */
function probeDuration(filePath: string): Promise<number> {
  if (!ffmpegBin || !existsSync(filePath)) return Promise.resolve(0)
  return new Promise((resolve) => {
    let resolved = false
    const done = (val: number) => { if (!resolved) { resolved = true; clearTimeout(timer); resolve(val) } }
    const args = ['-i', filePath, '-hide_banner']
    const proc = spawn(ffmpegBin!, args, { stdio: ['ignore', 'pipe', 'pipe'], ...winSpawnOpts() })
    let output = ''
    proc.stderr?.on('data', (d: Buffer) => { output += d.toString() })
    proc.stdout?.on('data', (d: Buffer) => { output += d.toString() })
    proc.on('exit', () => {
      const match = output.match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/)
      if (match) {
        done(
          parseInt(match[1]) * 3600 +
          parseInt(match[2]) * 60 +
          parseInt(match[3]) +
          parseInt(match[4]) / 100,
        )
      } else {
        done(0)
      }
    })
    proc.on('error', () => done(0))
    const timer = setTimeout(() => { try { proc.kill() } catch { /* ok */ } done(0) }, 10_000)
  })
}

export async function generateThumbnailForRecording(
  recordingId: string,
  filePath: string,
): Promise<string | null> {
  if (!existsSync(filePath)) {
    console.warn('[recorder] Thumbnail skipped — file not found:', filePath)
    return null
  }
  const thumbDir = join(app.getPath('userData'), 'thumbnails')
  if (!existsSync(thumbDir)) mkdirSync(thumbDir, { recursive: true })
  const thumbPath = join(thumbDir, `${recordingId}.thumb.jpg`)

  const duration = await probeDuration(filePath)
  const offset = duration > 0
    ? Math.min(120, Math.max(1, duration * 0.1))
    : 5

  const result = await generateThumbnail(filePath, thumbPath, offset)
  if (result) {
    try {
      const prisma = getPrisma()
      await prisma.$executeRawUnsafe(
        `UPDATE "Recording" SET "thumbnailPath" = ? WHERE "id" = ?`,
        result,
        recordingId,
      )
    } catch (err) {
      console.warn('[recorder] Failed to persist thumbnail path:', err)
    }
  }
  return result
}

// ── Clip creation ─────────────────────────────────────────────────────────────

export interface ClipOptions {
  recordingId: string
  filePath: string
  title?: string
  startMs: number
  endMs: number
  linkedNoteText?: string
  outputDir: string
}

export async function createClip(options: ClipOptions): Promise<string | null> {
  if (!ffmpegBin || !existsSync(ffmpegBin)) return null
  if (!existsSync(options.filePath)) return null
  if (
    !Number.isFinite(options.startMs) || !Number.isFinite(options.endMs) ||
    options.startMs < 0 || options.endMs <= options.startMs
  ) return null

  const clipId = `clip_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  if (!existsSync(options.outputDir)) mkdirSync(options.outputDir, { recursive: true })

  const outputPath = join(options.outputDir, `${clipId}.mp4`)
  const startSecs = options.startMs / 1000
  const endSecs = options.endMs / 1000

  return new Promise((resolve) => {
    const args = [
      '-ss', String(startSecs),
      '-to', String(endSecs),
      '-i', options.filePath,
      '-c', 'copy',
      '-movflags', '+faststart',
      '-avoid_negative_ts', 'make_zero',
      '-y',
      outputPath,
    ]
    const proc = spawn(ffmpegBin!, args, { stdio: ['ignore', 'ignore', 'pipe'], ...winSpawnOpts() })
    proc.stderr?.resume()
    proc.on('exit', (code) => resolve(code === 0 && existsSync(outputPath) ? outputPath : null))
    proc.on('error', () => resolve(null))
    setTimeout(() => { try { proc.kill() } catch { /* ok */ } resolve(null) }, 60_000)
  })
}

export function getFileSize(filePath: string): number {
  try {
    return statSync(filePath).size
  } catch {
    return 0
  }
}
