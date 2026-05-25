import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'
import type { ChildProcess } from 'child_process'

// Mock electron BEFORE importing the recorder (which calls `app.getPath` etc.
// at module load via other helpers).
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp'),
    getAppPath: vi.fn(() => '/tmp'),
    isPackaged: false,
  },
  screen: { getPrimaryDisplay: vi.fn(() => ({ size: { width: 1920, height: 1080 } })) },
}))

vi.mock('../../electron/main/database', () => ({
  getPrisma: vi.fn(() => ({})),
}))

// Mock fs.existsSync to always return true so probeReadable doesn't short-circuit.
vi.mock('fs', async (importActual) => {
  const actual = await importActual<typeof import('fs')>()
  return {
    ...actual,
    existsSync: vi.fn(() => true),
  }
})

// Mock child_process.spawn — we'll emit canned ffmpeg stderr matching the
// regex `Duration: HH:MM:SS.cc` that probeDuration parses.
const spawnMock = vi.fn()
vi.mock('child_process', async (importActual) => {
  const actual = await importActual<typeof import('child_process')>()
  return { ...actual, spawn: spawnMock }
})

function makeFakeProc(stderr: string, exitCode = 0): ChildProcess {
  const proc = new EventEmitter() as ChildProcess & EventEmitter
  proc.stderr = new EventEmitter() as ChildProcess['stderr']
  proc.stdout = new EventEmitter() as ChildProcess['stdout']
  proc.kill = vi.fn() as any
  setImmediate(() => {
    proc.stderr?.emit('data', Buffer.from(stderr))
    proc.emit('exit', exitCode)
  })
  return proc
}

// We need to set the ffmpeg path resolver before importing — recorder.ts uses
// ffmpeg-static which sets ffmpegBin. Faking via FFMPEG_PATH env is simpler.
process.env.FFMPEG_PATH = '/fake/ffmpeg' // Note: recorder.ts may not respect this

describe('probeReadable', () => {
  beforeEach(() => {
    spawnMock.mockReset()
  })

  it('reports ok=true when ffmpeg returns a valid duration line', async () => {
    spawnMock.mockImplementation(() => makeFakeProc(
      '  Duration: 00:01:23.45, start: 0.000000, bitrate: 1234 kb/s',
    ))
    const { probeReadable } = await import('../../electron/main/recorder')
    const res = await probeReadable('/some/file.mp4')
    expect(res.ok).toBe(true)
    expect(res.durationSec).toBeCloseTo(83.45, 1)
  })

  it('reports ok=false when ffmpeg cannot parse a duration', async () => {
    spawnMock.mockImplementation(() => makeFakeProc('Invalid data found'))
    const { probeReadable } = await import('../../electron/main/recorder')
    const res = await probeReadable('/some/file.mp4')
    expect(res.ok).toBe(false)
    expect(res.durationSec).toBe(0)
  })

  it('reports ok=false when duration is below the minDurationSec threshold', async () => {
    spawnMock.mockImplementation(() => makeFakeProc(
      '  Duration: 00:00:00.10, start: 0.000000, bitrate: 100 kb/s',
    ))
    const { probeReadable } = await import('../../electron/main/recorder')
    const res = await probeReadable('/some/file.mp4', 0.5)
    expect(res.ok).toBe(false)
    expect(res.durationSec).toBeCloseTo(0.1, 1)
  })
})
