import { ipcMain, dialog, BrowserWindow } from 'electron'
import { writeFileSync, readFileSync, existsSync } from 'fs'
import {
  buildBackupPayload,
  encodeBackup,
  decodeBackup,
  importBackupPayload,
  countRows,
} from '../backup/backupCore'

/**
 * `.nexusmind` file export / import. The format and the merge logic live in
 * backup/backupCore.ts and are shared with the cloud backup.
 * File exports keep the Riot MatchCache (offline re-analysis on the other PC);
 * video files are never included.
 */
export function registerBackupHandlers() {
  ipcMain.handle('backup:export', async () => {
    const parentWindow = BrowserWindow.getFocusedWindow() ?? undefined
    const stamp = new Date().toISOString().slice(0, 10)
    const dialogOptions: Electron.SaveDialogOptions = {
      title: 'Export Ascend data',
      defaultPath: `nexusmind-backup-${stamp}.nexusmind`,
      filters: [{ name: 'Ascend backup', extensions: ['nexusmind'] }],
    }
    const result = parentWindow
      ? await dialog.showSaveDialog(parentWindow, dialogOptions)
      : await dialog.showSaveDialog(dialogOptions)
    if (result.canceled || !result.filePath) return { canceled: true as const }

    const payload = await buildBackupPayload({ forCloud: false })
    const gz = encodeBackup(payload)
    writeFileSync(result.filePath, gz)

    const rows = countRows(payload)
    const counts = {
      sessions: rows.Session ?? 0,
      games: rows.Game ?? 0,
      reviews: rows.Review ?? 0,
      assessments: rows.Assessment ?? 0,
      snapshots: rows.StatsSnapshot ?? 0,
      recordings: rows.Recording ?? 0,
      externalReviews: rows.ExternalReview ?? 0,
    }
    console.log('[backup:export] Wrote', result.filePath, counts, 'bytes:', gz.length)
    return { canceled: false as const, filePath: result.filePath, counts }
  })

  ipcMain.handle('backup:import', async () => {
    const parentWindow = BrowserWindow.getFocusedWindow() ?? undefined
    const dialogOptions: Electron.OpenDialogOptions = {
      title: 'Import Ascend data',
      filters: [{ name: 'Ascend backup', extensions: ['nexusmind'] }],
      properties: ['openFile'],
    }
    const result = parentWindow
      ? await dialog.showOpenDialog(parentWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions)
    if (result.canceled || !result.filePaths[0]) return { canceled: true as const }

    const path = result.filePaths[0]
    if (!existsSync(path)) throw new Error(`File not found: ${path}`)

    const summary = await importBackupPayload(decodeBackup(readFileSync(path)))
    console.log('[backup:import] Done:', summary)
    return { canceled: false as const, summary: toLegacySummary(summary) }
  })
}

/** Shape the renderer already displays (importSummary i18n string). */
export function toLegacySummary(s: Awaited<ReturnType<typeof importBackupPayload>>) {
  return {
    sessionsAdded: s.added.Session ?? 0,
    gamesAdded: s.added.Game ?? 0,
    reviewsAdded: s.added.Review ?? 0,
    assessmentsAdded: s.added.Assessment ?? 0,
    snapshotsAdded: s.added.StatsSnapshot ?? 0,
    recordingsAdded: s.added.Recording ?? 0,
    externalReviewsAdded: s.added.ExternalReview ?? 0,
    conflicts: s.conflicts,
    skipped: s.skipped,
  }
}
