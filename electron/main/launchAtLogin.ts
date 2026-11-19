import { app, BrowserWindow, ipcMain, Menu, nativeImage, Tray } from 'electron'
import { join } from 'path'
import { z } from 'zod'

/**
 * "Launch Ascend when Windows starts" (Settings → Démarrage), off by default.
 *
 *  - The login item starts Ascend with `--hidden`: no window, an icon in the
 *    notification area, and the game detector already watching, so no game
 *    is missed.
 *  - While the option is on, closing the window hides it to that icon
 *    instead of quitting; the icon's menu reopens it or quits.
 *  - One Ascend at a time: opening it again shows the running one.
 * Only the installed app registers a login item (a dev build would register
 * electron.exe).
 */

const HIDDEN_ARG = '--hidden'

let tray: Tray | null = null
let quitting = false
let getWindow: () => BrowserWindow | null = () => null

export const launchAtLoginSupported = () => app.isPackaged && process.platform === 'win32'

export function isLaunchAtLoginEnabled(): boolean {
  if (!launchAtLoginSupported()) return false
  return app.getLoginItemSettings({ args: [HIDDEN_ARG] }).openAtLogin
}

/** Started by the login item: stay in the notification area. */
export function startedHidden(): boolean {
  return process.argv.includes(HIDDEN_ARG)
}

/**
 * Keeps a single instance. Returns false when another Ascend already runs
 * (it is shown, and this one must quit).
 */
export function claimSingleInstance(): boolean {
  if (!app.requestSingleInstanceLock()) return false
  app.on('second-instance', () => showWindow())
  return true
}

export function showWindow(): void {
  const win = getWindow()
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

const fr = () => app.getLocale().toLowerCase().startsWith('fr')

async function trayIcon(): Promise<Electron.NativeImage> {
  if (app.isPackaged) {
    try { return await app.getFileIcon(process.execPath, { size: 'small' }) } catch { /* fallback below */ }
  }
  const img = nativeImage.createFromPath(join(process.cwd(), 'build', 'icon.png'))
  return img.isEmpty() ? img : img.resize({ width: 16, height: 16 })
}

async function ensureTray(): Promise<void> {
  if (tray) return
  tray = new Tray(await trayIcon())
  tray.setToolTip('Ascend')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: fr() ? 'Ouvrir Ascend' : 'Open Ascend', click: () => showWindow() },
    { type: 'separator' },
    { label: fr() ? 'Quitter' : 'Quit', click: () => { quitting = true; app.quit() } },
  ]))
  tray.on('click', () => showWindow())
}

function removeTray(): void {
  tray?.destroy()
  tray = null
}

/**
 * Wires the window: started hidden → stays hidden with the tray icon; while
 * the option is on, closing hides to the tray. Call right after creating it.
 */
export function attachWindow(win: BrowserWindow, window: () => BrowserWindow | null): void {
  getWindow = window
  app.on('before-quit', () => { quitting = true })
  win.on('close', (event) => {
    if (quitting || !isLaunchAtLoginEnabled()) return
    event.preventDefault()
    win.hide()
  })
  if (isLaunchAtLoginEnabled() || startedHidden()) {
    ensureTray().catch((err) => console.warn('[startup] tray failed:', (err as Error)?.message))
  }
}

export function registerLaunchAtLoginHandlers(): void {
  ipcMain.handle('app:get-launch-at-login', () => ({
    supported: launchAtLoginSupported(),
    enabled: isLaunchAtLoginEnabled(),
  }))
  ipcMain.handle('app:set-launch-at-login', async (_e, value: unknown) => {
    const enabled = z.boolean().parse(value)
    if (!launchAtLoginSupported()) return { supported: false, enabled: false }
    app.setLoginItemSettings({ openAtLogin: enabled, args: [HIDDEN_ARG] })
    if (enabled) await ensureTray()
    else removeTray()
    return { supported: true, enabled: isLaunchAtLoginEnabled() }
  })
}
