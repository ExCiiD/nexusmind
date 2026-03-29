import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { autoUpdater } from 'electron-updater'
import { initDatabase } from './database'
import { GameDetector } from './gameDetector'
import { registerAuthHandlers } from './ipc/auth.ipc'
import { registerSessionHandlers } from './ipc/session.ipc'
import { registerReviewHandlers } from './ipc/review.ipc'
import { registerAssessmentHandlers } from './ipc/assessment.ipc'
import { registerAnalyticsHandlers } from './ipc/analytics.ipc'
import { registerAIHandlers } from './ipc/ai.ipc'
import { registerStatsHandlers } from './ipc/stats.ipc'
import { registerAccountHandlers } from './ipc/account.ipc'
import { registerDevHandlers } from './ipc/dev.ipc'

let mainWindow: BrowserWindow | null = null
let gameDetector: GameDetector | null = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    backgroundColor: '#010A13',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#010A13',
      symbolColor: '#A09B8C',
      height: 36,
    },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  ipcMain.handle('window:minimize', () => mainWindow?.minimize())
  ipcMain.handle('window:maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow?.maximize()
    }
  })
  ipcMain.handle('window:close', () => mainWindow?.close())
}

async function bootstrap() {
  await initDatabase()

  registerAuthHandlers()
  registerSessionHandlers()
  registerReviewHandlers()
  registerAssessmentHandlers()
  registerAnalyticsHandlers()
  registerAIHandlers()
  registerStatsHandlers()
  registerAccountHandlers()

  createWindow()
  registerDevHandlers(mainWindow!)
  setupAutoUpdater()

  gameDetector = new GameDetector((matchData) => {
    mainWindow?.webContents.send('game:ended', matchData)
    mainWindow?.show()
    mainWindow?.focus()
  })
  gameDetector.start()
}

app.whenReady().then(bootstrap)

app.on('window-all-closed', () => {
  gameDetector?.stop()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

function setupAutoUpdater() {
  if (!app.isPackaged) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', () => {
    mainWindow?.webContents.send('updater:update-available')
  })

  autoUpdater.on('update-downloaded', () => {
    mainWindow?.webContents.send('updater:update-downloaded')
  })

  autoUpdater.on('error', (err) => {
    console.error('[updater]', err.message)
  })

  ipcMain.handle('updater:install-now', () => {
    autoUpdater.quitAndInstall()
  })

  autoUpdater.checkForUpdatesAndNotify().catch(() => {})
}

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})
