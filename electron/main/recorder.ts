import { spawn, ChildProcess } from 'child_process'
import { app, screen } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'

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
  /** Custom output folder — null means default userData/recordings */
  recordingPath?: string | null
  /** Target output resolution: 'source' | '1440p' | '1080p' | '720p' */
  recordQuality?: string
  /** Frames per second: 30 | 60 */
  recordFps?: number
  /** Encoder: 'cpu' | 'nvenc' | 'amf' | 'qsv' */
  recordEncoder?: string
}

/** Map quality label to max height (0 = no scaling / source) */
const QUALITY_HEIGHT: Record<string, number> = {
  source: 0,
  '1440p': 1440,
  '1080p': 1080,
  '720p': 720,
}

/** Window title used by League of Legends on Windows. */
const LOL_WINDOW_TITLE = 'League of Legends (TM) Client'

/**
 * Checks whether League of Legends is running as a foreground window by probing
 * ffmpeg for one frame. Returns true if the capture source is valid.
 */
async function isLolWindowAvailable(ffmpegPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = spawn(
      ffmpegPath,
      [
        '-f', 'gdigrab',
        '-i', `title=${LOL_WINDOW_TITLE}`,
        '-frames:v', '1',
        '-f', 'null',
        '-',
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    )
    probe.on('exit', (code) => resolve(code === 0))
    probe.on('error', () => resolve(false))
    // Safety timeout — if ffmpeg hangs, fall back to desktop capture
    setTimeout(() => { try { probe.kill() } catch { /* ok */ } resolve(false) }, 5_000)
  })
}

/** Map encoder label to ffmpeg codec + preset args. Uses CBR for GPU encoders to
 *  keep encoding load predictable and prevent sudden CPU/GPU spikes during gameplay. */
function encoderArgs(encoder: string): string[] {
  switch (encoder) {
    case 'nvenc': return ['-c:v', 'h264_nvenc', '-preset', 'p1', '-rc', 'cbr', '-b:v', '6000k', '-maxrate', '8000k', '-bufsize', '16000k']
    case 'amf':   return ['-c:v', 'h264_amf', '-quality', 'speed', '-rc', 'cbr', '-b:v', '6000k']
    case 'qsv':   return ['-c:v', 'h264_qsv', '-preset', 'veryfast', '-b:v', '6000k']
    default:      return ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30', '-threads', '4', '-tune', 'zerolatency']
  }
}

export class RecordingManager {
  private process: ChildProcess | null = null
  private currentFilePath: string | null = null
  private isRecording = false
  /** Path of the last completed recording waiting to be linked to a DB game row */
  private pendingRecording: string | null = null

  getRecordingsDir(customPath?: string | null): string {
    const dir = customPath && customPath.trim()
      ? customPath.trim()
      : join(app.getPath('userData'), 'recordings')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    return dir
  }

