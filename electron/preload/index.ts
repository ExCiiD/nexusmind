import { contextBridge, ipcRenderer } from 'electron'

const api = {
  connectRiot: (gameName: string, tagLine: string, region: string, displayName?: string) =>
    ipcRenderer.invoke('auth:connect-riot', gameName, tagLine, region, displayName),
  disconnectRiot: () =>
    ipcRenderer.invoke('auth:disconnect'),
  reactivateAccount: (userId: string) =>
    ipcRenderer.invoke('auth:reactivate', userId),
  listSavedAccounts: () =>
    ipcRenderer.invoke('auth:list-saved-accounts'),

  createSession: (data: { objectiveId: string; objectiveIds?: string[]; selectedKpiIds?: string[]; subObjective?: string; customNote?: string; date?: string; isRetroactive?: boolean }) =>
    ipcRenderer.invoke('session:create', data),
  getActiveSession: () => ipcRenderer.invoke('session:get-active'),
  getLastSessionConfig: () => ipcRenderer.invoke('session:get-last-config'),
  getKpiHistory: () => ipcRenderer.invoke('session:get-kpi-history'),
  endSession: (id: string, manualSummary?: string, sessionConclusion?: string) => ipcRenderer.invoke('session:end', id, manualSummary, sessionConclusion),
  deleteSession: (id: string) => ipcRenderer.invoke('session:delete', id),
  bulkDeleteSessions: (ids: string[]) => ipcRenderer.invoke('session:bulk-delete', ids),
  cancelSession: (id: string) => ipcRenderer.invoke('session:cancel', id),
  updateSession: (id: string, data: { objectiveIds?: string[]; selectedKpiIds?: string[]; customNote?: string }) =>
    ipcRenderer.invoke('session:update', id, data),
  deleteGame: (gameId: string) => ipcRenderer.invoke('game:delete', gameId),
  setGameReviewStatus: (gameId: string, reviewStatus: 'pending' | 'to_be_reviewed') =>
    ipcRenderer.invoke('session:set-review-status', gameId, reviewStatus),

  saveReview: (data: {
    gameId: string
    timelineNotes: Array<{ time: string; note: string }>
    kpiScores: Record<string, number>
    freeText?: string
    objectiveRespected: boolean
  }) => ipcRenderer.invoke('review:save', data),
  getReviews: (sessionId: string) => ipcRenderer.invoke('review:get-by-session', sessionId),
  getGameContext: (gameId: string) => ipcRenderer.invoke('review:get-game-context', gameId),
  analyzeReviewBias: (gameId: string, objectiveIds: string[]) =>
    ipcRenderer.invoke('review:analyze-bias', { gameId, objectiveIds }),

  saveAssessment: (scores: Array<{ fundamentalId: string; subcategoryId?: string; score: number }>) =>
    ipcRenderer.invoke('assessment:save', scores),
  getLatestAssessment: () => ipcRenderer.invoke('assessment:get-latest'),
  getAssessmentHistory: () => ipcRenderer.invoke('assessment:get-history'),

  listSessions: () => ipcRenderer.invoke('sessions:list'),

  getProgressData: () => ipcRenderer.invoke('analytics:get-progress'),
  getSessionStats: () => ipcRenderer.invoke('analytics:get-session-stats'),
  getGameHistory: (limit?: number) => ipcRenderer.invoke('analytics:get-game-history', limit),
  getKpiTimeline: () => ipcRenderer.invoke('analytics:get-kpi-timeline'),

  getObjectiveSuggestion: (scores: Record<string, number>) =>
    ipcRenderer.invoke('ai:suggest-objective', scores),
  synthesizeReview: (data: {
    timelineNotes: Array<{ time: string; note: string }>
    kpiScores: Record<string, number>
    objective: string
  }) => ipcRenderer.invoke('ai:synthesize-review', data),
  analyzePatterns: (reviews: any[]) => ipcRenderer.invoke('ai:analyze-patterns', reviews),
  generateSessionSummary: (sessionId: string) =>
    ipcRenderer.invoke('ai:session-summary', sessionId),

  onGameEnd: (callback: (data: any) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data)
    ipcRenderer.on('game:ended', handler)
    return () => {
      ipcRenderer.removeListener('game:ended', handler)
    }
  },

  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window:maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),

  fetchMatchHistory: (count?: number) => ipcRenderer.invoke('riot:fetch-match-history', count),
  importGamesToSession: (matchIds: string[]) => ipcRenderer.invoke('session:import-games', matchIds),

  getMatchHistoryWithStatus: (count?: number) => ipcRenderer.invoke('stats:match-history', count),
  getDetailedStats: (matchId: string) => ipcRenderer.invoke('stats:get-detailed', matchId),
  computeStatsAverages: () => ipcRenderer.invoke('stats:compute-averages'),
  getStatsSnapshots: () => ipcRenderer.invoke('stats:get-snapshots'),
  autoSnapshot: () => ipcRenderer.invoke('stats:auto-snapshot'),
  getAccountAverages: (puuid: string | null) => ipcRenderer.invoke('stats:get-account-averages', puuid),
  clearStatsSnapshots: () => ipcRenderer.invoke('stats:clear-snapshots'),

  getBadges: () => ipcRenderer.invoke('badges:get'),

  listAccounts: () => ipcRenderer.invoke('account:list'),
  addAccount: (gameName: string, tagLine: string, region: string) =>
    ipcRenderer.invoke('account:add', gameName, tagLine, region),
  removeAccount: (accountId: string) => ipcRenderer.invoke('account:remove', accountId),

  simulateGame: () => ipcRenderer.invoke('dev:simulate-game'),
  isDev: () => ipcRenderer.invoke('dev:is-dev'),

  getAppVersion: () => ipcRenderer.invoke('app:get-version') as Promise<string>,
  getUser: () => ipcRenderer.invoke('user:get'),
  updateUser: (data: any) => ipcRenderer.invoke('user:update', data),

  onUpdateAvailable: (cb: () => void) => {
    ipcRenderer.on('updater:update-available', cb)
    return () => { ipcRenderer.removeListener('updater:update-available', cb) }
  },
  onUpdateProgress: (cb: (percent: number) => void) => {
    const handler = (_: Electron.IpcRendererEvent, percent: number) => cb(percent)
    ipcRenderer.on('updater:download-progress', handler)
    return () => { ipcRenderer.removeListener('updater:download-progress', handler) }
  },
  onUpdateDownloaded: (cb: () => void) => {
    ipcRenderer.on('updater:update-downloaded', cb)
    return () => { ipcRenderer.removeListener('updater:update-downloaded', cb) }
  },
  installUpdate: () => ipcRenderer.invoke('updater:install-now'),
  checkForUpdates: () => ipcRenderer.invoke('updater:check') as Promise<{ updateAvailable: boolean }>,

  // Recording — library (scan external folders)
  scanRecordings: () => ipcRenderer.invoke('recording:scan'),
  getRecording: (gameId: string) => ipcRenderer.invoke('recording:get', gameId),
  getRecordingById: (recordingId: string) => ipcRenderer.invoke('recording:get-by-id', recordingId),
  linkRecordingFile: (gameId: string) => ipcRenderer.invoke('recording:link-file', gameId),
  setYoutubeUrl: (gameId: string, youtubeUrl: string | null) => ipcRenderer.invoke('recording:set-youtube', gameId, youtubeUrl),
  deleteReview: (gameId: string) => ipcRenderer.invoke('review:delete', gameId),
  deleteRecording: (gameId: string) => ipcRenderer.invoke('recording:delete', gameId),
  unlinkRecording: (gameId: string) => ipcRenderer.invoke('recording:unlink', gameId),
  deleteRecordingById: (recordingId: string) => ipcRenderer.invoke('recording:delete-by-id', recordingId),
  resetDismissedRecordings: () => ipcRenderer.invoke('recording:reset-dismissed'),
  getRecordingScanPaths: () => ipcRenderer.invoke('recording:get-scan-paths'),
  listGamesWithRecordings: () => ipcRenderer.invoke('recording:list-with-games'),
  // Recording — in-app capture
  pickRecordingFolder: () => ipcRenderer.invoke('recording:pick-folder'),
  getCaptureStatus: () => ipcRenderer.invoke('recording:get-capture-status'),
  startCapture: () => ipcRenderer.invoke('recording:start-capture'),
  stopCapture: (gameId?: string) => ipcRenderer.invoke('recording:stop-capture', gameId),
  getRecordingsDir: () => ipcRenderer.invoke('recording:get-recordings-dir'),
  onRecordingStarted: (cb: () => void) => {
    const handler = () => cb()
    ipcRenderer.on('recording:started', handler)
    return () => ipcRenderer.removeListener('recording:started', handler)
  },
  onRecordingStopped: (cb: (data: { filePath: string }) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, data: { filePath: string }) => cb(data)
    ipcRenderer.on('recording:stopped', handler)
    return () => ipcRenderer.removeListener('recording:stopped', handler)
  },
  onRecordingLinked: (cb: (data: { gameId: string; filePath: string }) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, data: { gameId: string; filePath: string }) => cb(data)
    ipcRenderer.on('recording:linked', handler)
    return () => ipcRenderer.removeListener('recording:linked', handler)
  },

  // External reviews
  fetchExternalPlayerHistory: (gameName: string, tagLine: string, region: string, count?: number) =>
    ipcRenderer.invoke('external-review:fetch-player-history', gameName, tagLine, region, count),
  createExternalReview: (data: {
    title: string
    objectiveId?: string
    objectiveIds?: string
    selectedKpiIds?: string
    filePath?: string
    playerName?: string
    matchData?: string
  }) => ipcRenderer.invoke('external-review:create', data),
  getExternalReview: (id: string) => ipcRenderer.invoke('external-review:get', id),
  saveExternalReview: (id: string, data: { timelineNotes?: string; freeText?: string; filePath?: string }) =>
    ipcRenderer.invoke('external-review:save', id, data),
  listExternalReviews: () => ipcRenderer.invoke('external-review:list'),
  pickExternalReviewFile: () => ipcRenderer.invoke('external-review:pick-file'),
  deleteExternalReview: (id: string) => ipcRenderer.invoke('external-review:delete', id),

  // Sharing
  sendToDiscord: (embeds: object[], webhookUrl: string) => ipcRenderer.invoke('share:send-to-discord', embeds, webhookUrl),
  copyReviewText: (text: string) => ipcRenderer.invoke('share:copy-text', text),
  listWebhooks: () => ipcRenderer.invoke('share:list-webhooks'),
  addWebhook: (name: string, url: string) => ipcRenderer.invoke('share:add-webhook', name, url),
  renameWebhook: (id: string, name: string) => ipcRenderer.invoke('share:rename-webhook', id, name),
  deleteWebhook: (id: string) => ipcRenderer.invoke('share:delete-webhook', id),

  // Coaching (deterministic, rule-based)
  getCoachingPatterns: () => ipcRenderer.invoke('coaching:get-patterns'),

  // Clips
  createClip: (opts: { recordingId: string; startMs: number; endMs: number; title?: string; linkedNoteText?: string }) =>
    ipcRenderer.invoke('clip:create', opts),
  listClips: (recordingId: string) => ipcRenderer.invoke('clip:list', recordingId),
  listAllClips: () => ipcRenderer.invoke('clip:list-all'),
  deleteClip: (clipId: string) => ipcRenderer.invoke('clip:delete', clipId),
  setClipYoutubeUrl: (clipId: string, url: string) => ipcRenderer.invoke('clip:set-youtube', clipId, url),
  setClipTempShare: (clipId: string, url: string, expiryHours: number) =>
    ipcRenderer.invoke('clip:set-temp-share', clipId, url, expiryHours),
  generateThumbnail: (recordingId: string) => ipcRenderer.invoke('recording:generate-thumbnail', recordingId),

  // Sharing (files + temp upload)
  sendFileToDiscord: (filePath: string, webhookUrl: string, caption?: string) =>
    ipcRenderer.invoke('share:send-file-to-discord', filePath, webhookUrl, caption),
  uploadToTemp: (filePath: string, expiryHours: number) =>
    ipcRenderer.invoke('share:upload-temp', filePath, expiryHours),

  // YouTube OAuth + upload
  youtubeAuthStart: () => ipcRenderer.invoke('youtube:auth-start'),
  youtubeGetStatus: () => ipcRenderer.invoke('youtube:get-status'),
  youtubeDisconnect: () => ipcRenderer.invoke('youtube:disconnect'),
  youtubeUpload: (opts: { filePath: string; title: string; description?: string; visibility?: string }) =>
    ipcRenderer.invoke('youtube:upload', opts),
  onYoutubeUploadProgress: (cb: (data: { jobId: string; percent: number }) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, data: any) => cb(data)
    ipcRenderer.on('youtube:upload-progress', handler)
    return () => ipcRenderer.removeListener('youtube:upload-progress', handler)
  },
}

contextBridge.exposeInMainWorld('api', api)
