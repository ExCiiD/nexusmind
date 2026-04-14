/**
 * Pure builders for ffmpeg gdigrab arguments — shared with unit tests so window vs desktop
 * and -draw_mouse behaviour stay guaranteed without launching the game.
 */

/** Primary window title (Riot client). */
export const LOL_WINDOW_TITLE = 'League of Legends (TM) Client'

/** Fallback — some client builds omit the trademark suffix. */
export const LOL_WINDOW_TITLE_ALT = 'League of Legends'

/** Order used when probing / resolving which title ffmpeg can capture. */
export const LOL_WINDOW_TITLES_ORDERED: readonly string[] = [LOL_WINDOW_TITLE, LOL_WINDOW_TITLE_ALT]

/** Single-frame probe to validate a window title (exit 0 = capturable). */
export function buildProbeGdigrabWindowArgs(windowTitle: string): string[] {
  return [
    '-f', 'gdigrab',
    '-draw_mouse', '0',
    '-i', `title=${windowTitle}`,
    '-frames:v', '1',
    '-f', 'null',
    '-',
  ]
}

/** Full recording input chain for window-only capture (not full desktop). */
export function buildGdigrabWindowRecordingArgs(windowTitle: string, recordFps: number): string[] {
  return [
    '-f', 'gdigrab',
    '-draw_mouse', '0',
    '-framerate', String(recordFps),
    '-i', `title=${windowTitle}`,
  ]
}

export interface DesktopCaptureBounds {
  offsetX: number
  offsetY: number
  videoWidth: number
  videoHeight: number
  recordFps: number
}

/** Primary-monitor fallback — input is `desktop`, not `title=`. */
export function buildGdigrabDesktopRecordingArgs(b: DesktopCaptureBounds): string[] {
  return [
    '-f', 'gdigrab',
    '-draw_mouse', '0',
    '-framerate', String(b.recordFps),
    '-offset_x', String(b.offsetX),
    '-offset_y', String(b.offsetY),
    '-video_size', `${b.videoWidth}x${b.videoHeight}`,
    '-i', 'desktop',
  ]
}

/** True if args target a named window; false if full-screen desktop capture. */
export function isWindowCaptureInputArgs(inputArgs: string[]): boolean {
  const joined = inputArgs.join(' ')
  return joined.includes('title=') && !joined.includes('-i desktop')
}

/** Ensures cursor is not composited into frames (anti-flicker). */
export function assertNoDrawMouseInArgs(inputArgs: string[]): boolean {
  const i = inputArgs.indexOf('-draw_mouse')
  return i >= 0 && inputArgs[i + 1] === '0'
}
