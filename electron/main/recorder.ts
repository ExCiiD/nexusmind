import { spawn, ChildProcess } from 'child_process'
import { app, screen } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, statSync } from 'fs'
import os from 'os'
import { getPrisma } from './database'

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

const QUALITY_HEIGHT: Record<string, number> = {
  source: 0,
  '1440p': 1440,
  '1080p': 1080,
  '720p': 720,
}

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
  private pendingRecording: string | null = null
  private lastOutputPath: string | null = null
  private donePromise: Promise<void> | null = null
  private doneResolve: (() => void) | null = null
  private startedAt = 0
  private lastSettings: RecordingSettings = {}
  private isStopping = false
  private retryCount = 0
  private static readonly MAX_RETRIES = 1
  private static readonly EARLY_CRASH_THRESHOLD_MS = 15_000

  getRecordingsDir(customPath?: string | null): string {
    const dir = customPath && customPath.trim()
      ? customPath.trim()
      : join(app.getPath('userData'), 'recordings')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    return dir
  }

  /**
   * Uses DXGI Desktop Duplication (`ddagrab`) instead of GDI (`gdigrab`).
   * DXGI captures directly from the GPU compositor — no GDI BitBlt calls,
   * which eliminates hardware-cursor flickering in DirectX games.
   *
   * If ddagrab crashes early (display mode transition), it automatically
   * retries once after a short delay.
   */
  async startRecording(settings: RecordingSettings = {}): Promise<string | null> {
    if (this.isRecording) return this.currentFilePath
    if (!ffmpegBin || !existsSync(ffmpegBin)) {
      console.warn('[recorder] ffmpeg binary not found, skipping auto-record')
      return null
    }

    this.pendingRecording = null
    this.lastSettings = settings
    this.isStopping = false
    this.retryCount = 0

    return this.spawnDdagrab(settings)
  }

  private spawnDdagrab(settings: RecordingSettings): string | null {
    const {
      recordingPath = null,
      recordQuality = 'source',
      recordFps = 30,
      recordEncoder = 'cpu',
    } = settings

    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const filePath = join(this.getRecordingsDir(recordingPath), `lol_${ts}.mp4`)

    const primary = screen.getPrimaryDisplay()
    const { width, height } = primary.bounds
    const scaleFactor = primary.scaleFactor ?? 1
    const capH = Math.round(height * scaleFactor)

    const targetH = QUALITY_HEIGHT[recordQuality] ?? 0
    const needsScale = targetH > 0 && capH > targetH

    const filterChain = needsScale
      ? `hwdownload,format=bgra,scale=-2:${targetH},format=yuv420p`
      : 'hwdownload,format=bgra,format=yuv420p'

    console.log(`[recorder] Using ddagrab (DXGI) — display: ${Math.round(width * scaleFactor)}x${capH}, scale=${scaleFactor}`)
    console.log(`[recorder] Settings — quality: ${recordQuality}, fps: ${recordFps}, encoder: ${recordEncoder}`)

    const args = [
      '-f', 'lavfi',
      '-i', `ddagrab=output_idx=0:draw_mouse=1:framerate=${recordFps}`,
      '-vf', filterChain,
      ...encoderArgs(recordEncoder),
      '-movflags', '+faststart',
      '-y',
      filePath,
    ]

    this.currentFilePath = filePath
    this.lastOutputPath = filePath
    this.isRecording = true
    this.startedAt = Date.now()

    this.donePromise = new Promise<void>((resolve) => { this.doneResolve = resolve })

    this.process = spawn(ffmpegBin!, args, { stdio: ['pipe', 'pipe', 'pipe'], detached: false, windowsHide: true })

    if (this.process.pid) {
      try { os.setPriority(this.process.pid, os.constants.priority.PRIORITY_BELOW_NORMAL) } catch { /* ignore */ }
    }

    this.process.stderr?.on('data', (data: Buffer) => {
      if (!app.isPackaged) process.stdout.write('[recorder] ' + data.toString())
    })

    this.process.on('exit', (code) => {
      console.log(`[recorder] ffmpeg exited (code ${code}), file: ${filePath}`)
      this.isRecording = false
      this.process = null

      const elapsed = Date.now() - this.startedAt
      if (
        code !== 0 &&
        elapsed < RecordingManager.EARLY_CRASH_THRESHOLD_MS &&
        !this.isStopping &&
        this.retryCount < RecordingManager.MAX_RETRIES
      ) {
        this.retryCount++
        console.warn(`[recorder] ddagrab crashed after ${elapsed}ms — retry ${this.retryCount}/${RecordingManager.MAX_RETRIES} in 3s`)
        setTimeout(() => {
          if (this.isStopping) { this.doneResolve?.(); return }
          this.spawnDdagrab(this.lastSettings)
          console.log(`[recorder] ddagrab retry started → ${this.currentFilePath}`)
        }, 3_000)
        return
      }

      this.doneResolve?.()
    })

    this.process.on('error', (err) => {
      console.error('[recorder] spawn error:', err.message)
      this.isRecording = false
      this.process = null
      this.currentFilePath = null
      this.doneResolve?.()
    })

    console.log(`[recorder] Started → ${filePath}`)
    return filePath
  }

  stopRecording(): string | null {
    this.isStopping = true

    if (!this.process || !this.isRecording) {
      const path = this.currentFilePath ?? this.lastOutputPath
      if (path) this.pendingRecording = path
      return path
    }

    const path = this.currentFilePath
    this.pendingRecording = path

    const proc = this.process
    this.process = null

    try {
      proc.stdin?.write('q\n')
      proc.stdin?.end()
    } catch {
      proc.kill('SIGTERM')
    }

    const killTimer = setTimeout(() => {
      if (!proc.killed) {
        console.warn('[recorder] ffmpeg did not exit gracefully — force killing')
        try { proc.kill('SIGTERM') } catch { /* ignore */ }
      }
    }, 8_000)
    proc.on('exit', () => clearTimeout(killTimer))

    return path
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
    const proc = spawn(ffmpegBin!, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    proc.stderr?.resume()
    proc.on('exit', (code) => resolve(code === 0 && existsSync(outputPath) ? outputPath : null))
    proc.on('error', () => resolve(null))
    setTimeout(() => { try { proc.kill() } catch { /* ok */ } resolve(null) }, 15_000)
  })
}

function probeDuration(filePath: string): Promise<number> {
  if (!ffmpegBin || !existsSync(filePath)) return Promise.resolve(0)
  return new Promise((resolve) => {
    let resolved = false
    const done = (val: number) => { if (!resolved) { resolved = true; clearTimeout(timer); resolve(val) } }
    const args = ['-i', filePath, '-hide_banner']
    const proc = spawn(ffmpegBin!, args, { stdio: ['ignore', 'pipe', 'pipe'] })
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
    const proc = spawn(ffmpegBin!, args, { stdio: ['ignore', 'ignore', 'pipe'] })
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
