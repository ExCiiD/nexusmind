/**
 * Recorder backend selector — single source of truth shared between
 * `electron/main/index.ts` and the IPC handlers.
 *
 * Keeping the pick here (instead of in `index.ts`) avoids circular imports
 * and guarantees that every layer (status polls, delete guards, game
 * orchestration) agrees on which recorder is authoritative.
 *
 * Flip the backend with the `NXM_RECORDER` env var:
 *   - `wgc` (default) — Windows Graphics Capture via Electron's
 *     `desktopCapturer` + `MediaRecorder`. Survives FSE presentation-mode
 *     transitions; produces `.webm` that we remux to `.mp4` on finalize.
 *   - `ddagrab` — Legacy ffmpeg pipeline with DXGI Desktop Duplication API.
 *     Needs the pre-spawn delay and parallel WASAPI loopback capture.
 */
import { recordingManager } from './recorder'
import { wgcRecorder } from './wgcRecorder'

export const RECORDER_BACKEND: 'wgc' | 'ddagrab' =
  (process.env['NXM_RECORDER'] as 'wgc' | 'ddagrab') === 'ddagrab' ? 'ddagrab' : 'wgc'

export type ActiveRecorder = typeof wgcRecorder | typeof recordingManager

export function getActiveRecorder(): ActiveRecorder {
  return RECORDER_BACKEND === 'wgc' ? wgcRecorder : recordingManager
}
