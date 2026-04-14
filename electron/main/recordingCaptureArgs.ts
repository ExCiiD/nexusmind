/**
 * Pure builders for ffmpeg gdigrab arguments — shared with unit tests so window vs desktop
 * and -draw_mouse behaviour stay guaranteed without launching the game.
 *
 * GDI capture with `title=` cannot see DirectX surfaces (black screen).
 * Strategy: probe `title=` to find window position/size, then record with `-i desktop`
 * cropped to those bounds. This captures actual game pixels without the full desktop.
 */

/** Primary window title (Riot client + in-game borderless uses the same HWND on many setups). */
export const LOL_WINDOW_TITLE = 'League of Legends (TM) Client'

/** Fallback — some client builds omit the trademark suffix. */
export const LOL_WINDOW_TITLE_ALT = 'League of Legends'

/**
 * Order used when probing gdigrab — try these until ffmpeg accepts `title=…`.
 */
export const LOL_WINDOW_TITLES_ORDERED: readonly string[] = [
  LOL_WINDOW_TITLE,
  LOL_WINDOW_TITLE_ALT,
  'League Of Legends',
]

export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Probe args that log to stderr so we can parse the window position/size.
 * We use `-loglevel info` (not `error`) because the bounds line is info-level.
 */
export function buildProbeGdigrabWindowArgs(windowTitle: string): string[] {
  return [
    '-hide_banner',
    '-loglevel', 'info',
    '-f', 'gdigrab',
    '-draw_mouse', '0',
    '-i', `title=${windowTitle}`,
    '-frames:v', '1',
    '-f', 'null',
    '-',
  ]
}

/**
 * Parses ffmpeg gdigrab stderr for the window bounds.
 * Expected line: `[gdigrab @ ...] Found window ..., capturing WIDTHxHEIGHTxBPP at (X,Y)`
 */
export function parseWindowBoundsFromStderr(stderr: string): WindowBounds | null {
  const m = stderr.match(/capturing\s+(\d+)x(\d+)x\d+\s+at\s+\((-?\d+),(-?\d+)\)/)
  if (!m) return null
  return {
    width: parseInt(m[1], 10),
    height: parseInt(m[2], 10),
    x: parseInt(m[3], 10),
    y: parseInt(m[4], 10),
  }
}

export interface DesktopCaptureBounds {
  offsetX: number
  offsetY: number
  videoWidth: number
  videoHeight: number
  recordFps: number
}

/**
 * Desktop-based recording cropped to specific bounds. Used both for window-crop and full fallback.
 * `-show_region 0` prevents gdigrab from drawing a visible border around the captured area.
 */
export function buildGdigrabDesktopRecordingArgs(b: DesktopCaptureBounds): string[] {
  return [
    '-f', 'gdigrab',
    '-thread_queue_size', '512',
    '-draw_mouse', '0',
    '-show_region', '0',
    '-framerate', String(b.recordFps),
    '-offset_x', String(b.offsetX),
    '-offset_y', String(b.offsetY),
    '-video_size', `${b.videoWidth}x${b.videoHeight}`,
    '-i', 'desktop',
  ]
}

/** True if args target a named window; false if desktop capture. */
export function isWindowCaptureInputArgs(inputArgs: string[]): boolean {
  const joined = inputArgs.join(' ')
  return joined.includes('title=') && !joined.includes('-i desktop')
}

/** Ensures cursor is not composited into frames (anti-flicker). */
export function assertNoDrawMouseInArgs(inputArgs: string[]): boolean {
  const i = inputArgs.indexOf('-draw_mouse')
  return i >= 0 && inputArgs[i + 1] === '0'
}
