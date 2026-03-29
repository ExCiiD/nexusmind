import { contextBridge, ipcRenderer } from 'electron'

const api = {
  connectRiot: (gameName: string, tagLine: string, region: string, displayName?: string) =>
    ipcRenderer.invoke('auth:connect-riot', gameName, tagLine, region, displayName),
  disconnectRiot: () =>
    ipcRenderer.invoke('auth:disconnect'),

  createSession: (data: { objectiveId: string; objectiveIds?: string[]; selectedKpiIds?: string[]; subObjective?: string; customNote?: string; date?: string; isRetroactive?: boolean }) =>
    ipcRenderer.invoke('session:create', data),
  getActiveSession: () => ipcRenderer.invoke('session:get-active'),
  endSession: (id: string, manualSummary?: string) => ipcRenderer.invoke('session:end', id, manualSummary),
  deleteSession: (id: string) => ipcRenderer.invoke('session:delete', id),
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

  getBadges: () => ipcRenderer.invoke('badges:get'),

  listAccounts: () => ipcRenderer.invoke('account:list'),
  addAccount: (gameName: string, tagLine: string, region: string) =>
    ipcRenderer.invoke('account:add', gameName, tagLine, region),
  removeAccount: (accountId: string) => ipcRenderer.invoke('account:remove', accountId),

  simulateGame: () => ipcRenderer.invoke('dev:simulate-game'),
  isDev: () => ipcRenderer.invoke('dev:is-dev'),

  getUser: () => ipcRenderer.invoke('user:get'),
  updateUser: (data: any) => ipcRenderer.invoke('user:update', data),

  onUpdateAvailable: (cb: () => void) => ipcRenderer.on('updater:update-available', cb),
  onUpdateDownloaded: (cb: () => void) => ipcRenderer.on('updater:update-downloaded', cb),
  installUpdate: () => ipcRenderer.invoke('updater:install-now'),
}

contextBridge.exposeInMainWorld('api', api)