  /**
   * Starts an ffmpeg recording session.
   * First attempts to capture the League of Legends window directly via gdigrab title=.
   * Falls back to primary-monitor desktop capture if the window is not detected.
   */
  async startRecording(settings: RecordingSettings = {}): Promise<string | null> {
    if (this.isRecording) return this.currentFilePath
    if (!ffmpegBin || !existsSync(ffmpegBin)) {
      console.warn('[recorder] ffmpeg binary not found, skipping auto-record')
      return null
    }

    const {
      recordingPath = null,
      recordQuality = 'source',
      recordFps = 30,
      recordEncoder = 'cpu',
    } = settings

    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const filePath = join(this.getRecordingsDir(recordingPath), `lol_${ts}.mp4`)

    // Build optional scale filter (used only for desktop capture; window capture auto-sizes)
    const primary = screen.getPrimaryDisplay()
    const { x, y, width, height } = primary.bounds
    const scaleFactor = primary.scaleFactor ?? 1
    const capW = Math.round(width * scaleFactor)
    const capH = Math.round(height * scaleFactor)
    const evenH = capH % 2 === 0 ? capH : capH - 1
    const evenW = capW % 2 === 0 ? capW : capW - 1

    const targetH = QUALITY_HEIGHT[recordQuality] ?? 0
    const scaleFilter = targetH > 0 && evenH > targetH ? ['-vf', `scale=-2:${targetH}`] : []

    // Try window-only capture first — lower resource usage and no task bar / other windows.
    let inputArgs: string[]
    const windowAvailable = await isLolWindowAvailable(ffmpegBin)
    if (windowAvailable) {
      console.log('[recorder] LoL window detected — using window capture')
      inputArgs = [
        '-f', 'gdigrab',
        '-framerate', String(recordFps),
        '-i', `title=${LOL_WINDOW_TITLE}`,
      ]
    } else {
      console.log('[recorder] LoL window not found — falling back to primary display capture')
      console.log(`[recorder] Primary display: ${evenW}x${evenH} at (${x},${y}) scale=${scaleFactor}`)
      inputArgs = [
        '-f', 'gdigrab',
        '-framerate', String(recordFps),
        '-offset_x', String(x * scaleFactor),
        '-offset_y', String(y * scaleFactor),
        '-video_size', `${evenW}x${evenH}`,
        '-i', 'desktop',
      ]
    }

    console.log(`[recorder] Settings — quality: ${recordQuality}, fps: ${recordFps}, encoder: ${recordEncoder}`)

    const args = [
      ...inputArgs,
      ...encoderArgs(recordEncoder),
      '-pix_fmt', 'yuv420p',
      ...scaleFilter,
      // faststart moves the MP4 index (moov atom) to the beginning of the file,
      // which is required for seekable playback in a video element
      '-movflags', '+faststart',
      '-y',
      filePath,
    ]

    this.currentFilePath = filePath
    this.isRecording = true

    this.process = spawn(ffmpegBin, args, { stdio: ['pipe', 'pipe', 'pipe'], detached: false })

    // Lower the ffmpeg process priority so it doesn't steal CPU cycles from the game
    if (this.process.pid) {
      spawn('cmd', ['/c', `wmic process where ProcessId=${this.process.pid} CALL setpriority "below normal"`], {
        stdio: 'ignore',
        detached: true,
      }).unref()
    }

    this.process.stderr?.on('data', (data: Buffer) => {
      if (!app.isPackaged) process.stdout.write('[recorder] ' + data.toString())
    })

    this.process.on('exit', (code) => {
      console.log(`[recorder] ffmpeg exited (code ${code}), file: ${filePath}`)
      this.isRecording = false
      this.process = null
    })

    this.process.on('error', (err) => {
      console.error('[recorder] spawn error:', err.message)
      this.isRecording = false
      this.process = null
      this.currentFilePath = null
    })

    console.log(`[recorder] Started → ${filePath}`)
    return filePath
  }

  stopRecording(): string | null {
    if (!this.process || !this.isRecording) return null

    const path = this.currentFilePath
    this.isRecording = false
    this.currentFilePath = null
    this.pendingRecording = path

    const proc = this.process
    this.process = null

    try {
      // 'q\n' signals ffmpeg to stop gracefully so it can write the MP4 moov atom
      proc.stdin?.write('q\n')
      proc.stdin?.end()
    } catch {
      proc.kill('SIGTERM')
    }

    // Force-kill if ffmpeg hasn't exited after 8 seconds
    const killTimer = setTimeout(() => {
      if (!proc.killed) {
        console.warn('[recorder] ffmpeg did not exit gracefully — force killing')
        try { proc.kill('SIGTERM') } catch { /* ignore */ }
      }
    }, 8_000)

    proc.on('exit', () => clearTimeout(killTimer))

    return path
  }

  getPendingRecording(): string | null {
    return this.pendingRecording
  }

  clearPendingRecording() {
    this.pendingRecording = null
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
