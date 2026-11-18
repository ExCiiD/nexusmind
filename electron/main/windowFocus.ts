/**
 * Ascend's own window around a recorded game (Settings → Recording).
 *
 * In the background while recording (`User.recordInBackground`): the main
 * window is created with `backgroundThrottling: false`, because the scout and
 * auto-fill loops must keep their pace when the user alt-tabs. The flip side
 * is that a minimized or covered Ascend keeps running its timers, animation
 * frames and layout at full speed. While a game is recorded nothing in the
 * main window needs that, so the window is minimized (it stops compositing
 * its blurred panels, background image and animations) and throttling is
 * turned back on (Chromium slows its timers and pauses its animation frames
 * once the page is hidden). Both are undone when the recording stops. The
 * capture itself runs in its own hidden window (wgcRecorder.ts), which keeps
 * throttling off and is not affected.
 *
 * To the front after the game (`User.reviewPopup`): Windows does not let a
 * background app take the foreground (the taskbar button only flashes), so
 * the window is restored and held above the others for a moment.
 */
import type { BrowserWindow } from 'electron'

/** How long the window stays above the others when it is brought to the front. */
const ON_TOP_MS = 400

let throttled: BrowserWindow | null = null

export function enterRecordingBackground(win: BrowserWindow | null | undefined): void {
  if (!win || win.isDestroyed()) return
  try { win.webContents.setBackgroundThrottling(true) } catch { /* older Electron: still minimized */ }
  throttled = win
  if (!win.isMinimized()) win.minimize()
}

/** Back to the window's normal pace. Safe to call when nothing was throttled. */
export function leaveRecordingBackground(): void {
  const win = throttled
  throttled = null
  if (!win || win.isDestroyed()) return
  try { win.webContents.setBackgroundThrottling(false) } catch { /* older Electron */ }
}

export function bringToFront(win: BrowserWindow | null | undefined): void {
  if (!win || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.setAlwaysOnTop(true)
  win.moveTop()
  win.focus()
  setTimeout(() => {
    if (!win.isDestroyed()) win.setAlwaysOnTop(false)
  }, ON_TOP_MS)
}
